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

  it("names the tablet evidence rules of phase 3 (block C)", () => {
    for (const code of ["time_outside_operation_window", "milestone_out_of_order", "service_time_out_of_order",
      "ramp_operation_state_conflict", "invalid_ramp_command", "idempotency_conflict", "not_found"])
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

  it("knows the planning codes of phase 3 (block A)", () => {
    for (const code of ["operation_started", "turnaround_closed", "assigned_agent_unavailable", "invalid_turnaround_change",
      "arrival_locked", "aircraft_type_locked", "flight_already_planned", "invalid_charter_airline", "invalid_position_request",
      "aircraft_type_unavailable", "stand_unavailable", "contract_not_in_force", "airline_code_in_use"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // A rescheduled flight keeps its agent only inside the shift and within three simultaneous operations.
    for (const reason of ["shift_not_covering", "simultaneous_limit", "stand_taken", "stand_narrowbody_only"])
      expect(ELEVANT_RULE_REASONS).toContain(reason);
  });

  it("knows the coverage, assignment and handover codes of phase 3 (block B)", () => {
    for (const code of ["assignment_changed", "handover_not_allowed", "same_agent", "agent_not_eligible",
      "invalid_handover", "shift_not_found", "invalid_coverage_request", "coverage_rejected", "operation_started"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // An adjusted shift keeps covering the agent's work and a validated attendance freezes it (3-E).
    for (const code of ["shift_uncovers_work", "attendance_validated", "shift_day_taken", "shift_in_past"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // A coverage needs the agent's scope in its terminal (3-N05); a junior needs a mentor.
    for (const reason of ["terminal_scope_missing", "mentor_required"]) expect(ELEVANT_RULE_REASONS).toContain(reason);
  });

  it("knows the review, incident and charter codes of phase 3 (block D)", () => {
    for (const code of ["invalid_review_request", "service_order_unsigned", "service_order_stale", "review_already_decided",
      "review_not_approved", "reopened_review_cannot_return", "already_invoiced", "billing_exclusion_not_allowed",
      "charge_excluded_by_contract", "charge_not_applicable", "charge_already_marked", "charge_already_removed",
      "incident_transition_invalid", "incident_report_invalid", "incident_occurred_at_invalid", "operation_closed",
      "charter_prepayment_confirmed", "charter_prepayment_not_confirmed", "review_closed"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // already_invoiced is also the reason the e-CF issuance names (ADR-0035).
    expect(ELEVANT_RULE_REASONS).toContain("already_invoiced");
  });

  it("knows the report codes of phase 3 (block E)", () => {
    for (const code of ["report_too_large", "invalid_report_query", "report_not_found", "station_unavailable"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });

  it("knows the invoicing and treasury codes of phase 4 (block A)", () => {
    // 4-N01, 4-N06, 4-N07, 4-N18, 4-N29: every refusal of the issuance, «Por facturar» and the no-charge closure.
    for (const code of ["invalid_invoice_request", "invalid_pending_query", "invoice_state_changed", "zero_total",
      "operation_has_charge", "too_many_lines", "too_many_operations", "date_window_exceeded", "station_inactive",
      "airline_inactive", "mixed_airline", "mixed_currency", "nothing_to_invoice", "operation_not_approved",
      "already_invoiced", "pending_preinvoice", "exchange_rate_missing", "contract_charge_rate_missing",
      "charge_definition_missing", "package_scope_has_unissued_preinvoice", "ambiguous_package_coverage",
      "charge_excluded_by_contract", "invalid_amount", "idempotency_conflict", "version_conflict"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    // 4-N10: the business day of the invoice or the receipt, and the defaults of treasury.
    for (const code of ["effective_before_invoice", "effective_before_receipt", "treasury_conflict",
      "invalid_treasury_request"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });

  it("knows the simplified Finance codes of phase 4 (block B)", () => {
    // 4-N12: a legacy write answers 410; 4-A: a retired report and a bad export format; 4-N21 and 4-A: the queries of
    // «Facturas» and «Inicio». The report query and the refusal keep their shared codes.
    for (const code of ["legacy_finance_route_retired", "unknown_finance_report", "invalid_report_export_format",
      "invalid_invoice_query", "invalid_finance_home_query", "invalid_report_query", "forbidden", "not_found"])
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
