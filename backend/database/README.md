# Operación de SQL Server

Esta carpeta contiene bootstrap, backup y verificación de recuperación. El esquema normal no se duplica aquí: pertenece a las migraciones EF de `Elevant.Infrastructure`.

## Contenido ejecutable

```text
Dockerfile.ops
scripts/bootstrap/provision-development.sql
scripts/bootstrap/initialize-production.sql
scripts/backup/backup-development.sql
scripts/recovery/restore-check-development.sql
scripts/diagnostics/verify-development.sql
scripts/container/*.sh
```

`Dockerfile.ops` hereda de la imagen oficial SQL Server 2022 fijada por tag CU y digest para disponer de `sqlcmd`. Incorpora los scripts dentro de la imagen; no los monta desde un checkout que Dokploy pueda reemplazar.

Comandos del contenedor:

- `initialize-backup-storage`: one-shot aislado que prepara el volumen de backups para UID/GID 10001; es el único comando que requiere override temporal a root con `CHOWN`/`FOWNER`.
- `provision-development`: espera SQL, crea/configura `ElevantDevelopmentDb`, marcador, schemas, logins/roles; verifica la cuenta DBA y deshabilita `sa`.
- `backup-development`: crea un full backup nativo en `.partial`, ejecuta `RESTORE VERIFYONLY`, lo publica atómicamente como `.bak` y conserva siete copias verificadas.
- `restore-check-development`: acepta solo nombres generados por el backup, restaura la copia más reciente en una base temporal aleatoria sin `WITH REPLACE`, valida marcador singleton, ejecuta `DBCC CHECKDB` y elimina solo la base creada por ese job.
- `verify-development`: certifica en modo solo lectura SQL Server 2022 Developer, el nombre y marcador exactos, la cadena de migraciones v1, las anclas deterministas del seed, la separación de permisos y que `sa` permanezca deshabilitado. Devuelve `0` solo si todas las comprobaciones pasan.

Tras provisionar, migrar y ejecutar dos veces el seed idempotente de Development, lance la verificación one-shot desde `backend/infrastructure/docker`:

```bash
docker compose --profile operations -f compose.development.database.yml run --rm verify-development
```

La verificación no modifica datos ni imprime valores de secretos. Los conteos exactos de anclas naturales y UUID deterministas hacen observable una duplicación o una ejecución incompleta del seed.

La certificación publicable se ejecuta desde la raíz del repositorio después de construir ambas imágenes con el mismo `VCS_REF`:

```powershell
./backend/scripts/certify-database-containers.ps1 `
  -OpsImage elevant-db-ops:ci `
  -ReleaseImage elevant-db-release:ci `
  -ExpectedRevision <commit> `
  -ExpectedSource https://github.com/ErickEduardo027/ELEVANT `
  -ProductionBootstrapPath backend/database/scripts/bootstrap/initialize-production.sql
```

La prueba crea y elimina su propia red, volúmenes y SQL Server; cubre instalación limpia Production sin datos, rechazo del seed, upgrade Development con dato centinela, reprovisionamiento con `sa` deshabilitado, seed doble, permisos, backup, restore + `DBCC CHECKDB` y persistencia al recrear SQL. CI ejecuta exactamente este gate antes de publicar GHCR.

`ProductionBootstrapPath` es opcional mientras se conserve la ubicación anterior. Cuando cambie la estructura del monorepo, permite indicar una fixture SQL de certificación mediante una ruta absoluta o relativa a la raíz del repositorio, sin depender del directorio de trabajo de CI. La ruta se valida como archivo `.sql` dentro del repositorio y se rechaza si apunta a `database/ProductionDB`: esa carpeta representa el futuro producto Production y debe permanecer vacía hasta que exista un plan aprobado. La fixture solo crea una base Production efímera dentro del Docker aislado de certificación; no provisiona ni despliega Production.

## Identidades de Development

| Identidad | Uso |
| --- | --- |
| `elevant_dev_dba` | operación excepcional, provisioning y restore-check |
| `elevant_dev_migrator` | bundle EF; `db_owner` solo en Development |
| `elevant_dev_app` | DML/execute por schemas de negocio, audit insert/select y lectura del marcador; sin `ALTER` ni acceso a historial EF |
| `elevant_dev_seeder` | DML de fixtures en schemas permitidos |
| `elevant_dev_health` | lectura mínima del marcador |
| `elevant_dev_backup` | `db_backupoperator` |

Cada contraseña debe ser distinta; el provisioner rechaza reutilización y exige 16-128 caracteres del conjunto seguro documentado en `.env.example`. Se entrega por secretos. El provisioner no rota una contraseña de un login existente: una rotación se ejecuta como operación DBA separada y verificada.

## Reglas

- Nunca versionar `.bak`, `.mdf`, `.ldf`, dumps, resultados de consultas o datos de Production.
- Nunca usar `sa`, DBA, migrator o seeder en la API.
- No montar datos SQL sobre el checkout; usar `/var/opt/mssql` en volumen nombrado.
- No publicar 1433 en VPS/Dokploy.
- Un backup no cuenta como recuperable hasta probar restore real + `DBCC CHECKDB`.
- Las operaciones SQL `BACKUP`/`RESTORE` comparten un bloqueo; un `.partial` nunca es elegible para restore. Aun así, el scheduler no debe solapar jobs completos.
- Los siete backups locales de Development no sobreviven a pérdida total del VPS. Mientras no exista copia off-host, Development solo admite datos sintéticos/reconstruibles.
- Production requiere licencia/edición, RPO/RTO, cifrado y destino off-host decididos antes de admitir datos reales.

Consulte `docs/database/migrations.md` y `docs/deployment/dokploy.md`.
