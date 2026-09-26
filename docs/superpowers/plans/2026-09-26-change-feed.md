# Durable Account Change Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist account-targeted change hints for existing operational chat/notifications and make them recoverable by cursor after an API or WebSocket outage.

**Architecture:** Source commands append typed outbox rows in their existing SQL transaction. A single Development API worker projects committed rows into an ordered per-account feed, marks source rows processed atomically with projection, and attempts SignalR delivery after commit. Authorized HTTP reads are the recovery path; a missed push cannot lose state.

**Tech Stack:** .NET 10, EF Core/SQL Server 2022, ASP.NET Core SignalR, xUnit v3.

**Spec:** `docs/superpowers/specs/2026-09-26-integrated-development-cycle.md`

## Global Constraints

- One API instance and one logical SQL Server database in Development; do not scale the worker without a SQL lease/backplane design.
- Internal account and station IDs stay server-side; client event payloads contain no content, names or tokens.
- Every feed read resolves the current account and station scope. JWT `sub` alone does not grant resource access.
- Existing mobile command idempotency and message replay semantics are preserved.
- New schema changes use an additive EF migration; no business updates in migrations or Production seed.

## Review Focus

- Commit ordering: the feed cursor orders dispatcher commits, not source outbox identity allocation; Task 3 tests two source events delivered in reverse source-ID order.
- Crash between feed transaction and SignalR send: the feed remains readable; Task 3 tests a send exception.
- Replayed outbox event creates one feed row per recipient; Task 3 tests uniqueness.
- Revoked station scope hides previously queued hints; Task 4 tests the authorized read.
- A malformed cursor and a cursor from another account must not expose data; Task 4 tests both.

---

### Task 1: Typed outbox hint producer

**Files:**
- Create: `database/DevelopmentDB/Elevant.Persistence/Realtime/AccountChangeOutboxWriter.cs`
- Create: `backend/tests/Elevant.IntegrationTests/Persistence/AccountChangeOutboxWriterTests.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Elevant.Persistence.csproj` to expose internals only to `Elevant.IntegrationTests`.
- Modify: `database/DevelopmentDB/Elevant.Persistence/Operations/OperationalNotificationWriter.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Operations/EfOperationalCommunicationStore.cs`

**Interfaces:**
- Produces: `AccountChangeOutboxWriter.Add(ElevantDbContext, long accountId, long? stationId, string resource, Guid resourceId, DateTimeOffset occurredAt)`; `AccountChangeOutboxWriter.Decode(OutboxMessage)` returns a typed payload or rejects malformed data.

- [x] Write a failing test using `new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>().UseSqlServer("Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=true;", ElevantSqlServerOptions.Configure).Options)` and call `AccountChangeOutboxWriter.Add(context, 41, 8, "notifications", sourceId, DateTimeOffset.UtcNow)`. Assert one tracked `OutboxMessage`, `EventType == "account.changed.v1"`, nonempty public ID, decoded recipient `41`, station `8`, resource and source UUID; assert its JSON has no message content.
- [x] Run `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --configuration Release --no-restore --filter FullyQualifiedName~AccountChangeOutboxWriterTests`; expect missing type compilation failure.
- [x] Implement `Add` by tracking an `OutboxMessage` with a versioned event type and `JsonSerializer.Serialize(new AccountChangeOutboxPayload(...))`. Implement `Decode` using `JsonSerializer.Deserialize` and reject invalid account ID, resource or UUID. Add a notification hint for each notification recipient and a sender chat hint in `SendInsideTransactionAsync`, before its existing `SaveChangesAsync`; do not add one on idempotent replay.
- [x] Run the focused tests and `dotnet test backend/Elevant.sln --configuration Release --no-restore`; expect all passing.
- [ ] Commit producer, tests and documentation as `feat(realtime): append account change hints with operations`.

### Task 2: Add per-account feed schema

**Files:**
- Create: `backend/Elevant.Domain/Entities/Infrastructure/AccountChange.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/PlatformConfiguration.cs`
- Create via repository migration script: next `database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/*_AccountChangeFeed.*`
- Test: `backend/tests/Elevant.IntegrationTests/Persistence/DatabaseModelTests.cs`

**Interfaces:**
- Produces: `infra.account_changes` with identity sequence, unique `(outbox_public_id, recipient_account_id)`, recipient account FK, nullable station FK, resource, resource UUID and occurred time. One dispatcher transaction serially creates feed rows; this identity is the cursor order.

- [x] Add a failing EF model test for table, precision, unique index and `NO ACTION` FKs.
- [x] Run focused model tests; expect missing entity or mapping failure.
- [x] Add entity, mapping and DbSet; generate an additive migration only through `database/DevelopmentDB/scripts/add-migration.ps1 -Name AccountChangeFeed` using a non-secret local Development connection setting.
- [x] Run `dotnet ef migrations has-pending-model-changes` and the full backend suite; expect no pending changes and all tests passing.
- [ ] Commit schema, migration, tests and schema notes as `feat(realtime): add durable account change feed`.

### Task 3: Project committed outbox and push hints

**Files:**
- Create: `backend/Elevant.Application/Abstractions/Realtime/IAccountChangeDispatcherStore.cs`
- Create: `database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeDispatcherStore.cs`
- Create: `backend/Elevant.Api/Hubs/AccountChangeDispatchWorker.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/DependencyInjection.cs` and `backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs` according to existing registration patterns.
- Test: `backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs` and a worker test with a fake store/hub context.

**Interfaces:**
- Produces: `DispatchPendingAsync(int limit, CancellationToken)` returning `(eventId, accountPublicId, cursor, resource, resourceId)` notices after one SQL transaction; worker calls `IHubContext<OperationsHub>.Clients.User(accountPublicId).SendAsync("ChangedV1", notice)` after commit.

- [ ] Write failing SQL and worker tests for one projection, replay, reverse source commit order and a push exception that leaves the feed intact.
- [ ] Run focused tests; expect missing dispatcher types.
- [ ] Implement serial batch dispatch with bounded retries/dead-letter visibility, atomic feed+processed update, unique replay protection and post-commit SignalR attempt. A push failure must not roll back the feed.
- [ ] Run focused tests, full backend suite and pending-model check; expect passing.
- [ ] Commit as `feat(realtime): dispatch durable account changes`.

### Task 4: Read feed by opaque cursor

**Files:**
- Create: `backend/Elevant.Application/Abstractions/Realtime/IAccountChangeReadStore.cs`
- Create: `database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs`
- Create: `backend/Elevant.Contracts/Realtime/AccountChangeContracts.cs`
- Create: `backend/Elevant.Api/Controllers/AccountChangesController.cs`
- Test: `backend/tests/Elevant.IntegrationTests/Api/AccountChangesEndpointsTests.cs`

**Interfaces:**
- Produces: `GET /api/v1/changes?after=<opaque>&limit=1..100`; result `{changes:[{eventId,cursor,resource,resourceId,occurredAt}],nextCursor,hasMore}`. The server ignores no scope: it resolves the current account and active station authorization before returning rows.

- [ ] Write failing API tests for first page, continuation, malformed cursor, account separation and revoked station; no raw internal ID in JSON.
- [ ] Run focused tests; expect route 404.
- [ ] Implement versioned endpoint, strict cursor codec and authorized SQL query with stable dispatcher sequence.
- [ ] Regenerate OpenAPI/client, run focused and full backend/API-client tests; expect passing and no secret-bearing output.
- [ ] Commit endpoint, generated contract, tests and Vault note as `feat(realtime): expose scoped account change cursor`.
