import { checkTaxRegistration, formatTaxRegistration, type TaxRegistration } from "@elevant/api-client";

/**
 * The airline's tax identifier in the public request: an RNC when the airline is Dominican, otherwise its
 * own tax identifier with the issuing country, which defaults to the airline's country.
 */
export type TaxRegistrationDraft = { number: string; countryCode: string };

export const emptyTaxRegistration: TaxRegistrationDraft = { number: "", countryCode: "" };

/** The issuing country: always DO for a Dominican airline; otherwise the chosen one or the airline's. */
export function taxCountry(draft: TaxRegistrationDraft, airlineCountry: string | null | undefined): string {
  const airline = (airlineCountry ?? "").trim().toUpperCase();
  if (airline === "DO") return "DO";
  return draft.countryCode.trim().toUpperCase() || airline;
}

export type TaxRegistrationValidation =
  | { ok: true; value: TaxRegistration; display: string }
  | { ok: false; error: string };

export function validateTaxRegistration(draft: TaxRegistrationDraft,
  airlineCountry: string | null | undefined): TaxRegistrationValidation {
  const country = taxCountry(draft, airlineCountry);
  const check = checkTaxRegistration(draft.number, country);
  return check.registration
    ? { ok: true, value: check.registration, display: formatTaxRegistration(check.registration.number, check.registration.countryCode) }
    : { ok: false, error: check.problem };
}
