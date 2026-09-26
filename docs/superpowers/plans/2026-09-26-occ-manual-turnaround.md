# OCC manual turnaround slice

## Goal

Allow an authorized OCC account to create a current, contract-covered turnaround
from AVIAM Planning, then use the existing assignment flow. This is one slice of
the integrated Development cycle, not a claim that billing or onboarding exists.

## Contract and rules

- `GET /api/v1/occ/planning/manual-options?stationId&date` returns the station
  airport, active terminal stands and airlines with exactly one active, approved contract version that
  covers the selected station and date. Station access comes from live OCC
  account role/membership/scope; no caller-supplied tenant authority.
- `POST /api/v1/occ/planning/turnarounds` accepts a caller-generated UUID
  `turnaroundId`, selected station/airline/stand, operation date, arrival/departure
  numbers and airport IATA codes, and scheduled UTC instants. The arrival must
  land at the station and the departure must leave it, with a positive service
  window. The station-local arrival date must equal the operation date.
- A transaction writes Manual/Confirmed turnaround, both Manual flight legs,
  Planned ground operation, a non-overlapping stand assignment, initial status history, audit and a tenant-scoped
  change hint. Repeating the same UUID and identical input returns the prior
  result; same UUID with different input returns 409. Concurrent duplicates
  cannot create two operations. No direct SQL from clients.
- Fail closed on revocation, inactive station/airline/stand, overlapping stand window, no or ambiguous contract,
  missing airport, route/date conflict, and invalid payload. Never expose an
  out-of-scope turnaround in an idempotent replay.

## Implementation sequence

1. Add handler/unit tests for authorization, station/date/route validation,
   and mapping of scoped store outcomes; make them fail before implementation.
2. Add persistence contract and SQL-backed store with serialized write,
   idempotent replay and transaction verification. Add SQL integration tests
   for creation, replay, conflicting replay, revocation and rollback.
3. Add HTTP requests/responses, controller routes and OpenAPI contract tests.
   Refresh the certified OpenAPI and shared API client; run client contract
   tests before frontend integration.
4. Add a responsive AVIAM Planning creation dialog, data service and tests for
   loading/empty/error/unauthorized, validation, retries and snapshot refresh.
   Manual import/export controls stay disabled.
5. Run focused then subtree suites, browser checks, secret scan, Vault update,
   generated inventory/checks, and commit as a cohesive Development branch
   slice. No VPS promotion or merge from this plan.

## Verification bar

The API test must prove one turnaround + two legs + one planned operation and
one audit event after a successful request; a network retry must not duplicate
any row. Browser checks must use the API contract (not a local mock shape).
Local UI stubs alone do not count as live VPS evidence.
