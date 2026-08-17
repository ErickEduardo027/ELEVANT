# Elevant database v1

Status: implementation baseline for `feature/database-v1`.

## Product boundaries

Elevant has three clients and one server-side source of truth per environment:

| Client | Audience | Data boundary |
| --- | --- | --- |
| `frontend/web` | AVIAM internal teams | Cross-airline access only through explicit roles and station scopes |
| `frontend/public-web` | Airline customers | Airline tenant is derived by the API from the authenticated membership |
| `frontend/mobile-agent` | Ramp agents on managed tablets | Agent and station scope is derived by the API; offline commands are idempotent |

No client connects directly to SQL Server. Development and Production are different physical databases and will run on different VPS instances. They share the same ordered EF migration chain; only Development receives synthetic fixtures.

## Decisions derived from the frontends

- A turnaround is one airport scale with an inbound and outbound leg. It owns STA/ETA/ATA and STD/ETD/ATD independently.
- Airlines, airports, stations, terminals, stands, services, equipment, aircraft and positions are canonical catalogs. Display names from mocks are never foreign keys.
- A person, account and ramp-agent employment profile are separate records.
- Qualifications and permits are append-only cycles. Their `current`, `expiringSoon` and `expired` labels are projections from dates.
- Contracts are versioned; service rates belong to an approved version and have validity dates. Historical execution must never be repriced from the current contract.
- Assignments are normalized many-to-many records. Arrays embedded in mocked flights are not persisted.
- Operational status changes, checklist submissions and OCC review decisions are append-only history.
- Mobile writes use a device-scoped idempotency key and return a result for each command.
- Counts, KPIs, unread totals, coverage percentages and eligibility are read-model calculations, not authoritative tables.

## SQL Server conventions

- SQL Server 2022, compatibility level 160.
- Schemas: `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration`, `audit`.
- Internal keys are `bigint identity`; externally exposed aggregate identifiers are unique `uniqueidentifier` values.
- Instants use `datetimeoffset(3)` in UTC; civil work dates use `date`; a station stores its IANA time-zone identifier.
- Money uses `decimal(19,4)`, operational quantities use `decimal(18,4)`, and currency is an ISO 4217 `char(3)` value.
- Mutable aggregates use SQL Server `rowversion` for optimistic concurrency.
- Foreign keys use `NO ACTION`; business and audit history is never cascade-deleted.
- Status history is append-only. Operational records are deactivated or superseded instead of being hard-deleted.
- Table and column names use `snake_case`. Code uses singular entity names.

## Migration and data policy

EF Core owns a single migration history at `infra.__EFMigrationsHistory`. `infra.database_instances` is provisioned before EF and excluded from migrations. Every migration/seed command must confirm that its declared environment agrees with both the physical database name and that immutable marker.

Production migration execution changes schema only. Development seed execution is separate, deterministic, idempotent, synthetic and forbidden when the marker is not `Development`. A reset is a separate manual operation that must create and verify a backup first.

## Explicitly deferred

Billing documents, invoices, reconciliation ledgers, notifications, chat and uploaded evidence are not physical v1 tables. Their current frontend shapes are incomplete or contradictory. Binary files will use S3-compatible object storage later; SQL Server will eventually retain only metadata and object keys.
