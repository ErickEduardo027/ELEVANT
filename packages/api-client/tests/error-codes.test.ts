import { describe, expect, it } from "vitest";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

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

  it("keeps the airline permit codes of phase 2 (block B)", () => {
    for (const code of ["review_closed", "permit_not_verified", "review_note_required", "invalid_permit",
      "permit_dates_invalid", "permit_expired", "document_invalid", "document_expired"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });
});
