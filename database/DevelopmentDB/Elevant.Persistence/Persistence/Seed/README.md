# Seed data

Only deterministic, non-sensitive reference data may be seeded here. There is no automatic production seed process.

The three synthetic Development actors use separate deployment secrets. Reconciliation
enables lockout and rotates only a missing, rejected, or legacy password hash through
the whitelisted `iam.set_development_account_credential` procedure. The seeder retains
no direct `UPDATE` permission, never clears lockout state or failed-attempt counters,
and fails closed if a deterministic person/account identity has drifted.

The OCC fixtures intentionally preserve `DEV-TAT-0001`, including its historical
date mismatch, and add `DEV-TAT-0002` on 2026-08-19 as the deterministic planning
example. The second turnaround uses stand A02, the BAGGAGE contract service and a
compatible Riley Ramp shift, but starts without an agent assignment so the OCC
read and future assignment flows remain observable.
