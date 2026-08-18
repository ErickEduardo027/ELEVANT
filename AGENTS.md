# ELEVANT agent guide

Read the nearest `AGENTS.md` before changing a subtree. This repository is a monorepo with one server-side source of truth and three clients:

| Path | Product boundary |
| --- | --- |
| `frontend/web` | Internal AVIAM application for OCC, administration and operational departments |
| `frontend/public-web` | Customer-facing site and airline portal; every query is tenant-scoped by the API |
| `frontend/mobile-agent` | Native Expo/React Native tablet application for ramp agents |
| `backend` | The only API, domain model and SQL Server access path used by all three clients |

The clients never connect to SQL Server or external aviation providers directly. They use the same versioned API and the same logical database for their environment. Do not create a database or backend per client.

## Sources of truth

- The executable frontend prototypes describe workflows and vocabulary, but mock object shapes are not database contracts.
- OpenAPI is the client/server contract once an endpoint exists.
- EF Core migrations in `backend/src/Elevant.Infrastructure/Persistence/Migrations` are the database schema history.
- `docs/architecture/database-v1.md` records the decisions derived from the current prototypes.
- Data in `backend-prototipo/data`, browser storage and frontend fixtures is disposable prototype data. Never promote it to Production or copy credentials/PII from it into a seed.

## Change discipline

- Preserve unrelated work in a dirty tree.
- Use feature branches from `Development`; do not merge into `Development` or deploy unless the user explicitly asks.
- Keep changes within the requested product boundary. A database change does not authorize implementing API endpoints or rewriting client behavior.
- Never commit secrets, connection strings with real credentials, generated runtime databases, SQL backups, uploads or build output.
- Prefer additive, backward-compatible changes. Coordinated breaking changes require an explicit release plan.
- Update the relevant README, tests and migration documentation when behavior or an operational contract changes.

## Validation

Run the commands owned by the affected subtree. The backend uses the locked .NET tool and NuGet manifests. Each frontend uses its own `package-lock.json` and npm commands; do not assume the old root pnpm templates describe the current applications.

A change is complete only when its focused tests pass, generated artifacts are not accidentally committed, configuration contains no real secret, and the handoff states what was and was not deployed.
