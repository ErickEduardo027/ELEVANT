import { identityDocumentExample, normalizeIdentityDocument, normalizePhone } from "@elevant/api-client";
import { type GeoDivision, isCountryCode } from "./geo/catalog";

export const TITLE_OTHER = "Otro";

/** Roles an airline usually sends to request ground-handling services. */
export const REPRESENTATIVE_TITLES = [
  "Gerente de estación",
  "Gerente de aeropuerto",
  "Gerente de operaciones",
  "Gerente regional",
  "Gerente de país",
  "Director(a) de operaciones",
  "Director(a) comercial",
  "Director(a) general",
  "Coordinador(a) de operaciones terrestres",
  "Supervisor(a) de rampa",
  "Despachador(a) de vuelo",
  "Gerente de carga",
  "Gerente de compras",
  "Gerente de contratos",
  "Representante legal",
  TITLE_OTHER,
] as const;

export const REPRESENTATIVE_FIELDS = [
  "name", "titleOption", "titleCustom", "email", "phone", "nationalityCode",
  "documentType", "documentNumber", "address", "country", "province",
  "municipality", "district", "authorityDeclared",
] as const;

export type RepresentativeField = (typeof REPRESENTATIVE_FIELDS)[number];

export type RepresentativeDraft = {
  name: string; titleOption: string; titleCustom: string; email: string; phone: string;
  authorityDeclared: boolean; nationalityCode: string; address: string;
  /** ISO 3166-1 alpha-2 code. */
  country: string;
  /** Division code within the country. */
  province: string;
  municipality: string;
  /** Municipal district (D. M.), only for countries that publish them. */
  district: string;
  documentType: string; documentNumber: string;
};

export type RepresentativeErrors = Partial<Record<RepresentativeField, string>>;

export type RepresentativeValidation =
  | { ok: true }
  | { ok: false; errors: RepresentativeErrors; firstInvalidField: RepresentativeField };

/** `null` while the country's divisions are still loading or failed to load. */
export type DivisionsState = readonly GeoDivision[] | null;

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const TITLE_PATTERN = /^[\p{L}\p{M}\d][\p{L}\p{M}\d .,'’&/()-]*$/u;
const LETTER = /\p{L}/gu;
// Mirrors what the API accepts through .NET MailAddress: a dotted local part
// and a domain made of valid labels ending in an alphabetic TLD.
const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const DOCUMENT_PATTERN = /^[A-Za-z0-9 /-]{3,40}$/;

export function effectiveTitle(draft: Pick<RepresentativeDraft, "titleOption" | "titleCustom">): string {
  return draft.titleOption === TITLE_OTHER ? draft.titleCustom.trim() : draft.titleOption;
}

function letterCount(value: string) {
  return value.match(LETTER)?.length ?? 0;
}

export function validateRepresentative(
  draft: RepresentativeDraft,
  divisions: DivisionsState,
): RepresentativeValidation {
  const errors: RepresentativeErrors = {};

  const name = draft.name.trim();
  if (!name) errors.name = "Ingrese su nombre completo.";
  else if (name.length > 160) errors.name = "El nombre admite un máximo de 160 caracteres.";
  else if (!NAME_PATTERN.test(name) || letterCount(name) < 2)
    errors.name = "El nombre solo puede contener letras, espacios, apóstrofos, puntos y guiones.";

  if (!draft.titleOption) errors.titleOption = "Seleccione su cargo.";
  else if (!(REPRESENTATIVE_TITLES as readonly string[]).includes(draft.titleOption))
    errors.titleOption = "Seleccione un cargo de la lista.";
  else if (draft.titleOption === TITLE_OTHER) {
    const custom = draft.titleCustom.trim();
    if (!custom) errors.titleCustom = "Escriba su cargo.";
    else if (custom.length < 2 || custom.length > 120) errors.titleCustom = "El cargo debe tener entre 2 y 120 caracteres.";
    else if (!TITLE_PATTERN.test(custom) || letterCount(custom) < 2)
      errors.titleCustom = "Ingrese un cargo válido, sin símbolos especiales.";
  }

  const email = draft.email.trim();
  if (!email) errors.email = "Ingrese su correo electrónico corporativo.";
  else if (email.length > 256 || !EMAIL_PATTERN.test(email)) errors.email = "Ingrese un correo electrónico válido.";

  const phone = draft.phone.trim();
  if (!phone) errors.phone = "Ingrese su teléfono.";
  else if (normalizePhone(phone) === null)
    errors.phone = "Ingrese un teléfono dominicano de 10 dígitos (809, 829 o 849, p. ej. 849-246-3371) o uno extranjero con su prefijo (+ o 00).";

  if (draft.nationalityCode && !isCountryCode(draft.nationalityCode))
    errors.nationalityCode = "Seleccione una nacionalidad de la lista.";

  const documentNumber = draft.documentNumber.trim();
  if (draft.documentType && !["NationalId", "Passport", "Other"].includes(draft.documentType))
    errors.documentType = "Seleccione un tipo de documento de la lista.";
  else if (draft.documentType && !documentNumber)
    errors.documentNumber = "Ingrese el número del documento indicado.";
  else if (!draft.documentType && documentNumber)
    errors.documentType = "Seleccione el tipo del documento indicado.";
  else if (documentNumber && draft.documentType === "NationalId" &&
    normalizeIdentityDocument("Cedula", documentNumber) === null)
    errors.documentNumber = `La cédula no es válida: revise los 11 dígitos y el dígito verificador. Formato: ${identityDocumentExample("Cedula")}.`;
  else if (documentNumber && draft.documentType === "Passport" &&
    normalizeIdentityDocument("Passport", documentNumber, draft.nationalityCode) === null)
    errors.documentNumber = `El número de pasaporte no tiene el formato esperado: ${identityDocumentExample("Passport", draft.nationalityCode)}.`;
  else if (documentNumber && draft.documentType === "Other" && !DOCUMENT_PATTERN.test(documentNumber))
    errors.documentNumber = "El número de documento debe tener entre 3 y 40 letras, dígitos, espacios, / o -.";

  if (draft.address.trim().length > 250) errors.address = "La dirección admite un máximo de 250 caracteres.";

  if (!draft.country) errors.country = "Seleccione su país.";
  else if (!isCountryCode(draft.country)) errors.country = "Seleccione un país de la lista.";
  else if (divisions === null) errors.province = "Espere a que carguen las provincias, estados o regiones del país.";
  else if (divisions.length > 0) {
    const division = divisions.find((item) => item.code === draft.province);
    if (!draft.province) errors.province = "Seleccione la provincia, estado o región.";
    else if (!division) errors.province = "Seleccione una provincia, estado o región del país indicado.";
    else if (division.cities.length > 0) {
      if (!draft.municipality) errors.municipality = "Seleccione el municipio o ciudad.";
      else if (!division.cities.includes(draft.municipality))
        errors.municipality = "Seleccione un municipio o ciudad de la provincia indicada.";
      else if (draft.district && !(division.districts?.[draft.municipality] ?? []).includes(draft.district))
        errors.district = "Seleccione un distrito municipal del municipio indicado.";
    }
  }

  if (!draft.authorityDeclared)
    errors.authorityDeclared = "Confirme que está autorizado para presentar la solicitud.";

  const firstInvalidField = REPRESENTATIVE_FIELDS.find((field) => errors[field] !== undefined);
  return firstInvalidField ? { ok: false, errors, firstInvalidField } : { ok: true };
}
