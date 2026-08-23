# Docker y Compose

## Imágenes

| Archivo | Resultado | Uso |
| --- | --- | --- |
| `backend/Dockerfile` | `elevant-api` | API .NET, usuario no-root, puerto 8080 |
| `backend/Dockerfile.database-release` | `elevant-db-release` | verificador, bundle EF linux-x64 y seed Development |
| `backend/database/Dockerfile.ops` | `elevant-db-ops` | bootstrap, backup y restore-check con `sqlcmd` |

SQL Server está fijado en el Compose y en la imagen ops a SQL Server 2022 CU26 Ubuntu 22.04 con digest aprobado. Actualizar CU/digest requiere PR, pruebas de migración limpia + upgrade, backup y restore-check; nunca se usa `2022-latest` en despliegue.

## Entorno local

```powershell
Copy-Item backend/.env.example backend/.env.local
# Sustituir todos los REPLACE_ME.
docker compose --env-file backend/.env.local -f backend/infrastructure/docker/compose.local.yml config --quiet
docker compose --env-file backend/.env.local -f backend/infrastructure/docker/compose.local.yml up --build
```

El orden local es SQL -> provisioner -> migrator -> seeder -> API. SQL se liga solo a `127.0.0.1:1433`, la API a `127.0.0.1:8080` y los datos viven en named volumes. `sa` se deshabilita tras verificar el DBA. No reutilice el archivo local como configuración de un VPS.

## Deployables Development

### 1. Datos: ciclo manual

`compose.development.database.yml` contiene SQL Server y el provisioner. No tiene `ports`, dominio, bind mount del repositorio ni build en el VPS. Usa:

- `elevant-dev-sql-data` para `/var/opt/mssql`;
- `elevant-dev-sql-backups` para backups nativos;
- red externa/internal `elevant-dev-data`;
- SQL Developer Edition, solo para desarrollo/pruebas;
- 4 GB/1.25 CPU de límite, 3072 MB de memoria interna SQL y `shm_size` 512 MB;
- logs rotados y 90 s de gracia de parada.

Antes de SQL, `backup-storage-init` usa el comando incluido en la misma imagen ops para preparar el volumen de backups como UID/GID 10001. Corre sin red, con todas las capacidades eliminadas salvo `CHOWN` y `FOWNER`. Esto evita que el volumen root-owned de Docker haga fallar el primer backup; SQL y los demás jobs siguen como `mssql` no-root. El Compose local aplica el mismo orden.

Antes del primer deploy, inspeccione subnets existentes y cree recursos una sola vez con un CIDR no conflictivo:

```bash
docker network ls
docker network inspect <redes-relevantes>
docker network create --driver bridge --internal --subnet <CIDR_APROBADO> elevant-dev-data
docker volume create elevant-dev-sql-data
docker volume create elevant-dev-sql-backups
```

No elimine/recree esos recursos en un deploy. El stack no usa AutoDeploy.

### 2. Release DB: por versión

`compose.development.release.yml` ejecuta `migrate` y luego
`seed-development`. Ambos usan `elevant-db-release@sha256:...`, credenciales
distintas y la red de datos. El fallo de migración impide el seed y debe impedir
desplegar la API nueva. El Compose sigue separado del ciclo de vida de SQL,
aunque el controlador Development lo invoque automáticamente.

No hay Compose Production en esta fase: su licencia, host, backup off-host y credenciales todavía deben aprobarse. Production aplicará la misma imagen/migraciones con su guard y jamás incluirá el servicio seeder.

## Imágenes y manifiesto inmutables

CI construye `elevant-db-ops:ci` y `elevant-db-release:ci` con las etiquetas OCI
`org.opencontainers.image.revision=<commit>` y
`org.opencontainers.image.source=<repositorio>`, y exige ambas durante la
certificación aislada contra SQL Server 2022. Un job separado —el único con
`packages: write`— reconstruye y vuelve a certificar las imágenes exactas que
publicará en un push DB-owned a `Development`. Publica tags
`sha-<commit>`/`development` y registra sus digests.

Después genera un manifiesto JSON con las dos referencias, hashes de Compose y
fingerprints de migraciones/modelo/seed. El manifiesto se valida, se empaqueta
como artefacto OCI privado y se publica al final con tag por commit; solo
entonces se mueve `development-certified`. Dokploy descubre ese alias, pero usa
únicamente las identidades por digest:

```text
ghcr.io/<namespace>/elevant-db-ops@sha256:<digest>
ghcr.io/<namespace>/elevant-db-release@sha256:<digest>
ghcr.io/<namespace>/elevant-db-release-manifest@sha256:<digest>
```

Los aliases mutables no se usan directamente en un deployment. Dokploy requiere
una credencial de registro con `read:packages` si los packages son privados.

## Variables remotas

| Grupo | Variables |
| --- | --- |
| SQL bootstrap | `MSSQL_SA_PASSWORD`, `ELEVANT_DB_DBA_PASSWORD`, `ELEVANT_DB_MIGRATOR_PASSWORD`, `ELEVANT_DB_APP_PASSWORD`, `ELEVANT_DB_SEEDER_PASSWORD`, `ELEVANT_DB_HEALTH_PASSWORD`, `ELEVANT_DB_BACKUP_PASSWORD` |
| Imágenes | `ELEVANT_DB_OPS_IMAGE`, `ELEVANT_DB_RELEASE_IMAGE` con digest |
| Release | `ELEVANT_MIGRATOR_CONNECTION_STRING`, `ELEVANT_SEEDER_CONNECTION_STRING`, `ELEVANT_DEV_SEED_ACCOUNT_PASSWORD` |

No ejecute `docker compose config` sin `--quiet` con secretos reales: la salida interpolada puede revelarlos. No use un único `env_file` compartido con la API.

## Operaciones

Las tareas manuales usan el mismo Compose/imagen aprobada:

```bash
docker compose --profile operations -f compose.development.database.yml run --rm backup
docker compose --profile operations -f compose.development.database.yml run --rm restore-check
```

En el VPS compartido, los jobs programados no llaman Compose directamente: se
redirigen a `ops/dokploy/database-cd/elevant-database-cd --backup` y
`--restore-check`. Así comparten el mismo lock que una promoción y usan el
último digest ops aceptado. Primero verifique espacio libre; no elimine la
última copia válida antes de crear/verificar la nueva.
