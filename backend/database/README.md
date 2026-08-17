# Operación de SQL Server

Esta carpeta contiene bootstrap, backup y verificación de recuperación. El esquema normal no se duplica aquí: pertenece a las migraciones EF de `Elevant.Infrastructure`.

## Contenido ejecutable

```text
Dockerfile.ops
scripts/bootstrap/provision-development.sql
scripts/bootstrap/initialize-production.sql
scripts/backup/backup-development.sql
scripts/recovery/restore-check-development.sql
scripts/container/*.sh
```

`Dockerfile.ops` hereda de la imagen oficial SQL Server 2022 fijada por tag CU y digest para disponer de `sqlcmd`. Incorpora los scripts dentro de la imagen; no los monta desde un checkout que Dokploy pueda reemplazar.

Comandos del contenedor:

- `provision-development`: espera SQL, crea/configura `ElevantDevelopmentDb`, marcador, schemas, logins/roles; verifica la cuenta DBA y deshabilita `sa`.
- `backup-development`: crea un full backup nativo con `COPY_ONLY`, `CHECKSUM` y `COMPRESSION`, ejecuta `RESTORE VERIFYONLY` y conserva siete copias válidas.
- `restore-check-development`: restaura la copia más reciente en una base temporal, valida marcador, ejecuta `DBCC CHECKDB` y elimina solo esa base temporal exacta.

## Identidades de Development

| Identidad | Uso |
| --- | --- |
| `elevant_dev_dba` | operación excepcional, provisioning y restore-check |
| `elevant_dev_migrator` | bundle EF; `db_owner` solo en Development |
| `elevant_dev_app` | DML/execute por schemas de negocio, audit insert/select y lectura del marcador; sin `ALTER` ni acceso a historial EF |
| `elevant_dev_seeder` | DML de fixtures en schemas permitidos |
| `elevant_dev_health` | lectura mínima del marcador |
| `elevant_dev_backup` | `db_backupoperator` |

Cada contraseña es distinta, se entrega por secretos y debe tener 16-128 caracteres del conjunto seguro documentado en `.env.example`. El provisioner no rota una contraseña de un login existente: una rotación se ejecuta como operación DBA separada y verificada.

## Reglas

- Nunca versionar `.bak`, `.mdf`, `.ldf`, dumps, resultados de consultas o datos de Production.
- Nunca usar `sa`, DBA, migrator o seeder en la API.
- No montar datos SQL sobre el checkout; usar `/var/opt/mssql` en volumen nombrado.
- No publicar 1433 en VPS/Dokploy.
- Un backup no cuenta como recuperable hasta probar restore real + `DBCC CHECKDB`.
- Los siete backups locales de Development no sobreviven a pérdida total del VPS. Mientras no exista copia off-host, Development solo admite datos sintéticos/reconstruibles.
- Production requiere licencia/edición, RPO/RTO, cifrado y destino off-host decididos antes de admitir datos reales.

Consulte `docs/database/migrations.md` y `docs/deployment/dokploy.md`.
