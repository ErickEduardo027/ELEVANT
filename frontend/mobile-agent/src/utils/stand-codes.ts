/** Spaces (any white space), dots and hyphens are never part of a stand code. */
const SEPARATORS = /[\s.-]/gu;
/** Letters, the number without its zero padding, and letters again. */
const PADDED = /^([A-Z]*)0*([0-9]+)([A-Z]*)$/;

/**
 * One rule to compare stand codes, shared with the API and AVIAM Web (ADR-0041; `StandCodes.Normalize` in
 * `backend/Elevant.Application/Operations`, whose `StandCodes.vectors.json` the tablet's tests read too). «A01», «a-1»
 * and «A 1» are the stand «A1»; «1», «9A» and «23A» stay as they are.
 */
export function normalizeStandCode(code: unknown): string {
  const text = String(code ?? '').replace(SEPARATORS, '').toUpperCase();
  const match = PADDED.exec(text);
  return match ? `${match[1]}${match[2]}${match[3]}` : text;
}

/** A code as «Datos maestros» stores it whose number carries zero padding: capitals, the number and capitals. */
const STORED_PADDED = /^([A-Z]*)0+([0-9]+)([A-Z]*)$/;

/**
 * A stand code as the tablet shows it (CN-21, N27 of AVIAM Web): one code per stand on every screen, the one OCC's map
 * draws. The seed created «A01» and the airport's plan says «A1», so a code of capitals, a number and capitals loses
 * the zero padding of its number: «A01» is shown «A1», «BN06» «BN6» and «09A» «9A». Any other code is shown as it is.
 * It only changes what a screen shows: commands send the stand's id and the data does not change.
 */
export function standDisplayCode(code: unknown): string {
  const text = String(code ?? '');
  const match = STORED_PADDED.exec(text);
  return match ? `${match[1]}${match[2]}${match[3]}` : text;
}
