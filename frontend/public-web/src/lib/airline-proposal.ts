import type { ProposedAirlineRequest } from "@elevant/api-client";
import { isCountryCode } from "./geo/catalog";

/**
 * «Mi aerolínea no aparece» (1-N25): the applicant describes an airline that is not in the public
 * catalog. Contratos verifies it with an official source before any approval. Only the ICAO code
 * is required; an operator without IATA designator leaves it empty (1-N17).
 */
export type AirlineProposalDraft = {
  name: string; countryCode: string; iataCode: string; icaoCode: string; websiteUrl: string;
};
export type AirlineProposalField = keyof AirlineProposalDraft;

export const emptyAirlineProposal: AirlineProposalDraft = {
  name: "", countryCode: "", iataCode: "", icaoCode: "", websiteUrl: "",
};

// Placeholder designators the API rejects, so they are refused while typing too.
const RESERVED_IATA = new Set(["YY", "ZZ", "XX", "QQ"]);
const RESERVED_ICAO = new Set(["YYY", "ZZZ", "XXX", "ZXX"]);

export type AirlineProposalValidation =
  | { ok: true; value: ProposedAirlineRequest; errors: Partial<Record<AirlineProposalField, string>> }
  | { ok: false; errors: Partial<Record<AirlineProposalField, string>>; firstInvalidField: AirlineProposalField };

export function validateAirlineProposal(draft: AirlineProposalDraft): AirlineProposalValidation {
  const name = draft.name.trim();
  const countryCode = draft.countryCode.trim().toUpperCase();
  const iataCode = draft.iataCode.trim().toUpperCase();
  const icaoCode = draft.icaoCode.trim().toUpperCase();
  const websiteUrl = draft.websiteUrl.trim();
  const errors: Partial<Record<AirlineProposalField, string>> = {};
  if (name.length < 2 || name.length > 160) errors.name = "Escriba el nombre de la aerolínea.";
  if (!isCountryCode(countryCode)) errors.countryCode = "Seleccione el país de la aerolínea.";
  if (iataCode && (!/^[A-Z0-9]{2}$/.test(iataCode) || /^\d{2}$/.test(iataCode) || RESERVED_IATA.has(iataCode)))
    errors.iataCode = "El código IATA tiene 2 caracteres: dos letras, o una letra y un número. Déjelo vacío si la aerolínea no tiene.";
  if (!/^[A-Z]{3}$/.test(icaoCode) || RESERVED_ICAO.has(icaoCode))
    errors.icaoCode = "Escriba el código ICAO de la aerolínea: 3 letras.";
  if (websiteUrl && !isHttpsUrl(websiteUrl))
    errors.websiteUrl = "Escriba la dirección completa del sitio oficial, con https://.";
  const fields: AirlineProposalField[] = ["name", "countryCode", "iataCode", "icaoCode", "websiteUrl"];
  const firstInvalidField = fields.find((field) => errors[field]);
  if (firstInvalidField) return { ok: false, errors, firstInvalidField };
  return {
    ok: true, errors,
    value: { name, countryCode, iataCode: iataCode || null, icaoCode, websiteUrl: websiteUrl || null },
  };
}

function isHttpsUrl(value: string) {
  if (value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch {
    return false;
  }
}
