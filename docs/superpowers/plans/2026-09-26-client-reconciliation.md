# Client reconciliation implementation plan

**Goal:** Connect all three clients to the authorized change feed, using SignalR as a low-latency hint where supported and bounded REST polling/focus/resume reconciliation as the reliability path.

**Context:** `docs/superpowers/specs/2026-09-26-integrated-development-cycle.md` and `docs/superpowers/plans/2026-09-26-change-feed.md`. The API already exposes `ChangedV1` and `GET /api/v1/changes` on this branch. The three clients remain independently deployable; do not mix the transport cursor with authorization or persist JWTs in a new store.

## Task 1 — Browser reconciliation core and AVIAM OCC

- Add official `@microsoft/signalr` JavaScript client to Private Web with its own lockfile.
- RED: unit tests for initial catch-up, hints, reconnect, focus/online, bounded polling, errors and cleanup. The observer keeps the cursor in memory, drains pages safely, and invokes callbacks only for server-visible resource types.
- GREEN: implement the observer with token callback, account-scoped lifecycle, two hubs and REST fallback. Hook the canonical OCC chat and notifications routes; retain their existing manual refresh and recoverable errors.
- Run `npm test`, `npm run build` and browser tests for OCC route transitions against a local API.

## Task 2 — Mobile Agent resume reconciliation

- RED: tests for feed catch-up on AppState foreground, polling while active, session change reset and offline/retry without dropping stable idempotency keys.
- GREEN: use `getAccountChanges` to invalidate assigned operations, chat and notifications; no platform notification or background delivery claim. Add a native SignalR transport only if the official JS client works in the Expo 54 Android bundle and emulator; otherwise retain the bounded foreground reconciliation and record the limitation.
- Run typecheck, Jest and Metro bundle checks, then test on the Pixel Tablet emulator.

## Task 3 — Public Web airline portal

- First create account-scoped airline outbox events for the relevant backend resources; never infer tenant from the browser. Then connect the authorized Public Web portal to feed-driven invalidation and fallback polling.
- Read the installed Next 16 documentation before editing the app. Preserve SSR/client boundaries and synthetic-vs-real data labeling until each module has an API contract.
- Run Next tests/build and browser session/tenant isolation tests.

## Release gates

- API/database first, then clients, with all CI checks green. No VPS mutation from this worktree.
- Prove reconnect, missed-event recovery and a measured p95 below three seconds in the Development acceptance load; fallback convergence below 30 seconds.
- Update the relevant Vault/README notes and regenerate the Vault inventory without hand-editing it.
