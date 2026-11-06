import { describe, expect, it } from "vitest";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

// Every block adds its own `as const` list to ELEVANT_API_ERROR_CODES; a code lives in one list only.
describe("Problem Details codes", () => {
  it("lists every code once, generic command codes included", () => {
    expect(new Set(ELEVANT_API_ERROR_CODES).size).toBe(ELEVANT_API_ERROR_CODES.length);
    for (const code of ["version_conflict", "idempotency_conflict", "idempotency_key_required", "expected_version_required",
      "reason_required", "not_found", "airline_already_contracted", "airline_has_portal_account", "airline_code_in_use",
      "representative_unconfirmed", "request_closed"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
  });
});
