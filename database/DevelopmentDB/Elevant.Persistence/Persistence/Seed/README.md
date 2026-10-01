# Seed data

Only deterministic, non-sensitive reference data may be seeded here. There is no automatic production seed process.

The six synthetic Development actors use separate deployment secrets. The seed inserts
missing identities only; it never resets an existing password, lockout state, or
failed-attempt counter. Existing accounts with missing credentials or disabled lockout
fail closed. The one-shot `rotate-development-human-resources` command recovers the
synthetic HR credential through the whitelisted
`iam.set_development_account_credential` procedure; it must not run as part of CD.
The seeder has no direct `UPDATE` permission and fails closed on identity drift.

The OCC fixtures intentionally preserve `DEV-TAT-0001`, including its historical
date mismatch, and add `DEV-TAT-0002` on 2026-08-19 as the deterministic planning
example. The second turnaround uses stand A02, the BAGGAGE contract service and a
compatible Riley Ramp shift, but starts without an agent assignment so the OCC
read and future assignment flows remain observable.

`seed-development-scenario` is a separate, operator-triggered command. It
requires `ELEVANT_DEV_SCENARIO_DATE` in `YYYY-MM-DD` station-local form and the
same Development-only seeder database identity. It adds planned synthetic
turnarounds for that date and the next, with contract-rate snapshots and
covering shifts, but no agent assignment or invented completion. Date-derived
keys make reruns idempotent; changed operational rows are never reset. The
serializable transaction fails closed on a conflicting shift, overlapping stand
window, contract outside its signed/termination dates, missing anchor or
non-Development marker. CD does not run
this command automatically.
