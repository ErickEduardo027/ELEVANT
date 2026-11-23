/**
 * Shapes of what a person types, applied while typing. They only format: the rule that decides whether the value is
 * valid stays the server's mirror in @elevant/api-client (checkIdentityDocument, normalizePhone).
 */

/** Longest cédula or residence card as the mask writes it: ###-#######-# (11 digits). */
export const CEDULA_MASK_LENGTH = 13;

/**
 * A cédula or residence card as ###-#######-# (ported from the public site's access wizard). Only digits are kept,
 * up to 11; a dash appears only once a digit follows it, so erasing never gets stuck on one.
 */
export function formatCedula(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 11);
  return [digits.slice(0, 3), digits.slice(3, 10), digits.slice(10)].filter(Boolean).join('-');
}

/** The 11 digits the server stores for a masked cédula or residence card (it also drops the dashes itself). */
export const compactCedula = value => String(value ?? '').replace(/\D/g, '');

const groupDominican = digits => [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean).join('-');

/**
 * A phone while typing. A Dominican number becomes 809-555-0100 (an optional leading 1 stays as «1-»); one that starts
 * with + or 00 is international and keeps its prefix, digits, spaces and dashes as typed. Never longer than the
 * server's 32.
 */
export function formatPhone(value) {
  const raw = String(value ?? '').trimStart();
  if (raw.startsWith('+') || raw.startsWith('00')) {
    const prefix = raw.startsWith('+') ? '+' : '00';
    const rest = raw.slice(prefix.length).replace(/[^\d -]/g, '').replace(/ {2,}/g, ' ');
    return `${prefix}${rest}`.slice(0, 32);
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length > 1) return `1-${groupDominican(digits.slice(1, 11))}`;
  return groupDominican(digits.slice(0, 10));
}
