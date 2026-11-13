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
