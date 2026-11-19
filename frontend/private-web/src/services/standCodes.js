/** Spaces (any white space), dots and hyphens are never part of a stand code. */
const SEPARATORS = /[\s.-]/gu;
/** Letters, the number without its zero padding, and letters again. */
const PADDED = /^([A-Z]*)0*([0-9]+)([A-Z]*)$/;

/**
 * One rule to compare stand codes, shared with the API (ADR-0041; `StandCodes.Normalize` in
 * `backend/Elevant.Application/Operations`, whose `StandCodes.vectors.json` both test suites read). The database pads
 * the number («A01») and the airport's plan does not («A1»): «A01», «a-1» and «A 1» are the stand «A1». Nothing else
 * is inferred: «1», «9A» and «23A» stay as they are, and a code that is not letters, a number and letters is only
 * cleaned.
 *
 * @param {unknown} code
 * @returns {string}
 */
export function normalizeStandCode(code) {
  const text = String(code ?? '').replace(SEPARATORS, '').toUpperCase();
  const match = PADDED.exec(text);
  return match ? `${match[1]}${match[2]}${match[3]}` : text;
}

/** A code as «Datos maestros» stores it whose number carries zero padding: capitals, the number and capitals. */
const STORED_PADDED = /^([A-Z]*)0+([0-9]+)([A-Z]*)$/;

/**
 * A stand code as AVIAM Web shows it (N27): one code per stand on every screen, the one the map draws. The seed created
 * «A01» and the airport's plan says «A1», so a code of capitals, a number and capitals loses the zero padding of its
 * number: «A01» is shown «A1», «BN06» «BN6» and «09A» «9A». Any other code is shown as it is: «E2E-XXXX-1» keeps its
 * hyphens (normalizeStandCode would show «E2EXXXX1»), and «A10», «A0» or «a-1» stay as they are. It only changes what a
 * screen shows: commands send the stand's id, comparisons use normalizeStandCode and «Datos maestros» shows the code as
 * it is stored. The data does not change (D-N27).
 *
 * @param {unknown} code
 * @returns {string}
 */
export function standDisplayCode(code) {
  const text = String(code ?? '');
  const match = STORED_PADDED.exec(text);
  return match ? `${match[1]}${match[2]}${match[3]}` : text;
}

/** Numbers compared as numbers and letters without case: «A2» before «A10», «A10» before «AN1». */
const NATURAL = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/**
 * Stand codes in natural order, compared by their normalized code: «A01» and «A1» are one stand, then A2, A3… A10,
 * A11, AN1…, B20…, BN6… BN13. A code that only differs in what the collator ignores falls back to its plain order, so
 * the order is total and the same on every screen.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number}
 */
export function compareStandCodes(left, right) {
  const a = normalizeStandCode(left);
  const b = normalizeStandCode(right);
  if (a === b) return 0;
  return NATURAL.compare(a, b) || (a < b ? -1 : 1);
}

/**
 * A copy of `items` in the natural order of their stand codes (compareStandCodes); `codeOf` reads each item's code
 * (its `code` by default). Items of the same stand keep their order.
 *
 * @template T
 * @param {readonly T[] | null | undefined} items
 * @param {(item: T) => unknown} [codeOf]
 * @returns {T[]}
 */
export function sortByStandCode(items, codeOf = item => item?.code) {
  return [...(items ?? [])].sort((left, right) => compareStandCodes(codeOf(left), codeOf(right)));
}
