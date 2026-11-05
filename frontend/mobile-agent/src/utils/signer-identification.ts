/**
 * ID or passport of whoever signs the charter Service Request (ADR-0033), as the API expects it:
 * without spaces, in capitals, 4 to 40 letters, digits or hyphens.
 */
export function normalizeSignerIdentification(value: string) {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isValidSignerIdentification(value: string) {
  return /^[A-Z0-9-]{4,40}$/.test(normalizeSignerIdentification(value));
}
