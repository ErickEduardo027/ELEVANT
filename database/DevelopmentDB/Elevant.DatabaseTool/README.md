# Elevant.DatabaseTool

Utilidad one-shot para jobs de base de datos. No se referencia desde el arranque de la API.

Comandos:

- `verify-target`: valida nombre físico, ambiente declarado y marcador inmutable.
- `seed-development`: repite la validación e inserta fixtures sintéticos idempotentes sin borrar/reemplazar filas existentes; solo reconcilia el lockout y las credenciales de las tres cuentas Development controladas.

Variables:

- `ConnectionStrings__ElevantDatabase`.
- `ELEVANT_DATABASE_ENVIRONMENT=Development|Production`.
- `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb` para cualquier invocación Production.
- `ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD`, `ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD` y
  `ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD` solo para `seed-development`,
  inyectadas como tres secretos distintos. Cada valor exige 14-256 caracteres,
  mayúscula, minúscula, número y símbolo; los marcadores conocidos del archivo de
  ejemplo se rechazan.

No existe comando de seed Production. `Dockerfile.database-release` publica esta herramienta junto al bundle EF. Su entrypoint ofrece `migrate`, `seed-development` y `verify-target`; `migrate` verifica el destino antes de ejecutar el bundle.
