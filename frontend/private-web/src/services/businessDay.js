/**
 * AVIAM's business day (2-F), the one the server applies to contracts, permits, terminations and the
 * sweeps: the calendar day in America/Santo_Domingo (UTC−4 all year), or in the station's IANA zone when a
 * rule has one. From 20:00 to 23:59 in the Dominican Republic the UTC day is already tomorrow, so
 * `new Date().toISOString().slice(0, 10)` is never «today». The server stays the authority; screens use
 * this for defaults, `min`/`max` limits and labels.
 */
export const BUSINESS_TIME_ZONE = 'America/Santo_Domingo';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayIn(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * ISO date (`yyyy-mm-dd`) of `now` in AVIAM's calendar or in `timeZone`. An unknown zone falls back to
 * AVIAM's calendar, like the server does.
 *
 * @param {Date} [now]
 * @param {string | null} [timeZone]
 */
export function businessToday(now = new Date(), timeZone = null) {
  if (timeZone) {
    try { return dayIn(now, timeZone); } catch { /* unknown zone: AVIAM's calendar */ }
  }
  return dayIn(now, BUSINESS_TIME_ZONE);
}

/**
 * The ISO date `days` calendar days after `isoDate` (before it when negative).
 *
 * @param {string} isoDate
 * @param {number} days
 */
export function addDays(isoDate, days) {
  if (!DATE.test(isoDate) || !Number.isInteger(days)) throw new TypeError('addDays needs an ISO date and whole days.');
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
