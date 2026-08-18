# Elevant.DatabaseTool

Utilidad one-shot para jobs de base de datos. No se referencia desde el arranque de la API.

Comandos:

- `verify-target`: valida nombre físico, ambiente declarado y marcador inmutable.
- `seed-development`: repite la validación e inserta fixtures sintéticos idempotentes sin borrar/reemplazar filas existentes.

Variables:

- `ConnectionStrings__ElevantDatabase`.
- `ELEVANT_DATABASE_ENVIRONMENT=Development|Production`.
- `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb` para cualquier invocación Production.
- `ELEVANT_DEV_SEED_ACCOUNT_PASSWORD` solo para `seed-development`, inyectada desde secretos.

No existe comando de seed Production. `Dockerfile.database-release` publica esta herramienta junto al bundle EF. Su entrypoint ofrece `migrate`, `seed-development` y `verify-target`; `migrate` verifica el destino antes de ejecutar el bundle.
