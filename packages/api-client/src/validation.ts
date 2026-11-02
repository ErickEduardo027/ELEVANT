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

/** Canonical number when valid, or the first position that fails (Spanish, same text as the API). */
export type IdentityDocumentCheck = { number: string; problem: null } | { number: null; problem: string };

/** Prefix every Dominican passport number carries in positions 1–2 (AVIAM rule). */
export const DOMINICAN_PASSPORT_PREFIX = "RD";

/**
 * Position patterns of foreign passports by nationality: `A` letter, `9` digit, `X` either.
 * Countries not listed follow ICAO 9303 (6–9 letters or digits with a digit).
 */
export const PASSPORT_PATTERNS: Readonly<Record<string, readonly string[]>> = {
  US: ["999999999", "A99999999"],
  CA: ["AA999999", "A999999AA"],
};

const valid = (number: string): IdentityDocumentCheck => ({ number, problem: null });
const invalid = (problem: string): IdentityDocumentCheck => ({ number: null, problem });

function compact(number: string | null | undefined): { value: string } | { problem: string } {
  if (typeof number !== "string" || !number.trim()) return { problem: "Escribe el número del documento." };
  const trimmed = number.trim();
  if (trimmed.length > 40) return { problem: "El número es demasiado largo." };
  const value = trimmed.replace(/[ .-]/g, "");
  const wrong = [...value].find((character) => !/[A-Za-z0-9]/.test(character));
  if (wrong) return { problem: `El carácter «${wrong}» no es válido; usa solo letras y dígitos.` };
  return value ? { value: value.toUpperCase() } : { problem: "Escribe el número del documento." };
}

const country = (nationality?: string | null) => {
  const code = nationality?.trim().toUpperCase();
  return code && code.length === 2 ? code : null;
};

function checkCedula(value: string): IdentityDocumentCheck {
  if (value.length !== 11)
    return invalid(`La cédula tiene 11 dígitos (3 de oficina, 7 de secuencia y 1 verificador); escribiste ${value.length}.`);
  for (let index = 0; index < 11; index += 1)
    if (!/\d/.test(value[index]!))
      return invalid(`La posición ${index + 1} de la cédula debe ser un dígito; encontramos «${value[index]}».`);
  if (new Set(value).size === 1) return invalid("La cédula no puede repetir el mismo dígito en todas las posiciones.");
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const product = Number(value[index]) * (index % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return (10 - sum % 10) % 10 === Number(value[10])
    ? valid(value)
    : invalid("El dígito verificador (posición 11) no corresponde a los 10 anteriores; revisa el número.");
}

// "RD9999999" reads as RD1234567; "AA999999" as LL000000 (L = letra, 0 = dígito).
const describe = (pattern: string) => pattern.startsWith(DOMINICAN_PASSPORT_PREFIX) ? "RD1234567"
  : `${pattern.replace(/A/g, "L").replace(/9/g, "0")} (L = letra, 0 = dígito)`;

function mismatch(value: string, pattern: string): { position: number; expected: string } | null {
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]!;
    const actual = value[index]!;
    const ok = expected === "A" ? /[A-Z]/.test(actual) : expected === "9" ? /\d/.test(actual)
      : expected === "X" ? /[A-Z0-9]/.test(actual) : actual === expected;
    if (!ok) return { position: index, expected: expected === "A" ? "una letra" : expected === "9" ? "un dígito"
      : expected === "X" ? "una letra o un dígito" : `«${expected}»` };
  }
  return null;
}

function checkPattern(value: string, patterns: readonly string[], subject: string): IdentityDocumentCheck {
  let best: string | null = null;
  let bestScore = -1;
  for (const pattern of patterns) {
    if (pattern.length !== value.length) {
      if (bestScore < 0) {
        const lengths = [...new Set(patterns.map((item) => item.length))].sort((a, b) => a - b);
        best = `${subject} tiene ${lengths.join(" u ")} caracteres; escribiste ${value.length}.`;
      }
      continue;
    }
    const wrong = mismatch(value, pattern);
    if (!wrong) return valid(value);
    if (wrong.position > bestScore) {
      bestScore = wrong.position;
      best = `${subject}: la posición ${wrong.position + 1} debe ser ${wrong.expected}; encontramos «${value[wrong.position]}». Formato: ${describe(pattern)}.`;
    }
  }
  return invalid(best!);
}

function checkIcaoPassport(value: string): IdentityDocumentCheck {
  if (value.length < 6 || value.length > 9)
    return invalid(`El pasaporte tiene de 6 a 9 letras o dígitos (ICAO 9303); escribiste ${value.length}.`);
  if (!/\d/.test(value)) return invalid("El pasaporte debe incluir al menos un dígito.");
  return new Set(value).size > 2 ? valid(value) : invalid("El número de pasaporte no puede repetir casi el mismo carácter.");
}

function checkRnc(value: string): IdentityDocumentCheck {
  if (value.length !== 9) return invalid(`El RNC tiene 9 dígitos; escribiste ${value.length}.`);
  for (let index = 0; index < 9; index += 1)
    if (!/\d/.test(value[index]!))
      return invalid(`La posición ${index + 1} del RNC debe ser un dígito; encontramos «${value[index]}».`);
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = sum % 11;
  const check = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  return check === Number(value[8]) ? valid(value)
    : invalid("El dígito verificador del RNC (posición 9) no corresponde; revisa el número.");
}

/** Validates the document and explains the first position that fails (mirror of IdentityDocuments.Check). */
export function checkIdentityDocument(kind: IdentityDocumentKind, number: string | null | undefined,
  nationality?: string | null): IdentityDocumentCheck {
  const compacted = compact(number);
  if ("problem" in compacted) return invalid(compacted.problem);
  const value = compacted.value;
  const nation = country(nationality);
  switch (kind) {
    case "Cedula":
    case "Residence": return checkCedula(value);
    case "Passport":
      if (nation === "DO") return checkPattern(value, [`${DOMINICAN_PASSPORT_PREFIX}9999999`], "El pasaporte dominicano");
      if (nation && PASSPORT_PATTERNS[nation]) return checkPattern(value, PASSPORT_PATTERNS[nation]!, "El pasaporte");
      return checkIcaoPassport(value);
    case "Rnc": return checkRnc(value);
    default: return invalid("Tipo de documento no admitido.");
  }
}

/** Canonical number (upper-case letters and digits) when valid for the kind, otherwise null. */
export function normalizeIdentityDocument(kind: IdentityDocumentKind, number: string | null | undefined,
  nationality?: string | null): string | null {
  return checkIdentityDocument(kind, number, nationality).number;
}

/** Example shown next to the error so people know the expected shape. */
export function identityDocumentExample(kind: IdentityDocumentKind, nationality?: string | null): string {
  const nation = country(nationality);
  switch (kind) {
    case "Cedula":
    case "Residence": return "001-1234567-8 (11 dígitos)";
    case "Passport":
      if (nation === "DO") return "RD1234567 (RD y 7 dígitos)";
      if (nation && PASSPORT_PATTERNS[nation]) return PASSPORT_PATTERNS[nation]!.map(describe).join(" o ");
      return "6 a 9 letras y dígitos, p. ej. X1234567";
    case "Rnc": return "1-01-12345-6 (9 dígitos)";
    default: return "";
  }
}
