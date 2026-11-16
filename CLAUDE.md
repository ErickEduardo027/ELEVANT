# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ELEVANT is AVIAM's ground-handling planning and control platform: a monorepo of three clients, one shared .NET API, and one SQL Server schema. Most docs, the Vault, and UI text are written in Spanish.

Each subtree has an `AGENTS.md` with binding rules. Read the root one (`AGENTS.md`) and the one nearest the files you touch before editing: `backend/`, `database/`, `frontend/`, `ops/`, `Vault/`, `frontend/private-web/`, and `frontend/public-web/`. This file summarizes them and does not replace them.

## Architecture

```text
frontend/private-web  (AVIAM internal: OCC, HR, contracts, finance, superadmin) ─┐
frontend/public-web   (public site + airline portal, tenant-scoped)               ├─ HTTPS ─> backend/Elevant.Api ─> SQL Server
frontend/mobile-agent (Expo tablet app for ramp agents)                          ─┘                 └─> authorized external providers
```

- **One API and one logical database per environment.** No client talks to SQL Server or to FlightAware directly. Tenant, role, station, and agent authorization is always resolved server-side. Mocks, `localStorage`, and device storage are never security boundaries. Do not create a backend or database per client.
- **Backend (`backend/Elevant.sln`, .NET 10 modular monolith):**
  - `Elevant.Domain` has no framework dependencies.
  - `Elevant.Application` holds use cases and ports, organized by module: Operations, Commercial, Finance, Identity, Integration.
  - `Elevant.Contracts` holds the HTTP DTOs. EF entities are never exposed over HTTP.
  - `Elevant.Infrastructure` holds provider adapters.
  - `Elevant.Api` is the composition root: controllers, SignalR hubs in `Hubs/`, and OpenAPI. It must not contain domain rules and must not run migrations or seeds at startup.
  - `backend/tests/Elevant.ArchitectureTests` enforces these layer boundaries.
- **Persistence lives outside `backend/`.** `database/DevelopmentDB/Elevant.Persistence` contains the EF Core `ElevantDbContext`, the migrations, and the deterministic Development seed. `database/DevelopmentDB/Elevant.DatabaseTool` is a one-shot verifier/seeder used in releases. Both are included in `Elevant.sln`. `database/ProductionDB` must stay empty except for `.gitkeep`.
- **Contract flow: API → OpenAPI snapshot → shared TS client → apps.**
  - `packages/api-client` commits a reviewed snapshot (`openapi/elevant-v1.json` plus `source.json` with its SHA-256) and the Orval-generated `generated/elevant-api.ts`.
  - `src/` wraps the generated client with validation and Problem Details errors.
  - All three apps depend on it as `file:../../packages/api-client` and consume its TypeScript source directly; there is no build step.
  - When an endpoint changes:
    1. Run the API locally.
    2. `npm run refresh:openapi -- http://127.0.0.1:<port>/swagger/v1/swagger.json`
    3. `npm run generate`
    4. `npm run check`
    5. Update every affected consumer.
- **Realtime model:** the SignalR hubs (Operations, Notifications, PublicCatalog) and the account-change cursor feed (`getAccountChanges`) only *announce* that something changed. Clients re-read data through REST under current permissions. The cursor is opaque.
- **Writes:**
  - Mutating commands typically require an `Idempotency-Key` UUID plus an expected version or revision.
  - A 409 means re-read before forming a new intent.
  - Retry an uncertain result only with the same key and the same body.
  - Mobile commands are also scoped to the device or installation.
- **Prototype data is disposable.** `backend-prototipo/` (a legacy Node mock server), frontend fixtures, and browser storage describe workflows and vocabulary, not database contracts. Never promote their data into seeds. The root `*-PROTOTIPO.cmd` scripts launch that legacy stack.

### Frontends

- **private-web** uses Next.js 16 (App Router), React 19, Tailwind, and JS/JSX. It was migrated from Vite.
  - Routes and guards are in `app/`. They include `/admin-occ/*`, `/gestion-humana/*`, `/contratos`, `/finanzas`, and `/superadmin`. Shells show only the modules allowed by the department access loaded from `GET governance/me/access` (`src/features/access`); see ADR-0015 for the department governance model.
  - The feature screens remain in `src/features/<area>`. API adapters live in `src/services/`, with co-located `*.test.js` files.
  - Browser config uses the `NEXT_PUBLIC_*` prefix, never `VITE_*`. The Development build validates `NEXT_PUBLIC_ELEVANT_API_URL` and `NEXT_PUBLIC_PROTOTYPE_API_URL` (HTTPS, same origin) and requires `NEXT_PUBLIC_HR_DEMO_MODE=dashboard-read-only`.
  - Next is launched via `scripts/run-next.mjs`. The MapLibre worker is copied in `predev`/`prebuild` and verified after the build.
- **public-web** uses Next.js 16 and React 19 with TypeScript. All operational data must be scoped by the server to the authenticated organization and its allowed stations.
- **Both Next apps:** their `AGENTS.md` warns that this Next version has breaking changes. Read `node_modules/next/dist/docs/` inside the app before writing Next code. `next dev` re-adds that `AGENTS.md` block, so commit it if it shows up in the diff.
- **mobile-agent** uses Expo 54 and React Native and is distributed as an APK or native app, never hosted on the VPS. Offline writes carry a stable device ID and an idempotency key. Local data is only a cache.
- **Data sources:** keep mock and remote adapters swappable, and do not let components choose the data source. Every remote view needs loading, success, empty, recoverable-error, and unauthorized states. Render server errors as Problem Details, never as raw exception text.

### Database v1 invariants

These are summarized from `backend/AGENTS.md`; read `docs/architecture/database-v1.md` before touching the model.

- **Separate physical databases:** `ElevantDevelopmentDb` and `ElevantProductionDb` apply the same migration chain. Each has an immutable `infra.database_instances` marker that tooling validates.
- **Production safeguards:** Production never seeds. Production schema changes require `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb`.
- **Migration content:** no `HasData` and no business `INSERT`/`UPDATE`/`DELETE` in migrations.
- **Migration history:** never rename or rewrite applied migrations. Use expand/contract for changes that independently deployed clients consume.
- **Keys and columns:**
  - Internal keys are `bigint identity`; IDs exposed externally are UUIDs.
  - Timestamps are UTC `datetimeoffset(3)`.
  - Mutable aggregates use `rowversion`.
  - Foreign keys use `NO ACTION`, with no cascading deletes.
- **History is preserved** through status, event, and version rows. Money and rates keep immutable snapshots.
- **Projections, not tables:** KPIs, counters, and eligibility are projections, not authoritative tables.
- **Schemas:** `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration`, `audit`.

## Commands

### Backend and database (from the repo root)

Uses the locked tool and NuGet manifests: `dotnet-tools.json`, `Directory.Packages.props`, `packages.lock.json`.

```powershell
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
# single project / single test (xUnit v3)
dotnet test backend/tests/Elevant.UnitTests --configuration Release --filter "FullyQualifiedName~SomeTestClass"
# EF model drift check (must report no pending changes)
dotnet ef migrations has-pending-model-changes --project database/DevelopmentDB/Elevant.Persistence --startup-project backend/Elevant.Api --context ElevantDbContext --configuration Release --no-build
```

- **Migrations:** create them only with `database/DevelopmentDB/scripts/add-migration.ps1` and apply them locally only with `database/DevelopmentDB/scripts/update-database.ps1`. Test both a clean database and an upgrade from the previous schema.
- **SQL integration tests:** they use `ELEVANT_TEST_SQLSERVER_MASTER` when a real SQL Server is available. Otherwise CI (SQL Server 2022) is the authority.
- **Python tooling tests:**
  ```bash
  python3 -m unittest discover -s database/DevelopmentDB/tests/scripts -p 'test_*.py'
  python3 -m unittest discover -s backend/tests/scripts -p 'test_*.py'
  ```
- **Full local stack** (SQL Server, bootstrap, migrations, seed, and the API on `127.0.0.1:8080`): first copy `database/DevelopmentDB/.env.example` to `.env` and fill in every `REPLACE_ME`, then run:
  ```powershell
  docker compose --env-file database/DevelopmentDB/.env -f database/DevelopmentDB/compose.local.yml up --build
  ```

### Frontends and the API client

Each package has its own `package-lock.json`; run `npm ci` inside it. Ignore the root `pnpm-workspace.yaml`, which is an obsolete template.

| Dir | Test | Single test | Other checks |
| --- | --- | --- | --- |
| `frontend/private-web` | `npm test` | `npx vitest run --configLoader runner --config vitest.config.mjs <path> -t "<name>"` | `npm run lint`, `npm run typecheck`, `npm run test:delivery`, `npm run build` |
| `frontend/public-web` | `npm test` | `npx vitest run <path> -t "<name>"` | `npm run lint`, `npm run typecheck`, `npm run test:e2e` (Playwright), `npm run build` |
| `frontend/mobile-agent` | `npm run test:unit` | `npx jest <path> -t "<name>"` | `npm run lint`, `npm run typecheck`, `npm run test:app-bundle` |
| `packages/api-client` | `npm test` | `npx vitest run <path> -t "<name>"` | `npm run check` (generated-file drift, typecheck, and tests) |

Both Next apps serve on `http://localhost:3000`.

### Repo-level checks (from the root)

```powershell
npm run check           # secret scan (scripts/repository/check-secrets.ps1)
npm run vault:generate  # regenerate Vault/_generated (never hand-edit it)
npm run vault:ci        # Vault tool tests + checks
```

## Workflow rules

- **Branching:** branch features from `Development`, the integration branch; `main` represents Production. Do not merge into `Development` or deploy unless explicitly asked.
- **Stay in scope:** keep changes inside the requested product boundary. A database change does not authorize new endpoints or client rewrites.
- **Vault (`Vault/`, Spanish, Obsidian-compatible):** a change to durable behavior, contracts, schema, deployment, security, or team workflow updates the matching Vault note in the same PR, or the PR explains why no update is needed. Never present prototype, planned, or deferred behavior as current.
- **Ops:** `ops/dokploy` holds secret-free templates. It does not authorize connecting to or mutating the VPS, because the operator applies remote changes manually.
  - Keep control-plane endpoints private behind Tailscale.
  - Never publish SQL Server, Dokploy, or Docker/Swarm ports.
  - Deploy by immutable image digest.
- **Never commit:** secrets, real connection strings, SQL backups, runtime databases, uploads, or build output.
- **Definition of done:** focused tests pass, no generated artifacts are committed by accident, and the handoff states what was and was not deployed.
