/**
 * AVIAM's business day (2-F), the one the server applies to contracts, permits and their expiry: the
 * calendar day in America/Santo_Domingo (UTC−4 all year), or in a station's IANA zone when a rule has
 * one. From 20:00 to 23:59 in the Dominican Republic the UTC day is already tomorrow, so
 * `new Date().toISOString().slice(0, 10)` is never «today». The server stays the authority; the portal
 * uses this for defaults and `min`/`max` limits.
 */
export const BUSINESS_TIME_ZONE = "America/Santo_Domingo";

function dayIn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** ISO date (`yyyy-mm-dd`) of `now` in AVIAM's calendar or in `timeZone`; an unknown zone falls back. */
export function businessToday(now: Date = new Date(), timeZone: string | null = null): string {
  if (timeZone) {
    try { return dayIn(now, timeZone); } catch { /* unknown zone: AVIAM's calendar */ }
  }
  return dayIn(now, BUSINESS_TIME_ZONE);
}

/** The zone itself when the runtime knows it, otherwise AVIAM's calendar (like the server). */
function knownZone(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("es-DO", { timeZone });
      return timeZone;
    } catch { /* unknown zone: AVIAM's calendar */ }
  }
  return BUSINESS_TIME_ZONE;
}

/**
 * A UTC instant at the station's local time with a 24-hour clock (3-N20), «25 sept 2026, 11:50»: the time the
 * Service Order PDF and OCC show. An unknown or missing zone falls back to AVIAM's calendar; an invalid instant is «—».
 */
export function formatLocalDateTime(value: string, timeZone: string | null = null): string {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: knownZone(timeZone), year: "numeric", month: "short", day: "numeric", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23",
  }).format(new Date(instant));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The ISO date `days` calendar days after `isoDate` (before it when negative), as private-web computes it. */
export function addDays(isoDate: string, days: number): string {
  if (!ISO_DATE.test(isoDate) || !Number.isInteger(days)) throw new TypeError("addDays needs an ISO date and whole days.");
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
