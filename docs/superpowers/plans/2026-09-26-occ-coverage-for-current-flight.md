# OCC coverage for a current manual flight

## Blocking fact

The Development fixture schedules the only synthetic ramp agent on 2026-08-18
and 2026-08-19. A turnaround created for the current date is correctly shown
as `shift_not_compatible` and cannot enter the existing OCC -> Mobile path.

## Scoped slice

Provide a guarded OCC command to program one agent shift for an authorized,
planned turnaround. The API derives station, terminal, operation date and the
active `RAMP-AGENT` position from canonical rows. OCC selects an agent and a
local shift interval; the server checks active internal mobile
account, agent station/terminal scopes, permit and required qualification,
absence of conflicting same-day shift, interval coverage of the operation,
and current OCC scope. It writes the shift and audit in one transaction.
Repeating an identical request on the same shift returns the existing result;
conflicting schedules are rejected. The command does not assign the operation
or bypass the normal ETag/eligibility check.

Offer only eligible agent and position choices in an OCC panel beside the
existing assignment manifest. After a successful schedule, refresh planning
options and obtain a new ETag before enabling assignment. No automatic
synthetic daily seed, direct client SQL or general HR scheduling is implied.

## Order and verification

1. Add handler and policy tests for validation, revocation and idempotent
   outcomes; then persistence SQL tests for creation, replay, conflict and
   rollback.
2. Add versioned HTTP/OpenAPI contract, generated shared client and tests.
3. Add AVIAM UI states and tests, including refresh/new ETag after success.
4. Run subtree suites and an API-backed browser drill, update README/Vault,
   generate inventory and commit this slice. Do not merge or deploy here.
