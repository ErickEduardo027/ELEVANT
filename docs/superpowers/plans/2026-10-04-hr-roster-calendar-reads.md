# Gestión Humana roster calendar reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Gestión Humana inspect canonical ramp shifts by week, 15-day interval, or calendar month without claiming edit rights or loading prototype schedules.

**Architecture:** Extend the existing authenticated, paginated shift GET to at most 31 inclusive local dates; retain the same EF projection and GH/Superadmin authorization. The AVIAM page derives date-only ranges from local calendar components, pages through results, and keeps the existing absence-request panel on the selected week because its separate API remains weekly.

**Tech Stack:** .NET 10, EF Core, xUnit, Vite 6, React 18, Vitest, OpenAPI client snapshot.

**Spec:** `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md` (GH 15-day/month read; OCC remains sole editor).

## Global Constraints

- One API and one Development database; no SQL access from web.
- No new migration, fake schedule, Production change, or alteration of OCC write ownership.
- Keep `GET /api/v1/human-resources/shifts` pagination and private no-store response; widen its accepted date span additively.
- Preserve local `YYYY-MM-DD` dates across browser and station time zones; never derive them from `toISOString()`.
- This PR does not add OCC roster editing, pattern templates, or attendance validation. Those remain separate reviewed slices.

## Review Focus

- Month length (28, 29, 30, 31 days): a selected month ends on its real final date; test February in leap year and 31-day month.
- Range boundary: accept 31 inclusive days and reject 32, reversed, missing, or out-of-range paging; test HTTP and persistence guard.
- Refetch safety: switching mode/date or losing access clears old rows and prevents an obsolete response from repainting them; test rendered state.
- Page behavior: switching ranges resets page to one, while next/previous page keeps exact range; test rendered page and request.
- Absence boundary: in 15-day/month mode the separate weekly request panel stays scoped and is visibly labeled as the anchor week; test rendered label/query.

---

### Task 1: Widen the canonical shift read boundary

**Files:**
- Modify: `backend/Elevant.Api/Controllers/HumanResourcesShiftsController.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesShiftReadStore.cs`
- Modify/Test: `backend/tests/Elevant.IntegrationTests/Api/HumanResourcesShiftEndpointsTests.cs`
- Modify/Test: `backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs`
- Modify/Test: `packages/api-client/src/client.ts` and `packages/api-client/tests/human-resources-shift-client.test.ts`

**Interfaces:** Keep `IHumanResourcesShiftReadStore.ListAsync(Guid, DateOnly, DateOnly, int, int, CancellationToken)` and `HumanResourcesShiftPage` unchanged.

- [ ] Add HTTP tests: `from=2026-10-01&to=2026-10-31` and `from=2028-02-01&to=2028-02-29` return the stub page and exact arguments; `2026-10-01..2026-11-01` returns 400 before store call. Preserve 401/403 tests.
- [ ] Run the focused HTTP test and confirm RED: the 31-day request currently returns 400.
- [ ] Change both controller and EF guard from `> 6` to `> 30`; do not change the query sort, page cap, or authorization.
- [ ] Run the HTTP test GREEN; add a SQL-backed read of seeded rows over a 31-day range and a direct 32-day guard, proving persistence agrees with HTTP.
- [ ] Run the focused SQL test GREEN and commit this task.
- [ ] Add a real API-client test for a 31-day query, confirm RED on its old seven-day validator, widen that validator to 31 inclusive days, and run GREEN. Reject a 32-day query before fetch.

### Task 2: Derive local calendar ranges and display modes

**Files:**
- Create: `frontend/private-web/src/features/human-resources/schedules/rosterRange.js`
- Create/Test: `frontend/private-web/src/features/human-resources/schedules/rosterRange.test.js`
- Modify: `frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.jsx`
- Modify/Test: `frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.test.jsx`
- Modify/Test: `frontend/private-web/src/services/humanResourcesShiftsReadService.test.js`

**Interfaces:** `getRosterRange(mode, anchor)` returns `{ from, to, label }` with date-only strings; `shiftRosterAnchor(mode, anchor, delta)` returns a local `Date`. Modes are `week`, `fortnight`, `month`.

- [ ] Test literal ranges: week of 2026-08-18 is 17–23 August; 15 days from 2026-08-17 end 31 August; leap February 2028 ends on 29; October 2026 ends on 31. Navigation moves by 7, 15, or one calendar month without UTC conversion.
- [ ] Run helper test RED because module is absent. Implement only those pure date functions using `Date` local components, `addDays`, `getWeekStart`, and `toDateKey`. Run GREEN.
- [ ] Add React tests that select `15 días` and `Mes`, assert API query `{from,to,page:1,limit:20}`, page reset when mode changes, old rows cleared on 403, and absence panel still receives the selected week. Run RED against current page.
- [ ] Replace week-only navigation with mode controls and range-aware previous/next/today actions. Keep 20-row pagination and show its page clearly; render a truthful empty state and weekly-scope label for absence requests. Keep `requestVersion`/AbortController stale-response protection. Run GREEN.
- [ ] Commit this task.
- [ ] Prove that the page's monthly query passes through the session-bearing service; the shared client test proves the actual URL and response validation rather than a mocked service alone.

### Task 3: Contract, documentation, and release verification

**Files:**
- Modify: `backend/README.md`
- Modify: `frontend/private-web/README.md`
- Modify: `Vault/05-aplicaciones/private-web-aviam.md`
- Modify if regenerated: `packages/api-client/openapi/*`, `packages/api-client/generated/elevant-api.ts`, `Vault/_generated/repository-inventory.json`

**Interfaces:** Existing GET schema is unchanged; only the accepted `from`/`to` range grows.

- [ ] Document week/15-day/month read as current in source-adjacent README and Vault, explicitly keeping OCC roster editor and six templates deferred.
- [ ] Capture OpenAPI with the repository-owned snapshot tool; confirm generated output changes only if contract metadata actually changed.
- [ ] Run focused and full .NET tests, private-web tests/build, client check, Vault generate/check, secret scan, and `git diff --check`.
- [ ] Review the diff for accidental mock data, generated build output, credentials and unrelated edits. Commit documentation, request whole-branch review, then create a PR only if checks are green.

## Self-review

This slice covers the calendar-read requirement but intentionally does not implement OCC roster writes, provisional templates, labor incidences, exports, or operational documents. Those need separate plans with their own authorization and persistence tests. The five review-focus conditions each have a test in Tasks 1 or 2; this plan adds no schema or client contract shape.
