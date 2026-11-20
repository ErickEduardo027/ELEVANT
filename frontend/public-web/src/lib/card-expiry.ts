import { businessToday } from "@/lib/business-day";

/**
 * S4: the expiry of the card as the cardholder types or pastes it. «1228», «12 28», «12-28», «12/2028» and «1/28» are
 * the same kind of value: the field shows MM/AA (or MM/AAAA) and the payment sends the month and the year as numbers.
 */

/** Spaces, dashes, dots and slashes separate the month from the year. */
const SEPARATORS = /[\s/.-]+/g;

/**
 * The value the field shows after a change, from what it holds now (`value`) and what it held before (`previous`):
 * - only digits and separators stay, and a run of separators becomes one slash;
 * - erasing changes nothing else: backspace over the slash of «12/» leaves «12», and the slash does not come back;
 * - a one-digit month closed by a separator gets its zero: «1/» is «01/» and «1/2028» is «01/2028»;
 * - otherwise the first two digits are the month and get the slash: «12» is «12/», «1228» is «12/28»;
 * - the year keeps four digits at most: anything after MM/AAAA goes.
 */
export function formatCardExpiry(value: string, previous = ""): string {
  const text = value.replace(/[^\d\s/.-]/g, "").replace(SEPARATORS, "/");
  if (value.length < previous.length) return text;
  const clean = text.replace(/^\//, "");
  const slash = clean.indexOf("/");
  const separated = slash === 1 || slash === 2;
  const digits = clean.replace(/\D/g, "");
  const month = separated ? clean.slice(0, slash).padStart(2, "0") : digits.slice(0, 2);
  const year = (separated ? clean.slice(slash + 1).replace(/\D/g, "") : digits.slice(2)).slice(0, 4);
  return month.length === 2 ? `${month}/${year}` : month;
}

export type CardExpiryProblem = "format" | "month" | "year" | "expired";

export type CardExpiry = { ok: true; month: number; year: number } | { ok: false; reason: CardExpiryProblem };

/** M/AA, MM/AA, M/AAAA or MM/AAAA once the separators are a slash; MMAA or MMAAAA without them. */
const SEPARATED = /^(\d{1,2})\/(\d{2}|\d{4})$/;
const DIGITS = /^(\d{2})(\d{2}|\d{4})$/;

/**
 * The month and the year of `value`, or why the API would refuse them. The rule is `CardPaymentPolicy.IsNotExpired`:
 * a month from 1 to 12, a year from 2000 to 2099, and the card is valid through the last day of its month by AVIAM's
 * business day in Santo Domingo (4-N10), so at 20:30 of 30 November a card of 11/26 still pays.
 */
export function parseCardExpiry(value: string, today: string = businessToday()): CardExpiry {
  const text = value.trim().replace(SEPARATORS, "/");
  const match = SEPARATED.exec(text) ?? DIGITS.exec(text);
  if (!match) return { ok: false, reason: "format" };
  const month = Number(match[1]);
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  if (month < 1 || month > 12) return { ok: false, reason: "month" };
  if (year < 2000 || year > 2099) return { ok: false, reason: "year" };
  const [currentYear, currentMonth] = today.split("-").map(Number);
  if (year * 12 + month < currentYear * 12 + currentMonth) return { ok: false, reason: "expired" };
  return { ok: true, month, year };
}

/** The hint under the field while it has no error. */
export const CARD_EXPIRY_HINT = "Mes y año como aparecen en la tarjeta, por ejemplo 08/29.";

/** Why the expiry is not sent, under the field (D-N19: the airline is treated as usted). */
export const CARD_EXPIRY_ERRORS: Readonly<Record<CardExpiryProblem, string>> = Object.freeze({
  format: "Escriba el mes y el año del vencimiento, por ejemplo 08/29.",
  month: "El mes del vencimiento debe estar entre 01 y 12.",
  year: "Revise el año del vencimiento.",
  expired: "La fecha de vencimiento ya pasó. Use una tarjeta vigente.",
});
