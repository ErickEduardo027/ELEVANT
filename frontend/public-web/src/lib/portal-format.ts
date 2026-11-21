import { BUSINESS_TIME_ZONE } from "./business-day";

/**
 * The one way the airline portal writes money and dates: the currency code before the amount with the Dominican
 * thousands separator and 2 decimals («USD 1,234.50»), and dates as dd/mm/aaaa. A calendar date of the API
 * («2026-12-05») keeps its day; an instant is shown in the station's zone, or in AVIAM's calendar without one.
 */
const NUMBER = new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «1,234.50»: an amount for a table cell whose column names the currency. */
export function formatAmount(value: number): string {
  return NUMBER.format(value);
}

/** «USD 1,234.50». */
export function formatMoney(currency: string, value: number): string {
  return `${currency} ${formatAmount(value)}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function zone(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("es-DO", { timeZone });
      return timeZone;
    } catch { /* unknown zone: AVIAM's calendar */ }
  }
  return BUSINESS_TIME_ZONE;
}

function parts(instant: number, timeZone: string | null | undefined) {
  const values = new Intl.DateTimeFormat("en-GB", { timeZone: zone(timeZone), year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find(item => item.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year"), hour: part("hour"), minute: part("minute") };
}

/** «05/12/2026», or «—» without a valid date. */
export function formatDate(value: string | null | undefined, timeZone: string | null = null): string {
  if (!value) return "—";
  const date = ISO_DATE.exec(value);
  if (date) return `${date[3]}/${date[2]}/${date[1]}`;
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return "—";
  const { day, month, year } = parts(instant, timeZone);
  return `${day}/${month}/${year}`;
}

/** «20/11/2026 21:30» at the station's local time, or «—». */
export function formatDateTime(value: string | null | undefined, timeZone: string | null = null): string {
  if (!value) return "—";
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return "—";
  const { day, month, year, hour, minute } = parts(instant, timeZone);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}
