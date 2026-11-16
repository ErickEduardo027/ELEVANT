import { DOMINICAN_PASSPORT_PREFIX } from '@elevant/api-client';

/** Default document of a new person: a Dominican passport, whose «RD» the form writes itself. */
export const DEFAULT_IDENTIFICATION_TYPE = 'PASAPORTE';

const compact = value => (value ?? '').replace(/[\s.-]/g, '');

/** True when the stored number is a Dominican passport (starts with RD, like IdentityDocuments.Check). */
export function isDominicanPassport(number) {
  return compact(number).toUpperCase().startsWith(DOMINICAN_PASSPORT_PREFIX);
}

/** The part a person types after the fixed «RD»: the stored number without its prefix. */
export function dominicanPassportDigits(number) {
  const value = compact(number);
  return value.toUpperCase().startsWith(DOMINICAN_PASSPORT_PREFIX) ? value.slice(DOMINICAN_PASSPORT_PREFIX.length) : value;
}

/** The number to submit for what was typed after «RD»; a pasted «RD1234567» is not doubled. Empty stays empty. */
export function joinDominicanPassport(typed) {
  const digits = dominicanPassportDigits(typed);
  return digits ? `${DOMINICAN_PASSPORT_PREFIX}${digits}` : '';
}

/** Whether a stored passport must open as foreign (has a number and it is not Dominican). */
export function opensAsForeignPassport(type, number) {
  return type === 'PASAPORTE' && Boolean(compact(number)) && !isDominicanPassport(number);
}
