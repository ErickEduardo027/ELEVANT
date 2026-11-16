# Shared OCC–Agent Attendance API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist separate, partially filled attendance observations by OCC and the assigned ramp agent for one operation assignment, with explicit revision conflicts, retry-safe writes, authorized reads, and recoverable change hints.

**Architecture:** Add an append-only `ops.operation_attendance_contribution_revisions` table keyed by operation-agent assignment and contributor lane (`Occ` or `RampAgent`). Distinct OCC and ramp-agent routes select a lane, while the API verifies that route against current server-side identity; the caller cannot choose a lane in the body. Each successful write commits one immutable revision, audit entry, and recipient-specific outbox hints in one transaction; a read returns the newest revision of both lanes. Clients re-read the canonical snapshot after a hint. This plan delivers the backend/API foundation only; client forms, GH validation, extra-hour calculations, and signatures are separate plans.

**Tech Stack:** .NET 10, EF Core 10, SQL Server 2022, ASP.NET API v1, xUnit, OpenAPI/Orval 8.27.0, TypeScript API client.

**Spec:** `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md`, “Gestión Humana, gobernanza y turnos”.

## Global Constraints

- “Todo usa la API versionada y una base lógica por entorno.”
- “La API impone rol, estación, terminal y organización; los clientes no autorizan por sí solos.”
- “Los aportes parciales de OCC y agente se guardan por separado mediante comandos idempotentes y control de revisión.”
- “La API emite una invalidación autorizada después de persistir y los clientes releen el estado canónico; el cursor recupera cambios tras reconexión.”
- A contribution is a manual observation, never biometric proof. No payroll approval, legal overtime limit, or automatic billing follows from it.
- Additive migration and HTTP operations only. Preserve the existing ramp incident, shift, submission, and review contracts.
- Do not migrate, seed, or change the VPS from this worktree. Generated OpenAPI and client output must be refreshed from the local compiled API, not edited by hand.

## Review Focus

1. Two accounts writing different lanes concurrently must preserve both; SQL integration test in Task 2.
2. Same-lane stale revision must return 409 and preserve the earlier row; SQL and HTTP tests in Tasks 2–3.
3. Replaying the exact idempotency key/payload must return the original receipt; changing payload under that key must return 409, even after another revision; SQL test in Task 2.
4. Revoked agent assignment, device, OCC station scope, or GH read grant must deny access before replay or event publication; SQL/HTTP tests in Tasks 2–3.
5. Reconnection must recover an authorized `attendance_draft` cursor hint without exposing another station's operation; change-feed integration test in Task 3.

## Fixed v1 Contract for Review

`GET /api/v1/operations/{operationId}/assignments/{assignmentId}/attendance-draft` returns `operationId`, `assignmentId`, `stationId`, and nullable `occ` and `rampAgent` contributions. Each contribution returns `revision`, `authorAccountId`, `recordedAt`, nullable `observedStartAt`, nullable `observedEndAt`, and nullable `incidentNote`. The account ID is for audit display only; clients still derive current permission from the server. A missing draft returns both contributions as null, not 404, when the assignment itself is authorized and exists.

`PUT` to `/attendance-draft/occ` or `/attendance-draft/ramp-agent` accepts `{ expectedRevision, observedStartAt, observedEndAt, incidentNote }` and requires `Idempotency-Key: <UUID>`. `expectedRevision` is 0 for the first contribution by that lane. The ramp-agent route also requires its existing `X-Elevant-Installation-Id` UUID and current device/assignment binding; the OCC route requires current `ADMIN_OCC` and station scope. The API returns the canonical contribution and `replayed`. `If-Match` is not used here: the body revision is lane-specific and makes two independent authors nonconflicting. `null` means not supplied yet, not a verified absence. Each write replaces the caller's own lane snapshot by appending a revision; it never edits the other lane. Notes are trimmed and 0–2000 characters; at least one of the three observation fields must be non-null. If both instants exist, end must be no earlier than start; both are stored as UTC instants. Overtime remains a later GH decision.

## Task 1: Domain policy and application port

**Files:**
- Create: `backend/Elevant.Application/Operations/AttendanceDraftModels.cs`
- Create: `backend/Elevant.Application/Operations/AttendanceDraftPolicy.cs`
- Create: `backend/Elevant.Application/Abstractions/Operations/IAttendanceDraftStore.cs`
- Test: `backend/tests/Elevant.UnitTests/Application/AttendanceDraftPolicyTests.cs`

**Interfaces:**
- Produces `AttendanceDraftLane { Occ, RampAgent }`, `AttendanceDraftContributionData`, `AttendanceDraftSnapshotData`, `AttendanceDraftWriteRequest`, `AttendanceDraftWriteResult`, `AttendanceDraftFailure`, and `IAttendanceDraftStore.GetAsync/SaveAsync` for Tasks 2–3. `GetAsync(Guid actorAccountId, Guid operationId, Guid assignmentId, Guid? installationId, CancellationToken)` returns snapshot/failure; the nullable installation ID is required for ramp-agent reads so a revoked device cannot keep reading with a valid bearer token. `SaveAsync(AttendanceDraftWriteRequest request, CancellationToken)` returns contribution/replayed/failure. The write request includes actor, operation, assignment, lane, expected revision, observations, note, idempotency UUID, nullable installation UUID, and request trace ID.

- [ ] **Step 1: Write policy tests.** Pin `expectedRevision >= 0`, a nonempty observation, trimmed note length ≤ 2000, chronological instants, and distinct lanes. Example:

```csharp
var start = new DateTimeOffset(2026, 10, 2, 12, 0, 0, TimeSpan.Zero);
var end = start.AddHours(8);
Assert.False(AttendanceDraftPolicy.IsValid(-1, null, null, "Arribó"));
Assert.False(AttendanceDraftPolicy.IsValid(0, null, null, null));
Assert.False(AttendanceDraftPolicy.IsValid(0, end, start, null));
Assert.True(AttendanceDraftPolicy.IsValid(0, start, null, "Arribó"));
```

- [ ] **Step 2: Run RED.** `dotnet test backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj --filter AttendanceDraftPolicyTests --configuration Release` must fail because the policy does not exist.
- [ ] **Step 3: Add the policy and immutable application records.** Use `DateTimeOffset?` for observed instants, `int` for revisions, `Guid` for public IDs and intention keys, and a closed failure enum (`Invalid`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`). `IsValid` rejects control characters except tab/newline/carriage return, matches the incident note limits above, and never computes overtime.
- [ ] **Step 4: Run GREEN and commit.** Repeat the focused test; commit only Task 1 paths with `feat(attendance): define separate OCC and agent contributions`.

## Task 2: Append-only persistence and transactionally emitted hints

**Files:**
- Create: `backend/Elevant.Domain/Entities/Operations/OperationAttendanceContributionRevision.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs`
- Create: `database/DevelopmentDB/Elevant.Persistence/Operations/EfAttendanceDraftStore.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/DependencyInjection.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs`
- Generate: a new migration and updated model snapshot using `database/DevelopmentDB/scripts/add-migration.ps1 -Name OperationAttendanceContributionRevisions`
- Test: `backend/tests/Elevant.IntegrationTests/Persistence/AttendanceDraftStoreTests.cs`
- Test: `backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs`

**Interfaces:**
- Consumes Task 1 port and records. Produces an SQL-backed `GetAsync` and `SaveAsync` implementation; `attendance_draft` outbox resource with operation public UUID and station scope.

- [ ] **Step 1: Write SQL integration tests before the entity/store.** Use the existing test database fixture. Create two authorized accounts (OCC with station grant, active assigned agent with device) and one operation assignment. Assert initial snapshot has two null lanes; OCC revision 1 and agent revision 1 both survive; a stale OCC revision is 409; exact replay returns the first receipt; reused key with different payload is 409; revoked station/assignment/device denies read/write and emits no outbox row. Assert the persisted audit actor, source, instant, and both recipient hints, then query the feed after a cursor. These tests must fail against the missing store/schema.
- [ ] **Step 2: Add one immutable entity and mapping.** Table columns: `public_id`, `operation_agent_assignment_id`, `lane`, `revision_number`, `author_account_id`, `installation_id` nullable, `idempotency_key`, `payload_sha256`, three observation fields, `recorded_at`, plus standard timestamps/rowversion. Add unique indexes `(operation_agent_assignment_id, lane, revision_number)` and `(author_account_id, idempotency_key)`, FK `NO ACTION`, UTC precision 3, and a check `revision_number > 0`. Do not add business DML to the migration. The durable concurrency backstop is:

```csharp
builder.HasIndex(item => new { item.OperationAgentAssignmentId, item.Lane,
    item.RevisionNumber }).IsUnique();
builder.HasIndex(item => new { item.AuthorAccountId, item.IdempotencyKey }).IsUnique();
```
- [ ] **Step 3: Implement the store under SQL execution strategy + serializable transaction.** Re-resolve live account, role, station, assignment, and agent/device relationship inside the transaction. Lock the lane's latest revision before comparing `expectedRevision`. Check idempotency key/payload hash first but recheck current authorization before returning replay. Append one revision plus audit and outbox rows, save once, and map duplicate/serialization exceptions to `Conflict`; do not swallow arbitrary SQL errors. The transaction's ordered decision is:

```text
authorize current account + route lane + station + operation + assignment + device (ramp)
if (same author, idempotency key) exists: same payload hash => replay; else 409
lock latest revision for (assignment, lane)
if latest revision != expectedRevision: 409
append revision(expectedRevision + 1), audit, authorized recipient hints
commit; return canonical appended revision, replayed=false
```
- [ ] **Step 4: Guard the durable feed.** In `EfAccountChangeReadStore`, `attendance_draft` must be returned only to an active assigned agent, station-scoped OCC, or station-scoped GH viewer while the operation/assignment relationship still authorizes that account. The hint body remains only resource and operation ID; no notes or PII.
- [ ] **Step 5: Generate migration and run SQL tests.** Set only the local Development connection string required by the repository migration script; review generated Up/Down and idempotent SQL. Run focused SQL tests against a disposable `ElevantDevelopmentDb` fixture and `dotnet ef migrations has-pending-model-changes ... --no-build`. If local SQL is unavailable, do not claim SQL verification; CI's SQL-backed integration job is the acceptance gate.
- [ ] **Step 6: Commit Task 2.** `feat(attendance): persist revisioned per-actor drafts`.

## Task 3: Versioned HTTP endpoints and generated shared client

**Files:**
- Create: `backend/Elevant.Contracts/Operations/AttendanceDraftContracts.cs`
- Create: `backend/Elevant.Api/Controllers/AttendanceDraftController.cs`
- Test: `backend/tests/Elevant.IntegrationTests/Api/AttendanceDraftEndpointsTests.cs`
- Modify: `packages/api-client/openapi/elevant-v1.json`, `packages/api-client/openapi/source.json`, `packages/api-client/generated/elevant-api.ts` via package scripts only
- Modify: `packages/api-client/src/client.ts`, `packages/api-client/src/index.ts`
- Test: `packages/api-client/tests/attendance-draft-client.test.ts`

**Interfaces:**
- Consumes Task 2 store. Produces `getOperationAttendanceDraft(operationId, assignmentId)`, `saveOccAttendanceDraft(operationId, assignmentId, request, idempotencyKey)`, and `saveRampAttendanceDraft(operationId, assignmentId, request, idempotencyKey, installationId)` in `@elevant/api-client`.

- [ ] **Step 1: Write failing authenticated HTTP tests.** Assert `GET` 200 with both null lanes, `PUT` 200 with own canonical lane, 400 invalid input, 401 no identity, 403 wrong role, 404 wrong station/assignment, 409 stale revision/reused key, and 413 oversized JSON. Check that neither request body nor response permits caller-selected lane or author account.
- [ ] **Step 2: Implement controller and contracts.** Use `[ApiVersion("1.0")]`, `[Authorize]`, `[PrivateResponse]`, request-size limit 16 KiB, strict JSON unmapped-member handling, `ProblemDetails`, and operation names `GetOperationAttendanceDraft`/`SaveOccAttendanceDraft`/`SaveRampAttendanceDraft`. Derive account UUID from token; delegate authorization to the store. Mobile installation header is required only for the ramp-agent route and validated before write. Routes: `[HttpGet(Name = "GetOperationAttendanceDraft")]`, `[HttpPut("occ", Name = "SaveOccAttendanceDraft")]`, `[HttpPut("ramp-agent", Name = "SaveRampAttendanceDraft")]`.
- [ ] **Step 3: Refresh OpenAPI from the built local API and regenerate Orval.** Follow `packages/api-client/README.md` verbatim; review the snapshot, canonical SHA, and generated diff. Add a thin manual client method with required idempotency header, optional installation header, `AbortSignal`, runtime response validation, and no global token storage. No hand-edit in `generated/`.
- [ ] **Step 4: Run tests and commit.** Run `dotnet test backend/Elevant.sln --configuration Release`, `npm --prefix packages/api-client run check`, OpenAPI snapshot check, and the focused HTTP tests. Commit `feat(attendance): expose scoped shared drafts`.

## Task 4: Evidence, documentation, and acceptance gate

**Files:**
- Modify: `docs/architecture/database-v1.md`
- Modify: `packages/api-client/README.md`
- Create or update: a narrowly sourced note under `Vault/05-aplicaciones/`
- Regenerate: `Vault/_generated/repository-inventory.json` if `npm run vault:generate` changes it

- [ ] **Step 1: Document exact current capability.** In `packages/api-client/README.md`, state that the API stores/reads two manual lanes but no client UI, GH validation, payroll rule, or VPS promotion is proven. Add a request showing `expectedRevision: 0`, nullable observation fields, and an `Idempotency-Key` UUID; show that reusing the key with different content or using a stale revision yields 409. Update `docs/architecture/database-v1.md` with the migration sequence, append-only table, and outbox resource.
- [ ] **Step 2: Verify all Vault note sources at the final code commit, then set `last_verified`/`verified_commit`.** Link from the relevant application map; regenerate inventory; inspect diff. Never advance a broad Vault note's verified commit without checking every listed source.
- [ ] **Step 3: Full verification.** `dotnet tool restore`; `dotnet restore backend/Elevant.sln --locked-mode`; `dotnet build backend/Elevant.sln --configuration Release --no-restore`; `dotnet test backend/Elevant.sln --configuration Release --no-build`; pending-model check; `npm --prefix packages/api-client run check`; `npm run vault:ci`; `npm run check`; `git diff --check`. Confirm a clean tree and no generated runtime artifacts staged.
- [ ] **Step 4: Commit docs and request one fresh read-only review.** Address Critical/Important findings with RED→GREEN tests, repeat the affected checks, and report any SQL environment limitation. This plan does not merge, push, or deploy; a later client plan consumes this backward-compatible API contract.
