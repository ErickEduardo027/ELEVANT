# Human Resources Schedule Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show station-scoped, evidence-backed planning warnings for confirmed ramp shifts in G.H. without treating them as legal or payroll decisions.

**Architecture:** A pure evaluator converts station-local shift times to UTC instants and computes overlap, rest and seven-day scheduled-duration warnings. A read-only EF store loads the selected station's shifts and bounded cross-station context for those agents, enforces the live G.H. role and station grant, then paginates a deterministic projection. A versioned API publishes that projection; AVIAM Web reads it beside the existing roster through the generated client and clears stale private data on scope or session changes.

**Tech Stack:** .NET 10, EF Core/SQL Server, ASP.NET Core, OpenAPI/Orval, React 18/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-human-resources-alerts-design.md` (schedule-evaluation section). The durable notification inbox is a separate plan and is not implied by this endpoint.

## Global Constraints

- This is preliminary Development planning guidance: rest `<12h` and scheduled duration `>48h` in seven local days, never a legal/payroll ruling or an automatic assignment veto.
- A seven-day window contains the queried station's local date and its preceding six local dates. Convert each shift start to that station's local date for window membership; compute duration from UTC intervals and union overlaps before summing.
- A shift whose local start or end is ambiguous or nonexistent in its own IANA zone is unevaluable; do not silently select an offset or label the window compliant.
- Cross-station shifts may influence a warning, but the response includes IDs and details only for stations granted to the current actor. Represent hidden context with `HasRestrictedEvidence`, not a foreign station name, ID, time or agent identity.
- `GESTION_HUMANA` BackOffice role, active internal AVIAM membership, active requested station and live station grant are mandatory. `401` is unauthenticated, `403` is missing role/membership, `404` is unavailable station; responses use `Cache-Control: no-store`.
- Query accepts `stationId`, ISO `from`/`to` (at most 30 inclusive dates), `page >= 1`, `limit` 1–100. Sort by local date, employee number, warning kind and a stable source-key before paging.
- Query and exports must not expose EF entities. Use one shared versioned API; no client-side SQL or browser-only authority.
- No schema migration or VPS template change belongs to this plan. Publish API before AVIAM Web after green tests and operator checkpoints.

## Review Focus

1. A local time in a DST gap or fold must yield `Unevaluable`, not a fabricated instant (Task 1).
2. Exactly 12h rest and exactly 48h in seven dates must not warn; 11h59m and 48h01m must (Task 1).
3. A hidden station's shift must influence calculation without exposing its ID, code or time, including on later pages (Task 2).
4. Revoking the G.H. role or station grant between page views must remove old results and deny the next request (Tasks 2–4).
5. Refresh, reconnection or session switch while a request is in flight must not repaint results from the former account or station (Task 4).

---

## Interface Map

- `backend/Elevant.Application/Identity/ScheduleWarningEvaluator.cs`: pure `Evaluate(IReadOnlyList<ScheduleShift>, Guid requestedStationId, TimeZoneInfo requestedZone, DateOnly from, DateOnly to, ScheduleWarningRule rule)` returning ordered `ScheduleWarning[]`. `ScheduleShift` carries public IDs, agent identity, station ID/zone, local date/start/end and a `CanReveal` flag; the evaluator does not access EF or HTTP.
- `backend/Elevant.Application/Abstractions/Identity/IHumanResourcesScheduleWarningStore.cs`: `ListAsync(Guid actorId, Guid stationId, DateOnly from, DateOnly to, int page, int limit, CancellationToken)` returning `ScheduleWarningReadResult` with `ForbiddenRole`, `ForbiddenStation` or a page.
- `database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesScheduleWarningStore.cs`: authorization, bounded shift projection and pagination; no migration.
- `backend/Elevant.Contracts/Identity/HumanResourcesScheduleWarningContracts.cs`: typed public row, visible evidence, page metadata and rule version.
- `backend/Elevant.Api/Controllers/HumanResourcesScheduleWarningsController.cs`: one GET `/api/v1/human-resources/schedule-warnings`.
- `packages/api-client/src/client.ts`: typed facade calling the generated route, with tests in `packages/api-client/tests/human-resources-schedule-warnings-client.test.ts`.
- `frontend/private-web/src/features/human-resources/schedules/ScheduleWarningsPanel.jsx`: read-only warning list and honest empty/unevaluable/error states; `humanResourcesScheduleWarningsService.js` owns authenticated transport and session checks.

### Task 1: Pure station-time evaluator

**Files:** Create `backend/Elevant.Application/Identity/ScheduleWarningEvaluator.cs`; test `backend/tests/Elevant.UnitTests/Application/ScheduleWarningEvaluatorTests.cs`.

**Interfaces:** `ScheduleShift(Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber, Guid StationId, string StationCode, string IanaTimeZone, DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal, bool CanReveal)`. `ScheduleWarningRule(string Version, DateOnly EffectiveOn, TimeSpan MinimumRest, TimeSpan MaximumSevenDayScheduled)`; initial rule `dev-2026-10-05`, `2026-10-05`, 12h and 48h. `ScheduleWarning` carries `Kind` (`Overlap`, `ShortRest`, `SevenDayLoad`, `Unevaluable`), target date/profile, visible evidence IDs, `HasRestrictedEvidence`, measured minutes when evaluable, threshold minutes and rule version/effective date.

- [ ] **Step 1: RED.** Add `[Theory]` cases for PUJ overnight 23:00–08:00, two stations with different IANA zones, DST gap/fold in `America/New_York`, overlap union, 11h59m/12h rest and 48h/48h01m across precisely seven local dates. The test should assert an invalid local time yields `Unevaluable` with `MeasuredMinutes == null`; overlap yields one separate `Overlap` warning and union minutes are counted only once.
- [ ] **Step 2: Verify RED.** Run `dotnet test backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj --filter FullyQualifiedName~ScheduleWarningEvaluatorTests --configuration Release`; expect compilation to fail because `ScheduleWarningEvaluator` is not defined.
- [ ] **Step 3: GREEN.** Implement `TryInterval`: create `DateTime` with `DateTimeKind.Unspecified`; if end local `<=` start, add one day; call `zone.IsInvalidTime`/`zone.IsAmbiguousTime` for both endpoints before `TimeZoneInfo.ConvertTimeToUtc`. Sort by UTC start then stable public shift ID. For target dates, compare each shift to its immediate preceding shift for rest and overlap, and union UTC intervals whose start converts into the target station's seven-date window. Emit `Unevaluable` instead of threshold judgments when requisite intervals cannot be converted. Deduplicate by kind + profile + target date + source IDs. Keep no legal copy in this class.
- [ ] **Step 4: Verify GREEN.** Rerun the focused unit tests and `dotnet build backend/Elevant.sln --configuration Release --no-restore`; expect zero failures. Commit evaluator and tests as `feat(hr): evaluate evidence-backed schedule warnings`.

### Task 2: Scoped SQL read and deterministic page

**Files:** Create `backend/Elevant.Application/Abstractions/Identity/IHumanResourcesScheduleWarningStore.cs` and `database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesScheduleWarningStore.cs`; modify `database/DevelopmentDB/Elevant.Persistence/DependencyInjection.cs`; test `backend/tests/Elevant.IntegrationTests/Persistence/HumanResourcesScheduleWarningStoreTests.cs` and the SQL migration/model-change suite.

**Interfaces:** `ScheduleWarningPage(Guid StationId, DateOnly From, DateOnly To, int Page, int Limit, bool HasMore, DateTimeOffset AsOf, string RuleVersion, DateOnly RuleEffectiveOn, IReadOnlyList<ScheduleWarning> Warnings)`; `ScheduleWarningReadResult(ScheduleWarningPage? Page, ScheduleWarningFailure? Failure)`.

- [ ] **Step 1: RED.** Seed only synthetic test agents/roles/grants and two stations in a disposable SQL test database. Assert authorized G.H. reads the selected station; an active account without G.H. gets `ForbiddenRole`; a revoked grant gets `ForbiddenStation`; a hidden station's preceding shift creates `ShortRest` with `HasRestrictedEvidence=true` but no foreign ID/code/time. Add 101 same-date warnings and assert pages 1/2 contain disjoint stable keys. Add a second call after role/grant revocation to prove live revalidation.
- [ ] **Step 2: Verify RED.** Run `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --filter FullyQualifiedName~HumanResourcesScheduleWarningStoreTests --configuration Release`; expect compilation failure for the absent store/interface. If local SQL is unavailable, use the repository's `ELEVANT_TEST_SQLSERVER_MASTER` test setup in CI and report the local skip rather than claiming a pass.
- [ ] **Step 3: GREEN.** Resolve actor through `IActorContextResolver`; require the exact G.H. role/internal membership and `actor.StationScopes` grant. Resolve active requested station and its IANA zone. Query target shifts at that station for requested 30 dates, distinct candidate ramp agents, then their confirmed shifts across all stations for the preceding six local dates plus one boundary day; project only necessary fields with `AsNoTracking`. Mark each contextual shift `CanReveal` from the actor's current station grants. Call the evaluator, retain warnings anchored to target station shifts, apply stable order and `Skip/Take(limit+1)` only after evaluation. Use `TimeProvider.GetUtcNow()` for `AsOf`; do not materialize unrelated agents or station details in the response.
- [ ] **Step 4: Verify GREEN.** Rerun store tests, `dotnet ef migrations has-pending-model-changes --project database/DevelopmentDB/Elevant.Persistence --startup-project backend/Elevant.Api --context ElevantDbContext --configuration Release --no-build`, and confirm no migration is generated. Commit as `feat(hr): query station-scoped schedule warnings`.

### Task 3: Private API and generated client

**Files:** Create `backend/Elevant.Contracts/Identity/HumanResourcesScheduleWarningContracts.cs`, `backend/Elevant.Api/Controllers/HumanResourcesScheduleWarningsController.cs`; test `backend/tests/Elevant.IntegrationTests/Api/HumanResourcesScheduleWarningEndpointsTests.cs`; regenerate `packages/api-client/openapi/elevant-v1.json` and `packages/api-client/generated/*`; modify `packages/api-client/src/client.ts`; test `packages/api-client/tests/human-resources-schedule-warnings-client.test.ts`.

**Interfaces:** `GET /api/v1/human-resources/schedule-warnings?stationId=<guid>&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=20`. Response includes `stationId`, `from`, `to`, `page`, `limit`, `hasMore`, `asOf`, `ruleVersion`, `ruleEffectiveOn`, `warnings`; each warning includes only visible evidence and the restricted-evidence flag.

- [ ] **Step 1: RED.** API tests assert 401 anonymous, 400 for empty station/31 inclusive dates/page zero/limit 101, 403 no G.H. role, 404 missing grant, 200 typed data with `Cache-Control: no-store`, and no hidden station code/ID/time in serialized JSON. Client tests assert exact query mapping, bearer header, abort propagation and Problem Details error status.
- [ ] **Step 2: Verify RED.** Run focused `HumanResourcesScheduleWarningEndpointsTests` and `npm --prefix packages/api-client test -- human-resources-schedule-warnings-client.test.ts`; expect missing route/method failures.
- [ ] **Step 3: GREEN.** Map bearer `sub` to actor ID; validate `DateOnly` range and paging before the store; map role failure to 403 and station failure to 404; use `[PrivateResponse]`. Add only public response models to `Elevant.Contracts`. Refresh OpenAPI from a locally running API with `npm --prefix packages/api-client run refresh:openapi -- http://127.0.0.1:8080/swagger/v1/swagger.json`, then `npm --prefix packages/api-client run generate`; add a typed facade method without hand-editing `generated`.
- [ ] **Step 4: Verify GREEN.** Rerun focused API/client tests, `npm --prefix packages/api-client run check`, and `dotnet build backend/Elevant.sln --configuration Release --no-restore`. Review generated diff for unrelated endpoint drift. Commit as `feat(hr): publish schedule warning contract`.

### Task 4: AVIAM roster warning panel and documentation

**Files:** Create `frontend/private-web/src/services/humanResourcesScheduleWarningsService.js` and `frontend/private-web/src/features/human-resources/schedules/ScheduleWarningsPanel.jsx`; modify `frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.jsx`; test `CurrentShiftsPage.test.jsx` and new `ScheduleWarningsPanel.test.jsx`; update `frontend/private-web/README.md`, `backend/README.md`, `docs/api/openapi-contract.md` and `Vault/05-aplicaciones/private-web-aviam.md`.

**Interfaces:** `getHumanResourcesScheduleWarnings({stationId, from, to, page, limit}, {signal})` captures the current access token at request start, calls the generated-client facade and rejects a response if `readSession()?.token` changed. The panel accepts `session.stationScopes`, range and refresh revision; no client threshold calculation.

- [ ] **Step 1: RED.** Vitest renders no warning for an authorized empty page, an `Unevaluable` row with a reason, a cross-station warning with only `Evidencia restringida`, and a short-rest row labeled as preliminary. Test station switch, 403/404, focus/online refresh and a former-session promise resolving late; previous private rows must disappear. Assert there is no wording that claims labor-law compliance or paid overtime.
- [ ] **Step 2: Verify RED.** Run `npm --prefix frontend/private-web test -- ScheduleWarningsPanel.test.jsx CurrentShiftsPage.test.jsx`; expect the new panel/service tests to fail before implementation.
- [ ] **Step 3: GREEN.** Use `useAuth()` station grants to select an authorized station (default first grant), keep station/range/page in component state, request the server page with an `AbortController` and request version, and clear rows whenever token, station or range changes. Refresh on `hr_shifts` account-change hints, focus and online; show explicit loading/empty/unevaluable/error/unauthorized states. Render only server-provided measured minutes and rule/version, and link visible shift IDs back to the roster without exposing restricted evidence.
- [ ] **Step 4: Verify GREEN.** Run focused Vitest and `npm --prefix frontend/private-web run build`, then the affected .NET suite, `npm run vault:generate`, `npm run vault:check`, `npm run check`, and `git diff --check`. Inspect generated files, secret scan and README/Vault source links. Commit as `feat(hr): show scoped planning warnings in roster`.
- [ ] **Step 5: Delivery.** Open PR against `Development`, require green CI, merge under the user's existing authorization, and verify Development delivery. Ask the operator for API/AVIAM controller states before claiming VPS availability. A real authenticated Playwright smoke must cover a visible warning, a station switch, refresh/reconnection and revoked access; reaching login alone does not count. Remove this worktree only after the code is integrated into the original checkout.
