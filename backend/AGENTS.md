# Backend agent guide

This directory owns Elevant's .NET 10 modular monolith and shared API. The SQL Server model, migrations and database release tooling live separately in `database/DevelopmentDB` and are included by `Elevant.sln`.

## Architecture boundaries

- `Elevant.Domain` has no framework dependency.
- `Elevant.Application` owns use cases and ports.
- `Elevant.Contracts` owns public HTTP contracts, not EF entities.
- `Elevant.Infrastructure` owns provider adapters and other non-persistence infrastructure.
- `Elevant.Persistence` under `database/DevelopmentDB` owns EF Core and SQL Server access.
- `Elevant.Api` is the composition root. It must not contain domain rules or run migrations/seeds at startup.
- `Elevant.DatabaseTool` under `database/DevelopmentDB` is a one-shot deployment utility, never part of the API request path.

Do not expose EF entities directly over HTTP. Public airline access must derive organization and station scope from the authenticated server-side membership. Internal cross-airline access requires explicit role and station scopes. Mobile commands require a device-scoped idempotency key; retries must return the stored result instead of duplicating work.

## Database v1 invariants

- Development and Production are different physical databases. Both apply the same ordered EF migration chain.
- Exact names are `ElevantDevelopmentDb` and `ElevantProductionDb`.
- Every database has one immutable `infra.database_instances` marker created before EF. Tooling must validate declared environment, physical database name and marker.
- Production schema changes require `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb`.
- Production never runs a seed. Development fixtures are synthetic, deterministic, idempotent and may not delete or replace existing rows.
- Never use `HasData` or business `INSERT`, `UPDATE` or `DELETE` statements in migrations.
- Internal keys are `bigint identity`; externally exposed aggregate IDs are UUIDs; instants are UTC `datetimeoffset(3)`; mutable aggregates use `rowversion`.
- Preserve history with status/event/version rows. Foreign keys use `NO ACTION`; do not add cascade deletion for operational, contractual or audit data.
- Money and executed-service rates require fixed precision and an immutable currency/rate snapshot. Never reprice history from a current contract.
- KPIs, unread counts, coverage labels and eligibility are projections, not authoritative tables.
- Binary evidence belongs in future S3-compatible object storage. SQL will retain metadata/object keys only after that capability is designed.

Schemas are `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration` and `audit`. Read `docs/architecture/database-v1.md` before changing this model.

## Migration workflow

Create migrations only with `database/DevelopmentDB/scripts/add-migration.ps1`; apply locally only with `database/DevelopmentDB/scripts/update-database.ps1`. Review the generated operations and idempotent SQL. Test a clean database and an upgrade from the previous schema. Use expand/contract for changes consumed by independently deployed clients.

Deployment uses the EF migration bundle in `database/DevelopmentDB/Dockerfile.database-release`. The release order is target verification, migration, Development-only seed, then API. SQL Server and its named volumes have a separate manual lifecycle and are never recreated by an application redeploy.

## Required validation

From the repository root:

```powershell
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
dotnet ef migrations has-pending-model-changes --project database/DevelopmentDB/Elevant.Persistence --startup-project backend/Elevant.Api --context ElevantDbContext --configuration Release --no-build
```

The SQL integration tests use `ELEVANT_TEST_SQLSERVER_MASTER` when a real SQL Server is available. CI is the authority for SQL Server 2022 container and Docker image validation when Docker is unavailable locally.

Never print secret values, render a secret-bearing Compose file into logs, let the API use `sa`/migrator credentials, or run destructive recovery/reset commands without an exact target and explicit authorization.
