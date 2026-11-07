import { describe, expect, it } from "vitest";
import { ELEVANT_API_ERROR_CODES, ELEVANT_RULE_REASONS } from "../src/errors";

// Every block adds its own `as const` list to ELEVANT_API_ERROR_CODES; a code lives in one list only.
describe("Problem Details codes", () => {
  it("lists every code once, generic command codes included", () => {
    expect(new Set(ELEVANT_API_ERROR_CODES).size).toBe(ELEVANT_API_ERROR_CODES.length);
    for (const code of ["version_conflict", "idempotency_conflict", "idempotency_key_required", "expected_version_required",
      "reason_required", "not_found", "airline_already_contracted", "airline_has_portal_account", "airline_code_in_use",
      "representative_unconfirmed", "request_closed", "email_has_account", "email_in_use_other_airline",
      "email_in_use_internal", "account_disabled", "account_not_found", "airline_identity_locked"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });

  it("keeps the contract lifecycle codes of phase 2 (block A)", () => {
    for (const code of ["content_changed", "contract_terminated", "termination_scheduled", "termination_not_scheduled",
      "termination_date_required", "termination_notice_not_met", "immediate_cause_invalid", "version_awaiting_signatures",
      "version_signed", "airline_signed_other_content", "already_signed", "not_approved", "forbidden"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });

  it("keeps the master data and flight feed codes of phase 2 (block C)", () => {
    for (const code of ["station_code_taken", "airport_has_station", "airport_icao_taken", "invalid_station",
      "invalid_time_zone", "airport_required", "time_zone_locked", "station_in_use", "terminal_code_taken",
      "stand_code_taken", "aircraft_type_code_taken", "invalid_terminal", "invalid_stand", "invalid_aircraft_type",
      "terminal_in_use", "stand_in_use", "aircraft_type_in_use", "terminal_code_locked", "stand_code_locked",
      "terminal_inactive", "invalid_flight_feed_query", "invalid_flight_import", "flight_proposals_not_pairable",
      "flight_proposal_closed", "flight_counterpart_unknown", "contract_not_in_force", "contract_ambiguous",
      "charter_has_contract", "charter_required", "airline_inactive", "flight_proposal_not_dismissed",
      "flight_proposal_passed", "aircraft_type_unavailable", "stand_unavailable"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // A stand in use, or one of an inactive terminal, also comes back as the rule of a rejected coverage configuration
    // (422).
    for (const reason of ["stand_in_use", "terminal_inactive"]) expect(ELEVANT_RULE_REASONS).toContain(reason);
  });

  it("keeps the human resources codes of phase 2 (block D)", () => {
    for (const code of ["agent_has_operation_in_progress", "invalid_availability_request", "agent_unavailable",
      "availability_overlap", "availability_request_closed", "absence_not_approved", "absence_started", "absence_ended",
      "absence_end_invalid", "invalid_absence_amendment", "invalid_shift", "shift_scope_missing", "shift_day_taken",
      "shift_on_approved_absence", "shift_in_past", "shift_in_use", "invalid_readiness_query"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // A mentor on an approved absence or without a current airport permit is a rule of a rejected coverage (2-N23).
    for (const reason of ["mentor_absent", "mentor_permit_required"]) expect(ELEVANT_RULE_REASONS).toContain(reason);
  });

  it("keeps the airline permit codes of phase 2 (block B)", () => {
    for (const code of ["review_closed", "permit_not_verified", "review_note_required", "invalid_permit",
      "permit_dates_invalid", "permit_expired", "document_invalid", "document_expired"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });

  it("keeps the access codes of phase 2 (block E)", () => {
    for (const code of ["device_revoked", "device_in_use_by_active_agent", "device_platform_mismatch", "device_not_bound",
      "device_conflict", "invalid_mobile_device", "signer_required", "representative_required", "portal_user_protected",
      "last_representative", "invalid_portal_user", "employee_transferred", "requester_no_longer_administrator",
      "legacy_governance_retired", "access_request_closed", "invalid_governance_data", "governance_conflict",
      "protected_user"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });
});
