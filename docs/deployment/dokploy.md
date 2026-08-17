# Implementación Development en VPS con Dokploy

Estado: artefactos de base preparados; no se ha modificado ningún VPS ni se ha llamado a Dokploy. Esta guía se ejecuta después del review y merge manual de `feature/database-v1` en `Development`.

## Por qué SQL Server va en contenedor

Dokploy administra Docker Compose y sus bases integradas no incluyen Microsoft SQL Server. ELEVANT usa la imagen oficial Linux de SQL Server dentro de un Compose, con `/var/opt/mssql` en named volume. El contenedor hace reproducible motor/configuración; el volumen, los backups nativos y el restore probado protegen los datos. Recrear un contenedor no debe borrar el volumen, pero borrar el volumen sí es pérdida de datos.

SQL Server permanece sin dominio y sin `ports`. Solo API/migrator/seeder/ops entran por la red bridge interna. AVIAM Web, Public Web y Mobile nunca entran a esa red.

## Topología

```text
Tailscale HTTPS Services
  ├─ AVIAM Web     -> 127.0.0.1:18081 -> contenedor web (futuro)
  ├─ Public Web    -> 127.0.0.1:18082 -> contenedor Next (futuro)
  ├─ Elevant API   -> 127.0.0.1:18080 -> contenedor API (futuro)
  └─ Dokploy       -> 127.0.0.1:3000

                                     red elevant-dev-data (internal)
db release migrator/seeder ───────────────────┐
future Elevant API ───────────────────────────┼─> elevant-dev-sql:1433
db ops ───────────────────────────────────────┘          │
                                            named volume data + backups

tablet Android/iOS -- HTTPS/Tailscale --> Elevant API
```

Deployables separados:

1. `elevant-dev-database`: manual, sin AutoDeploy.
2. `elevant-dev-database-release`: one-shot por versión.
3. `elevant-dev-api`: futuro, auto-deploy controlado.
4. `elevant-dev-aviam-web`: futuro, Vite estático/Nginx.
5. `elevant-dev-public-web`: futuro, Next standalone.

Separarlos impide que un push/redeploy de una web o API recree SQL. Mobile se compila/distribuye, no es un stack.

## Prerrequisitos que deben confirmarse

- VPS Linux `amd64` con Dokploy, Docker y consola break-glass del proveedor.
- Los tres desarrolladores y la tablet de pruebas pueden instalar Tailscale actualizado (1.94+ recomendado para Services).
- Tailnet con MagicDNS, HTTPS y Services; host con identidad `tag:elevant-dev-host`.
- Distinción de miembros `dev` y `ops` para grants de aplicación vs panel/SSH.
- Namespace GHCR y credencial Dokploy `read:packages` si los packages son privados.
- CIDR bridge libre después de inspeccionar redes Docker existentes.
- Development continuará 100% sintético hasta disponer de backup externo.

## 1. Endurecer acceso antes de desplegar

1. Actualizar host y habilitar SSH con llave/cuenta no-root.
2. Unir VPS al tailnet con identidad etiquetada; confirmar SSH por Tailscale y consola de rescate.
3. Habilitar MagicDNS/HTTPS. Los nombres `.ts.net` aparecen en Certificate Transparency: use nombres no sensibles.
4. Configurar grants deny-by-default:
   - `dev` -> API, AVIAM Web y Public Web `tcp:443`;
   - `ops` -> esos servicios + Dokploy `tcp:443` + host SSH;
   - CI futuro -> endpoints de deploy/smoke estrictamente necesarios;
   - nadie -> SQL.
5. Usar firewall del proveedor. Mantener 1433 y 18080-18082 cerrados siempre; cerrar 3000/80/443 públicos y SSH público después de comprobar acceso privado. Docker puede saltarse reglas UFW, por eso se valida externamente el firewall del proveedor.
6. Mantener `tailscale funnel off`.

No anuncie toda la subnet de Dokploy/Docker: publica una superficie innecesaria. Tailscale Serve debe apuntar solo a los cuatro loopbacks previstos.

## 2. Publicar imágenes aprobadas

`backend-ci.yml` restaura dependencias bloqueadas, compila, prueba SQL real, comprueba drift, genera SQL revisable, valida Compose, construye y ejecuta ambos jobs contra SQL Server 2022. Solo si un push a `Development` supera todo, publica:

```text
ghcr.io/<namespace>/elevant-db-ops:sha-<commit>
ghcr.io/<namespace>/elevant-db-release:sha-<commit>
```

También existe alias `development`, pero Dokploy usa el digest resuelto del tag SHA. No se construye .NET/Next/Vite en el KVM.

## 3. Crear almacenamiento/red una sola vez

En consola del VPS, primero inspeccione todas las redes. Seleccione un CIDR sin conflicto y ejecute:

```bash
docker network create --driver bridge --internal --subnet <CIDR_APROBADO> elevant-dev-data
docker volume create elevant-dev-sql-data
docker volume create elevant-dev-sql-backups
```

Registre CIDR/gateway. El gateway exacto podrá usarse como proxy conocido en API; no confíe un `/16` amplio. No marque estos recursos como efímeros ni permita que un proyecto Dokploy los elimine.

## 4. Crear `elevant-dev-database`

- Tipo: Docker Compose normal, no Swarm Stack.
- Fuente: `backend/infrastructure/docker/compose.development.database.yml`.
- AutoDeploy: desactivado.
- Registry: GHCR configurado.
- Variables: siete contraseñas diferentes y `ELEVANT_DB_OPS_IMAGE` con digest.
- Ningún Domain de Dokploy.

El SQL oficial está fijado a `2022-CU26-ubuntu-22.04` + digest y usa `MSSQL_PID=Developer`. El provisioner espera el motor, crea `ElevantDevelopmentDb`, configura compatibilidad 160/Query Store/checksum/growth, crea marcador y logins mínimos, verifica DBA y deshabilita `sa`.

Validar tras el primer deploy desde un job/red privada:

- versión/edición esperadas;
- exactamente un marcador `Development`;
- logins app/migrator/seeder/health/backup funcionales en su función y rechazados fuera de ella;
- `sa` deshabilitado;
- sin puerto 1433 público;
- volumen conserva datos tras recrear solo el contenedor.

## 5. Ejecutar `elevant-dev-database-release`

- Fuente: `backend/infrastructure/docker/compose.development.release.yml`.
- Variables: imagen release con digest, cadena migrator, cadena seeder y password de cuenta demo.
- El migrator usa `elevant_dev_migrator`; el seed usa `elevant_dev_seeder`.
- Ambos declaran Development y validan marcador; el seeder depende del migrator exitoso.

No entregue al futuro contenedor API ninguna de esas credenciales. La API usa `elevant_dev_app`. Un fallo detiene la promoción; no se repara editando `__EFMigrationsHistory`.

Después valide migraciones aplicadas, seed sintético, idempotencia de un segundo seed y ausencia de datos del prototipo.

## 6. Backup y restore-check

Programar con Dokploy:

- nocturno: servicio `backup` profile `operations`;
- semanal: servicio `restore-check` profile `operations`;
- alertas de disco 70/80/90 %, manteniendo al menos 15 GB libres.

Backup usa full nativo `CHECKSUM + COMPRESSION`, `VERIFYONLY` y retención 7. Restore-check restaura realmente una base temporal y ejecuta `DBCC CHECKDB`. Snapshots/Volume Backup de Dokploy son complementarios; una captura de archivos SQL vivos no sustituye un backup consistente.

Sin copia off-host, una pérdida total del VPS solo se recupera con migraciones + seed. Esto es aceptable únicamente mientras Development sea descartable y sintético.

## 7. Publicar API y webs en una fase posterior

Cuando sus contratos estén listos:

| Deployable | Imagen/runtime | Bind host | Red de datos | Límite inicial |
| --- | --- | --- | --- | --- |
| API | ASP.NET no-root | `127.0.0.1:18080:8080` | sí | 768 MB / 0.60 CPU |
| AVIAM Web | build Vite + Nginx unprivileged | `127.0.0.1:18081:8080` | no | 128 MB / 0.15 CPU |
| Public Web | Next `standalone`, Node no-root | `127.0.0.1:18082:3000` | no | 512 MB / 0.35 CPU |

API usa `ASPNETCORE_ENVIRONMENT=Development`, health `/health`, readiness `/health/ready`, Swagger explícito y HTTPS redirection desactivado detrás de Serve. CORS contiene solo los dos orígenes HTTPS de las webs y localhost autorizado. Los valores `VITE_`/`NEXT_PUBLIC_` se hornean durante build y no son secretos.

Configure Services:

```bash
tailscale serve --service=svc:elevant-dev-api --https=443 127.0.0.1:18080
tailscale serve --service=svc:elevant-dev-aviam-web --https=443 127.0.0.1:18081
tailscale serve --service=svc:elevant-dev-public-web --https=443 127.0.0.1:18082
tailscale serve --service=svc:elevant-dev-dokploy --https=443 127.0.0.1:3000
tailscale serve status --json
```

El host debe estar etiquetado y los anuncios aprobados/auto-aprobados. No use headers de identidad Tailscale como autenticación funcional; API mantiene JWT/RBAC/tenant.

## Producción queda fuera de este VPS

Developer Edition no es licencia Production. Antes de diseñar el stack real se elige edición/licencia y se comprueba que el modelo no dependa de una feature exclusiva de Developer/Enterprise. Express es gratuito pero tiene límites que deben aceptarse; Standard requiere licencia válida. Production también exige backup cifrado off-host y restore ensayado antes de admitir datos.

No copie el Compose Development, no incluya seeder y no comparta host/volumen/secreto con Development.

## Referencias oficiales

- [Dokploy: Docker Compose y named volumes](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy: acceso privado con Tailscale y advertencia Docker/UFW](https://docs.dokploy.com/docs/core/guides/tailscale)
- [Tailscale Services](https://tailscale.com/docs/features/tailscale-services)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Microsoft: aplicar migraciones y crear bundles EF](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying)
- [Microsoft Artifact Registry: SQL Server Linux](https://mcr.microsoft.com/en-us/artifact/mar/mssql/server)
- [Microsoft: SQL Server en contenedores y licencias Production](https://learn.microsoft.com/en-us/sql/linux/containers/deploy?view=sql-server-ver17)
