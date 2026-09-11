# Implementación Development en VPS con Dokploy

Estado: DB v1, API, AVIAM Web y Public Web están desplegadas y verificadas en el
VPS Development privado, cada una con su CD pull-based activo. El hardening,
Tailscale, observabilidad, backup/restore programados, los drills web B -> A -> B
y el reboot final ya fueron aceptados. Mobile Agent continúa fuera del VPS y
SQL Tools permanece como acceso humano opcional pendiente de rollout manual. La
secuencia reproducible con checkpoints y rollback está en
[Configuración de Dokploy](dokploy-configuration.md).

## Por qué SQL Server va en contenedor

Dokploy administra Docker Compose y sus bases integradas no incluyen Microsoft SQL Server. ELEVANT usa la imagen oficial Linux de SQL Server dentro de un Compose, con `/var/opt/mssql` en named volume. El contenedor hace reproducible motor/configuración; el volumen, los backups nativos y el restore probado protegen los datos. Recrear un contenedor no debe borrar el volumen, pero borrar el volumen sí es pérdida de datos.

SQL Server permanece sin dominio y sin `ports`. Solo API/migrator/seeder/ops y,
cuando se habilite, el gateway SQL Tools entran por la red bridge interna. El
gateway usa además una bridge no interna exclusiva para materializar su binding
loopback; SQL nunca entra a esa segunda red. AVIAM Web, Public Web y Mobile
nunca entran a la red de datos.
El único acceso humano opcional es el gateway SSMS Development de
[ADR-0013](../adr/0013-development-ssms-data-access.md): un recurso separado,
sin credenciales, que comparte esa red y publica solo un loopback para un
Service Tailscale dedicado.

## Topología

```text
Tailscale Services
  ├─ AVIAM Web     -> 127.0.0.1:18081 -> contenedor web (live; CD aceptado)
  ├─ Public Web    -> 127.0.0.1:18082 -> contenedor Next (live; CD aceptado)
  ├─ Elevant API   -> 127.0.0.1:18080 -> contenedor API
  ├─ Dokploy       -> 127.0.0.1:3000
  ├─ Monitoring    -> 127.0.0.1:18083
  └─ SQL Tools TCP -> 127.0.0.1:11433 -> gateway sin credenciales (opcional)

                                     red elevant-dev-data (internal)
db release migrator/seeder ───────────────────┐
Elevant API ──────────────────────────────────┼─> elevant-dev-sql:1433
db ops ───────────────────────────────────────┤          │
gateway SQL Tools ────────────────────────────┘          │
                                             named volume data + backups

gateway SQL Tools ── elevant-dev-sql-tools-runtime
                     (bridge no interna, solo publicación loopback)

tablet Android/iOS -- HTTPS/Tailscale --> Elevant API
```

Deployables separados:

1. `elevant-dev-database`: manual, sin AutoDeploy.
2. `elevant-dev-database-release`: one-shot por versión.
3. `elevant-dev-api`: Compose independiente, CD pull-based controlado.
4. `elevant-dev-aviam-web`: Vite estático/Nginx, runtime y Web CD aceptados.
5. `elevant-dev-public-web`: Next standalone, runtime y Web CD aceptados.
6. `elevant-dev-sql-tools-gateway`: proxy TCP opcional para SSMS Development,
   sin AutoDeploy ni credenciales.

Separarlos impide que un push/redeploy de una web o API recree SQL. Mobile se compila/distribuye, no es un stack.

## Prerrequisitos que deben confirmarse

- VPS Linux `amd64` con Dokploy, Docker y consola break-glass del proveedor.
- Los tres desarrolladores y la tablet de pruebas pueden instalar Tailscale actualizado (1.94+ obligatorio para este contrato de Services).
- Tailnet con MagicDNS, HTTPS y Services; host con identidad `tag:elevant-dev-host`.
- Distinción de miembros `dev`, `db-editors` y `ops` para grants de aplicación,
  SSMS y panel/SSH.
- Namespace GHCR y credencial Dokploy `read:packages` si los packages son privados.
- CIDR bridge libre por cada red nueva después de inspeccionar redes Docker
  existentes.
- Development continuará 100% sintético hasta disponer de backup externo.

## 1. Endurecer acceso antes de desplegar

1. Actualizar host y habilitar SSH con llave/cuenta no-root.
2. Unir VPS al tailnet con identidad etiquetada; confirmar SSH por Tailscale y consola de rescate.
3. Habilitar MagicDNS/HTTPS. Los nombres `.ts.net` aparecen en Certificate Transparency: use nombres no sensibles.
4. Configurar grants deny-by-default:
   - `dev` -> API, AVIAM Web y Public Web `tcp:443`;
   - `ops` -> esos servicios + Dokploy `tcp:443` + host SSH;
   - `db-editors` -> únicamente `svc:elevant-dev-sql-tools` `tcp:1433`;
   - GitHub Actions/CI -> ningún acceso al tailnet o al VPS; los controladores
     privados descubren los artefactos por pull;
   - nadie -> puertos SQL/gateway directos del host.
5. Usar firewall del proveedor. Mantener 1433 y 18080-18082 cerrados siempre; cerrar 3000/80/443 públicos y SSH público después de comprobar acceso privado. Docker puede saltarse reglas UFW, por eso se valida externamente el firewall del proveedor.
6. Mantener `tailscale funnel off`.

No anuncie toda la subnet de Dokploy/Docker: publica una superficie innecesaria.
Tailscale Serve debe apuntar solo a los seis loopbacks previstos: Dokploy,
monitoreo, API, AVIAM Web, Public Web y el gateway SQL Tools opcional. Los cinco
primeros son HTTP/HTTPS; SQL Tools es TCP crudo y nunca apunta directamente al
contenedor SQL.

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

Al habilitar SQL Tools, cree además una bridge no interna dedicada. No conecte
SQL ni ningún otro workload a ella:

```bash
docker network create --driver bridge \
  --subnet <CIDR_RUNTIME_APROBADO> \
  --gateway <GATEWAY_RUNTIME_APROBADO> \
  --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
  elevant-dev-sql-tools-runtime
```

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
persistente. Poll y promociones fallan cerrado sin esperar; backup y
restore-check esperan hasta 900 segundos por el lock para que una carrera en el
segundo `:00` no les haga perder su única ventana. Nunca se solapan operaciones
SQL. Agotar ese timeout es un fallo operativo visible, no un backup exitoso.
Backup/restore usan la imagen ops y el Compose database cacheado de la última
entrega aceptada, no un alias mutable, el Raw vivo ni un candidato fallido.

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

Backup usa full nativo `CHECKSUM + COMPRESSION`, escribe primero `.partial`, ejecuta `VERIFYONLY` y solo entonces publica `.bak` para la retención 7. Las operaciones SQL `BACKUP`/`RESTORE` comparten bloqueo; el controlador las serializa aunque Dokploy inicie schedules simultáneos. Restore-check acepta exclusivamente el patrón seguro generado, usa una base temporal aleatoria sin `WITH REPLACE`, comprueba marcador singleton y ejecuta `DBCC CHECKDB`. Snapshots/Volume Backup de Dokploy son complementarios; una captura de archivos SQL vivos no sustituye un backup consistente.

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
Serve. Usa únicamente el login `elevant_dev_app`. CORS acepta los orígenes
HTTPS exactos de AVIAM Web y Public Web mediante
`ELEVANT_API_PRIVATE_WEB_ORIGIN` y `ELEVANT_API_PUBLIC_WEB_ORIGIN`, sin `/`
final, más los puertos locales `5173` y `3000`; Mobile Agent no necesita CORS.
`AllowedHosts` contiene el host de API, no los hosts cliente. Una red bridge
propia proporciona salida y `elevant-dev-data` conserva SQL aislado.

## 8. Publicar las webs Development

Esta sección conserva el rollout ya aceptado como runbook de reconstrucción y
actualización. AVIAM Web y Public Web permanecen desplegadas en recursos y
estados independientes; el orden de una reconstrucción sigue siendo primero
AVIAM Web y después Public Web.

Los valores `VITE_*`/`NEXT_PUBLIC_*` se hornean durante build, son públicos y no
pueden contener secretos. GitHub Actions toma los orígenes HTTPS exactos de
estas variables de repositorio, sin escribir nombres vivos en las plantillas:

```text
ELEVANT_DEV_API_ORIGIN
ELEVANT_DEV_AVIAM_WEB_ORIGIN
ELEVANT_DEV_PUBLIC_WEB_ORIGIN
```

CI construye/certifica fuera del VPS y publica dos imágenes independientes por
digest, más un bundle OCI v1 por aplicación:

```text
elevant-private-web  -> elevant-aviam-web-release-manifest
elevant-public-web   -> elevant-public-web-release-manifest
```

Cada bundle contiene `/manifest.json` y
`/compose/compose.development.web.yml`, fija la imagen web, hashes de Compose y
configuración, y la entrega API exacta usada durante build. Su alias
`development-certified` solo se mueve después de extraer y comparar ambos
payloads; nunca es identidad de despliegue.

El operador aplica el runbook de
[`ops/dokploy/web-cd`](../../ops/dokploy/web-cd/README.md) una aplicación a la
vez:

1. Esperar el PR fusionado, CI verde, imagen y bundle certificado del carril.
2. Confirmar DB/API saludables, API-CD `succeeded/complete`, locks libres,
   recursos suficientes y el puerto loopback objetivo libre.
3. Crear una bridge externa runtime exclusiva para esa web. No reutilizar
   `elevant-dev-data`, `dokploy-network` ni la red de la otra web.
4. Crear un recurso **Docker Compose / Raw**, sin Domain y con AutoDeploy
   desactivado; guardar su Environment root-only y desplegar inicialmente solo
   la referencia de imagen certificada `@sha256:`.
5. Exigir runtime no-root, filesystem read-only, límites, una sola red runtime,
   health/smoke y listener exacto:
   - AVIAM Web: `127.0.0.1:18081:8080`;
   - Public Web: `127.0.0.1:18082:3000`.
6. Publicar el Service Tailscale ya reservado hacia ese loopback, probar acceso
   de los grupos autorizados, denegación pública y Funnel desactivado.
7. Instalar/actualizar manualmente el paquete genérico `web-cd`, configurar el
   perfil root-only, ejecutar `verify-runtime`, `--dry-run` y
   `--adopt-current`. La adopción no vuelve a desplegar la baseline.
8. Crear el schedule deshabilitado y mantenerlo así. Con una entrega B
   estrictamente posterior a la baseline A, instalar o actualizar el controlador
   que incluye el drill seguro, validar runtime, pausar el perfil y ejecutar
   `--dry-run`.
9. Ejecutar contra el digest exacto anunciado
   `--promote-with-rollback-drill sha256:<DIGEST_EXACTO>`. El comando precarga y
   valida todo antes de mutar, exige la misma tupla API exacta en A/B/activa y
   prueba B -> A -> B con `--pull never`, health y smokes en cada tramo.
10. Exigir que el resultado conserve el perfil pausado y registre
    `succeeded/complete` con `rollbackStatus=succeeded`; volver a comprobar
    runtime, listener loopback, aislamiento de red y que DB, API y la otra web
    no se recrearon. Un fallo queda pausado, restaura A cuando es posible y
    requiere una decisión explícita del operador. Si la API exacta cambió, la
    recuperación se difiere sin mutar la web; el mismo digest debe reintentarse
    después de restaurar esa API y `--resume` continúa bloqueado entre tanto.
    También bloquea cualquier rollback fallido o fallo terminal del drill. Una
    promoción ordinaria interrumpida usa su recuperación ordinaria al primer
    `--resume` o al siguiente `--poll` si todavía no estaba pausada. En ambos
    casos permanece pausada para revisión y solo se reanuda con una invocación
    posterior de `--resume`; todo poll posterior a la pausa es un no-op absoluto.
11. Reanudar solo después de aceptar el drill, ejecutar manualmente el job aún
    deshabilitado y exigir un no-op. Entonces habilitar el schedule, comprobar
    su primer no-op automático, repetir el proceso completo para la segunda web
    y validar persistencia tras reboot.

Los perfiles `aviam-web` y `public-web` conservan estado, cache, pausa y
rollback separados. Ambos exigen que digest de bundle, `runId`, imagen y hash
OpenAPI coincidan con la API activa. Un candidato que requiere otra API se
difiere sin mutar el servicio. Los polls son cada minuto con offset de 30
segundos para AVIAM Web y 45 para Public Web; la jerarquía de locks
`database -> API -> web común -> perfil` sigue siendo autoritativa.

Los Services se configuran solo después de validar el listener local:

```bash
tailscale serve --service=svc:elevant-dev-aviam-web --https=443 http://127.0.0.1:18081
tailscale serve --service=svc:elevant-dev-public-web --https=443 http://127.0.0.1:18082
tailscale serve status --json
tailscale funnel status
```

No use headers de identidad Tailscale como autenticación funcional. El rollout
inicial ofrece previews técnicos: la API todavía no implementa todos los
endpoints de autenticación y negocio usados por los prototipos. Una shell o
health saludable no demuestra que esos flujos sean funcionales. Los adaptadores
pendientes apuntan a la API real para fallar de forma visible; nunca se despliega
`backend-prototipo` ni se usa el localhost del navegador como backend remoto.

Mobile Agent no se instala en el VPS. Se prueba en emulador/tablet y se
distribuye por APK/EAS en su ciclo propio.

## Producción queda fuera de este VPS

Developer Edition no es licencia Production. Antes de diseñar el stack real se elige edición/licencia y se comprueba que el modelo no dependa de una feature exclusiva de Developer/Enterprise. Express es gratuito pero tiene límites que deben aceptarse; Standard requiere licencia válida. Production también exige backup cifrado off-host y restore ensayado antes de admitir datos.

No copie el Compose Development, no incluya seeder y no comparta host/volumen/secreto con Development.

## Referencias oficiales

- [Decisión ELEVANT: CD pull-based web Development](../adr/0012-pull-based-web-development-cd.md)
- [Dokploy: Docker Compose y named volumes](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy: acceso privado con Tailscale y advertencia Docker/UFW](https://docs.dokploy.com/docs/core/guides/tailscale)
- [Tailscale Services](https://tailscale.com/docs/features/tailscale-services)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Next.js: despliegue `standalone`](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Microsoft: aplicar migraciones y crear bundles EF](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying)
- [Microsoft Artifact Registry: SQL Server Linux](https://mcr.microsoft.com/en-us/artifact/mar/mssql/server)
- [Microsoft: SQL Server en contenedores y licencias Production](https://learn.microsoft.com/en-us/sql/linux/containers/deploy?view=sql-server-ver17)
