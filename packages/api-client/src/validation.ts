// Mirrors backend/Elevant.Domain/Validation (PhoneNumbers, IdentityDocuments). Keep both in sync:
// the server is authoritative, these exist so forms can explain the rule before sending.

export const DOMINICAN_AREA_CODES = ["809", "829", "849"] as const;

/**
 * E.164 form of a phone (e.g. +18492463371) or null. Dominican numbers are accepted with or
 * without the country code and with any spacing; other countries need their + or 00 prefix.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (!value || value.length > 32) return null;
  let international = false;
  if (value.startsWith("+")) { international = true; value = value.slice(1); }
  else if (value.startsWith("00")) { international = true; value = value.slice(2); }
  if (/[^0-9 ().-]/.test(value)) return null;
  let digits = value.replace(/\D/g, "");
  if (international) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
    if (digits.startsWith("1") && digits.length !== 11) return null;
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 && (DOMINICAN_AREA_CODES as readonly string[]).includes(digits.slice(0, 3))
    ? `+1${digits}` : null;
}

export type IdentityDocumentKind = "Cedula" | "Residence" | "Passport" | "Rnc";

function compact(number: string | null | undefined): string | null {
  if (typeof number !== "string") return null;
  const trimmed = number.trim();
  if (!trimmed || trimmed.length > 40) return null;
  const value = trimmed.replace(/[ .-]/g, "");
  return /^[A-Za-z0-9]+$/.test(value) ? value.toUpperCase() : null;
}

function isCedula(value: string): boolean {
  if (!/^\d{11}$/.test(value) || new Set(value).size === 1) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const product = Number(value[index]) * (index % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return (10 - sum % 10) % 10 === Number(value[10]);
}

function isPassport(value: string, nationality?: string | null): boolean {
  if (nationality?.trim().toUpperCase() === "DO") return /^[A-Z]{2}\d{7}$/.test(value);
  return value.length >= 6 && value.length <= 9 && /\d/.test(value) && new Set(value).size > 2;
}

function isRnc(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = sum % 11;
  const check = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  return check === Number(value[8]);
}

/** Canonical number (upper-case letters and digits) when valid for the kind, otherwise null. */
export function normalizeIdentityDocument(kind: IdentityDocumentKind, number: string | null | undefined,
  nationality?: string | null): string | null {
  const value = compact(number);
  if (!value) return null;
  switch (kind) {
    case "Cedula":
    case "Residence": return isCedula(value) ? value : null;
    case "Passport": return isPassport(value, nationality) ? value : null;
    case "Rnc": return isRnc(value) ? value : null;
    default: return null;
  }
}

/** Example shown next to the error so people know the expected shape. */
export function identityDocumentExample(kind: IdentityDocumentKind, nationality?: string | null): string {
  switch (kind) {
    case "Cedula":
    case "Residence": return "001-1234567-8 (11 dígitos)";
    case "Passport": return nationality?.trim().toUpperCase() === "DO"
      ? "RD1234567 (2 letras y 7 dígitos)" : "6 a 9 letras y dígitos, p. ej. X1234567";
    case "Rnc": return "1-01-12345-6 (9 dígitos)";
    default: return "";
  }
}
