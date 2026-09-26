# Elevant.DatabaseTool

Utilidad one-shot para jobs de base de datos. No se referencia desde el arranque de la API.

Comandos:

- `verify-target`: valida nombre físico, ambiente declarado y marcador inmutable.
- `seed-development`: inserta fixtures sintéticos idempotentes sin borrar filas ni restablecer contraseñas existentes. Se detiene ante drift de identidad, credenciales ausentes o lockout deshabilitado.
- `rotate-development-human-resources`: recuperación manual de la contraseña sintética de Gestión Humana, limitada a Development. Nunca se ejecuta como parte del CD ni imprime el secreto.

Variables:

- `ConnectionStrings__ElevantDatabase`.
- `ELEVANT_DATABASE_ENVIRONMENT=Development|Production`.
- `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb` para cualquier invocación Production.
- `ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD`, `ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD`,
  `ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD`,
  `ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD`,
  `ELEVANT_DEV_CONTRACTS_ACCOUNT_PASSWORD` y
  `ELEVANT_DEV_FINANCE_ACCOUNT_PASSWORD` y
  `ELEVANT_DEV_SUPERADMIN_ACCOUNT_PASSWORD` para `seed-development`,
  inyectadas como siete secretos distintos. La rotación manual usa la contraseña
  de Gestión Humana y valida también que difiera de las otras cuentas sintéticas. Cada valor exige 14-256 caracteres,
  mayúscula, minúscula, número y símbolo; los marcadores conocidos del archivo de
  ejemplo se rechazan.

No existe comando de seed Production. `Dockerfile.database-release` publica esta herramienta junto al bundle EF. Su entrypoint ofrece `migrate`, `seed-development`, `rotate-development-human-resources` y `verify-target`; `migrate` verifica el destino antes de ejecutar el bundle.
