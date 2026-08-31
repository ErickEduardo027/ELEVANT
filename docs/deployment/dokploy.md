# Implementación Development en VPS con Dokploy

Estado: DB v1 está desplegada y verificada en el VPS Development privado. El
hardening, Tailscale, observabilidad, backup/restore programados y snapshot frío
fueron aceptados el 2026-08-23. El controlador pull-based fue instalado y
aceptado manualmente por el operador el 2026-08-31 UTC; desde entonces promueve
automáticamente bundles DB certificados de `Development`. La API y los tres
frontends continúan fuera del VPS hasta completar sus handoffs. La imagen,
bundle y controlador pull-based de la API se versionan por separado y no
autorizan su instalación remota. La secuencia reproducible con checkpoints y
rollback está en
[Configuración de Dokploy](dokploy-configuration.md).

## Por qué SQL Server va en contenedor

Dokploy administra Docker Compose y sus bases integradas no incluyen Microsoft SQL Server. ELEVANT usa la imagen oficial Linux de SQL Server dentro de un Compose, con `/var/opt/mssql` en named volume. El contenedor hace reproducible motor/configuración; el volumen, los backups nativos y el restore probado protegen los datos. Recrear un contenedor no debe borrar el volumen, pero borrar el volumen sí es pérdida de datos.

SQL Server permanece sin dominio y sin `ports`. Solo API/migrator/seeder/ops entran por la red bridge interna. AVIAM Web, Public Web y Mobile nunca entran a esa red.

## Topología

```text
Tailscale HTTPS Services
  ├─ AVIAM Web     -> 127.0.0.1:18081 -> contenedor web (futuro)
  ├─ Public Web    -> 127.0.0.1:18082 -> contenedor Next (futuro)
  ├─ Elevant API   -> 127.0.0.1:18080 -> contenedor API
  └─ Dokploy       -> 127.0.0.1:3000

                                     red elevant-dev-data (internal)
db release migrator/seeder ───────────────────┐
Elevant API ──────────────────────────────────┼─> elevant-dev-sql:1433
db ops ───────────────────────────────────────┘          │
                                            named volume data + backups

tablet Android/iOS -- HTTPS/Tailscale --> Elevant API
```

Deployables separados:

1. `elevant-dev-database`: manual, sin AutoDeploy.
2. `elevant-dev-database-release`: one-shot por versión.
3. `elevant-dev-api`: Compose independiente, CD pull-based controlado.
4. `elevant-dev-aviam-web`: futuro, Vite estático/Nginx.
5. `elevant-dev-public-web`: futuro, Next standalone.

Separarlos impide que un push/redeploy de una web o API recree SQL. Mobile se compila/distribuye, no es un stack.

## Prerrequisitos que deben confirmarse

- VPS Linux `amd64` con Dokploy, Docker y consola break-glass del proveedor.
- Los tres desarrolladores y la tablet de pruebas pueden instalar Tailscale actualizado (1.94+ obligatorio para este contrato de Services).
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

No anuncie toda la subnet de Dokploy/Docker: publica una superficie innecesaria. Tailscale Serve debe apuntar solo a los cinco loopbacks previstos: Dokploy, monitoreo y, cuando existan, API, AVIAM Web y Public Web.

## 2. Publicar imágenes y bundle aprobados

`backend-ci.yml` restaura dependencias bloqueadas, compila, prueba SQL real,
comprueba drift, genera SQL revisable, valida Compose y construye ambas imágenes
con la revisión OCI del commit. Después ejecuta el mismo certificador
publicable: Production limpio y sin seed, upgrade Development conservando un
centinela, reprovisionamiento, seed idempotente, permisos, backup, restore con
`DBCC CHECKDB` y persistencia al recrear SQL Server 2022.

En un push DB-owned a `Development`, un job separado con permiso GHCR
reconstruye y vuelve a certificar exactamente lo que publicará:

```text
ghcr.io/<namespace>/elevant-db-ops:sha-<commit>
ghcr.io/<namespace>/elevant-db-release:sha-<commit>
```

CI obtiene los dos digests y genera un manifiesto estricto con la revisión,
ejecución, hashes de Compose y fingerprints de migraciones/modelo/seed. Después
empaqueta en un único bundle OCI v1 el manifiesto y los bytes exactos de
`compose.development.database.yml` y `compose.development.release.yml`, y lo
publica como un tercer artefacto privado:

```text
ghcr.io/<namespace>/elevant-db-release-manifest:sha-<commit>-run-<run>-attempt-<intento>
ghcr.io/<namespace>/elevant-db-release-manifest:development-certified
```

El bundle expone `/manifest.json` y ambos Compose bajo `/compose/`, declara
`bundle-version=1` y el media type
`application/vnd.elevant.database-release-bundle.v1`. CI vuelve a extraer los
tres payloads y exige igualdad byte a byte. `development-certified` se mueve
como último paso. Si build, certificación, publicación o validación falla, el
controlador no descubre una entrega parcial.

Los aliases son mutables y sirven solo para descubrimiento. El controlador
resuelve el digest del bundle, valida etiquetas, manifiesto y hashes, guarda los
Compose por contenido y ejecuta las dos referencias `@sha256:...` incluidas con
los Compose certificados. Antes de SQL compara el modelo Compose canónico con
los Raw vivos de Dokploy: formato y comentarios pueden variar, la semántica no.
No se construye .NET/Next/Vite en el KVM.

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
- Provider: Raw, pegado desde el commit aprobado y validado por SHA-256 según [Configuración de Dokploy](dokploy-configuration.md); no una rama mutable.
- Fuente certificada: `database/DevelopmentDB/compose.development.database.yml`.
- AutoDeploy: desactivado.
- Registry: GHCR configurado.
- Variables: siete contraseñas diferentes y `ELEVANT_DB_OPS_IMAGE` con digest.
- Ningún Domain de Dokploy.

El SQL oficial está fijado a `2022-CU26-ubuntu-22.04` + digest y usa `MSSQL_PID=Developer`. Un one-shot sin red prepara el volumen de backups para UID/GID 10001 con solo `CHOWN`/`FOWNER`; SQL no corre como root. El provisioner espera el motor, crea `ElevantDevelopmentDb`, configura compatibilidad 160/Query Store/checksum/growth, crea marcador y logins mínimos, verifica DBA y deshabilita `sa`.

Validar tras el primer deploy desde un job/red privada:

- versión/edición esperadas;
- exactamente un marcador `Development`;
- logins app/migrator/seeder/health/backup funcionales en su función y rechazados fuera de ella;
- `sa` deshabilitado;
- sin puerto 1433 público;
- volumen conserva datos tras recrear solo el contenedor.

## 5. Ejecutar `elevant-dev-database-release`

- Provider: Raw, con la misma verificación de revisión, hash y Preview Compose.
- Fuente certificada: `database/DevelopmentDB/compose.development.release.yml`.
- AutoDeploy: desactivado; Git/Dokploy no reconstruye este Compose ni SQL.
- Variables: imagen release con digest, cadena migrator, cadena seeder y password de cuenta demo.
- El migrator usa `elevant_dev_migrator`; el seed usa `elevant_dev_seeder`.
- Ambos declaran Development y validan marcador; el seeder depende del migrator exitoso.

El comando Compose detached de Dokploy solo confirma que pudo iniciar los
contenedores. Espere su terminación y compruebe en la vista de servicios o con
`docker compose ps -a` que `migrator` y `seeder-development` finalizaron con
`Exit 0`; cualquier otro estado detiene la promoción. No entregue al futuro
contenedor API ninguna de esas credenciales. La API usa `elevant_dev_app`. Un
fallo no se repara editando `__EFMigrationsHistory`.

Después valide migraciones aplicadas, seed sintético, idempotencia de un segundo seed y ausencia de datos del prototipo.

Este procedimiento manual establece/adopta la primera versión viva. Para las
versiones posteriores, instale el controlador de
[`ops/dokploy/database-cd`](../../ops/dokploy/database-cd/README.md) y registre
los paths/proyectos exactos de ambos Compose. El controlador no pulsa Deploy ni
edita el provider Raw: usa esos paths para el gate semántico, pero invoca los
servicios one-shot desde los Compose cacheados por hash y con variables de
imagen por digest. Conserva separado el contenedor SQL y registra el último
bundle aceptado.

## 6. Backup y restore-check

Prerequisito de seguridad: antes de habilitar jobs internos `dokploy-server`, el panel debe estar aislado por Tailscale, limitado a `ops` y la versión efectiva debe contrastarse contra **todos** los advisories vigentes. El VPS auditado usa Dokploy `v0.30.0`; no se acepta volver a una versión anterior. El umbral histórico `>0.26.7` no basta: `v0.29.13` todavía permitía un escape al host para un miembro autenticado con `domain:create`, corregido en `v0.30.0`. Consulte [GHSA-7wmr-57mg-h5q6](https://github.com/Dokploy/dokploy/security/advisories/GHSA-7wmr-57mg-h5q6), la [corrección posterior](https://github.com/Dokploy/dokploy/pull/4872) y el [release v0.30.0](https://github.com/Dokploy/dokploy/releases/tag/v0.30.0). La creación y ejecución de jobs continúa siendo exclusiva de `ops` aunque la versión esté corregida.

Los servicios `backup` y `restore-check` son contenedores one-shot bajo el profile
`operations`; no permanecen ejecutándose. No los programe como Compose Job: ese
tipo de job usa `docker exec` y exige un contenedor activo. En la página global
**Schedules**, deje el filtro sin servidor externo y use jobs internos
`dokploy-server`; así el script corre dentro del contenedor Dokploy e invoca
`docker compose run --rm` mediante el socket Docker del nodo.

Después del primer deploy, copie del log de despliegue los valores exactos de
proyecto, Compose y `.env` de ambos recursos. Instálelos una sola vez en el
archivo root-only del controlador, valide el bundle con `--dry-run` y ejecute
`--adopt-current`; no copie contraseñas ni connection strings a sus scripts. La
adopción guarda los Compose vivos por hash en `state/compose/` antes de aceptar
la baseline.

Los tres jobs internos `dokploy-server` llaman el mismo ejecutable persistente que está
montado dentro del contenedor Dokploy:

```bash
/etc/dokploy/elevant/database-cd/elevant-database-cd --poll
/etc/dokploy/elevant/database-cd/elevant-database-cd --backup
/etc/dokploy/elevant/database-cd/elevant-database-cd --restore-check
```

`--poll` se programa cada minuto. El job de backup conserva 02:15 UTC y el de
restore-check domingo 04:30 UTC. Los tres comparten `flock` y el estado
persistente: si una promoción está activa, la operación programada no puede
solaparse. Backup/restore usan la imagen ops y el Compose database cacheado de
la última entrega aceptada, no un alias mutable, el Raw vivo ni un candidato
fallido.

Reglas del scheduler:

- nocturno, fuera del horario de trabajo: `--backup`;
- semanal y sin solaparse con el backup: `--restore-check`;
- no activar `set -x`, no pegar secretos en el script y limitar la inspección
  de configuración a `compose config --images`;
- mantener todos los valores de imagen con `@sha256:<digest>` y restringir
  configuración, logs/jobs y token de commit status a operadores;
- mientras las alertas estén diferidas, revisar disco diariamente; al aprobarlas,
  usar un único umbral mayor a 80 % durante 10 minutos y mantener al menos
  15 GB libres.

Primero ejecute ambos jobs manualmente y exija código cero. `restore-check`
restaura una base temporal, valida su marcador, ejecuta `DBCC CHECKDB` y la
elimina. Después habilite los cron y verifique sus primeras ejecuciones desde
los logs de Dokploy.

Backup usa full nativo `CHECKSUM + COMPRESSION`, escribe primero `.partial`, ejecuta `VERIFYONLY` y solo entonces publica `.bak` para la retención 7. Las operaciones SQL `BACKUP`/`RESTORE` comparten bloqueo y el scheduler no solapa jobs completos. Restore-check acepta exclusivamente el patrón seguro generado, usa una base temporal aleatoria sin `WITH REPLACE`, comprueba marcador singleton y ejecuta `DBCC CHECKDB`. Snapshots/Volume Backup de Dokploy son complementarios; una captura de archivos SQL vivos no sustituye un backup consistente.

Sin copia off-host, una pérdida total del VPS solo se recupera con migraciones + seed. Esto es aceptable únicamente mientras Development sea descartable y sintético.

## 7. Publicar la API Development

La API se prepara antes que los clientes para que el equipo pueda desarrollar
contra una URL compartida. La primera entrega es un scaffold privado: health,
readiness, ping, Swagger y hubs aún sin operaciones de negocio. No se publica a
Internet ni se considera autenticada por estar detrás de Tailscale.

| Deployable | Imagen/runtime | Bind host | Red de datos | Límite inicial |
| --- | --- | --- | --- | --- |
| API | ASP.NET no-root | `127.0.0.1:18080:8080` | sí | 768 MB / 0.60 CPU |
| AVIAM Web | build Vite + Nginx unprivileged | `127.0.0.1:18081:8080` | no | 128 MB / 0.15 CPU |
| Public Web | Next `standalone`, Node no-root | `127.0.0.1:18082:3000` | no | 512 MB / 0.35 CPU |

GitHub Actions construye y prueba la imagen API una sola vez, la publica por
digest y mueve al final el alias de un bundle OCI certificado. Ese bundle fija
el Compose y la compatibilidad DB. El controlador privado
[`ops/dokploy/api-cd`](../../ops/dokploy/api-cd/README.md) espera primero el
estado aceptado por `database-cd`, despliega el digest y valida health,
readiness, ping y Swagger. Dokploy usa Compose Raw con AutoDeploy desactivado;
no usa el provider GitHub para compilar o desplegar en el VPS.

API usa `ASPNETCORE_ENVIRONMENT=Development`, health `/health`, readiness
`/health/ready`, Swagger habilitado y HTTPS redirection desactivado detrás de
Serve. Usa únicamente el login `elevant_dev_app`. CORS contiene localhost
autorizado; los orígenes HTTPS de las webs se agregan cuando estas existan. Una
red bridge propia proporciona salida y `elevant-dev-data` conserva SQL aislado.

## 8. Publicar las webs en una fase posterior

Los valores `VITE_`/`NEXT_PUBLIC_` se hornean durante build y no son secretos.
Las webs no se conectan a `elevant-dev-data` y quedan fuera del rollout API.

Configure Services:

```bash
tailscale serve --service=svc:elevant-dev-api --https=443 http://127.0.0.1:18080
tailscale serve --service=svc:elevant-dev-aviam-web --https=443 http://127.0.0.1:18081
tailscale serve --service=svc:elevant-dev-public-web --https=443 http://127.0.0.1:18082
tailscale serve --service=svc:elevant-dev-dokploy --https=443 http://127.0.0.1:3000
tailscale serve status --json
```

El host debe estar etiquetado y los anuncios aprobados/auto-aprobados. No use
headers de identidad Tailscale como autenticación funcional. El scaffold actual
aún no implementa JWT/RBAC/tenant y por eso permanece estrictamente privado;
esos controles serán obligatorios antes de exponer contratos de negocio.

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
