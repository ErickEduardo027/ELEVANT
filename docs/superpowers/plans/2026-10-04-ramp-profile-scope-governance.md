# Ramp-agent profile scope and governance

Status: implementation plan for a separate Development feature branch. This is an additive slice of the HR interview design; it does not provision accounts, send invitations, or alter Production.

## Current evidence

- `RampProfilesPanel` is the active GH personnel route and already persists name, employee number, category, hire date, station scope and avatar through `/api/v1/human-resources/ramp-profiles`.
- The schema already has `hr.ramp_agent_terminal_scopes` and `hr.ramp_agents.supervisor_agent_id`; the profile contract does not expose either. No migration is needed for those fields.
- `EfRampProfileStore.SaveAsync` currently mirrors GH profile station additions to an existing account's `AccountStationScopes`. That bypasses the Superadministration approval boundary. `EfGovernanceStore` provisions the mobile account and its initial station grants.

## Behavior to deliver

GH can select active terminals belonging to the profile's stations and an active supervisor profile, and see both when reopening the profile. New clients submit the selected terminal IDs; an omitted terminal field preserves existing terminal scopes on update for compatibility. An explicit empty list clears them. A nested optional supervisor selection distinguishes omitted (preserve) from `{ "id": null }` (clear). A supervisor cannot be the same profile or introduce a cycle in the supervision chain. On create, omitted fields mean no terminals and no supervisor so old clients keep working; the new UI requires at least one terminal for an active profile.

GH can narrow or deactivate a profile. This revokes account station grants that are no longer backed by the profile; it never adds account grants. Only Superadministration can create or expand an account's grant. The UI shows “sin cuenta vinculada” until an account exists, rather than implying a request was created or an email invitation was sent.

## Tasks (RED → GREEN)

1. Add SQL-backed persistence tests for terminal/supervisor create, update, clear, invalid cross-station terminal, self-supervision, supervision cycles, and station-grant non-escalation. Confirm failures before implementation. Add contract/API tests for additive fields.
2. Extend the profile DTO/catalog and EF store using the existing schema. Keep station and terminal changes atomic, preserve historical valid ranges, and emit the existing audit/outbox once. Revoke unsupported account grants without auto-granting new ones. Run focused SQL and API tests.
3. Add station-dependent terminal checkboxes and supervisor selection to `RampProfilesPanel`, with explicit empty/clear semantics and honest account status. Add React tests for create/edit and error preservation; run focused frontend tests.
4. Refresh OpenAPI from a local Testing API, regenerate the shared client and digest test, update backend/database/frontend README and relevant Vault current-state note. Regenerate Vault inventory using the repository command.
5. Run full backend, API-client and private-web suites/build; validate Vault and `git diff --check`; review authorization and scope behavior before commit. No GitHub merge or VPS promotion in this slice.

## Acceptance boundaries

No profile edit may create an `iam.account_station_scopes` grant. Existing mobile access that has been narrowed by GH cannot be restored merely by re-adding a profile station; Superadministration must reapprove it. Historic shifts and operations remain intact. The profile UI must not call legacy `/api/hr/*` prototype endpoints or claim an invitation was sent.
