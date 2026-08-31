# Database agent guide

This subtree owns the shared SQL Server schema and database operations used by the single ELEVANT API. Read the root and backend guides as well; client applications never connect here directly.

## Boundaries

- `DevelopmentDB` is the current executable schema source and Development operations package.
- `DevelopmentDB/Elevant.Persistence` owns EF Core mappings, migrations and the deterministic Development seed.
- `DevelopmentDB/Elevant.DatabaseTool` is a one-shot verifier/seeder used by release automation.
- `ProductionDB` must contain only `.gitkeep` until a separate Production plan is explicitly approved.
- Development and future Production are different physical databases that will apply the same ordered migration chain. Do not create a separate schema per client.

## Safety

- Never put Production data, credentials, backups, `.mdf`, `.ldf` or generated runtime state in this subtree.
- Production schema changes require explicit confirmation and never run a seed.
- Do not rename existing EF migration IDs or rewrite applied migrations.
- Preserve the certified Development Compose files byte-for-byte unless the change has an explicit rollout and controller compatibility plan.
- `initialize-production.sql` under `DevelopmentDB/tests/scripts/fixtures` is certification-only and must never be treated as a deployable Production bootstrap.

## Validation

From the repository root, restore/build/test `backend/Elevant.sln`, run the EF pending-model check against `database/DevelopmentDB/Elevant.Persistence`, execute the database tooling tests, validate all Compose files and verify the release manifest with the explicit DevelopmentDB source paths.
