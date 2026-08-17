# Elevant.DatabaseTool

One-shot database utility intended for deployment jobs, never for the API startup path.

Commands:

- `verify-target`: validates the connection-string database name and immutable environment marker.
- `seed-development`: performs the same validation and inserts deterministic synthetic fixtures without deleting or replacing existing rows.

Required environment variables:

- `ConnectionStrings__ElevantDatabase`
- `ELEVANT_DATABASE_ENVIRONMENT=Development|Production`
- `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb` for any Production invocation
- `ELEVANT_DEV_SEED_ACCOUNT_PASSWORD` only for `seed-development`; inject it from a secret store

There is intentionally no Production seed command.
