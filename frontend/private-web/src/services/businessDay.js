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

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The zone itself when the runtime knows it, otherwise AVIAM's calendar (like the server). */
function knownZone(timeZone) {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone });
      return timeZone;
    } catch { /* unknown zone: AVIAM's calendar */ }
  }
  return BUSINESS_TIME_ZONE;
}

/** The wall clock of `instant` in `timeZone`, as the parts of a date. */
function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = type => parts.find(item => item.type === type)?.value ?? '00';
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'),
    second: part('second') };
}

/** Minutes the zone's wall clock is ahead of UTC at `instant` (−240 in Santo Domingo). */
function offsetMinutes(instant, timeZone) {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(Number(clock.year), Number(clock.month) - 1, Number(clock.day), Number(clock.hour),
    Number(clock.minute), Number(clock.second));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/**
 * The UTC instant (ISO, `…Z`) of a `datetime-local` value OCC typed in the station's local time (3-N19); the API
 * always receives and stores UTC. `null` for an empty or malformed value. A time a daylight-saving jump skips moves
 * forward, an ambiguous one takes its first occurrence.
 *
 * @param {string} localValue `yyyy-mm-ddThh:mm` (seconds optional)
 * @param {string | null} [timeZone] the station's IANA zone; AVIAM's calendar when unknown
 */
export function stationLocalToUtc(localValue, timeZone = null) {
  const match = LOCAL_INPUT.exec(typeof localValue === 'string' ? localValue : '');
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (Number.isNaN(wall)) return null;
  const zone = knownZone(timeZone);
  let instant = wall - offsetMinutes(wall, zone) * 60_000;
  // Near a daylight-saving change the offset at the guess may differ: one refinement settles it.
  const refined = wall - offsetMinutes(instant, zone) * 60_000;
  if (refined !== instant && offsetMinutes(refined, zone) === offsetMinutes(instant, zone)) instant = refined;
  return new Date(instant).toISOString();
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const DATE_STYLES = {
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  long: { dateStyle: 'long' },
};
const dateFormatters = new Map();

function dateFormatter(locale, style, timeZone) {
  const key = `${locale}|${style}|${timeZone}`;
  let format = dateFormatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...DATE_STYLES[style], timeZone });
    dateFormatters.set(key, format);
  }
  return format;
}

/**
 * A date as AVIAM's internal screens write it (N36): «01/09/2026» in lists, tables and records, and the long
 * «1 de septiembre de 2026» only inside a sentence (`style: 'long'`). A calendar date (`yyyy-mm-dd`, as the API
 * sends contract, permit and document dates) is read in UTC, so its day never moves with the browser's zone; an
 * instant (ISO with `Z` or an offset, or a Date) shows its day in the station's zone, or in AVIAM's calendar like
 * `businessToday`, never the UTC day. Anything else, an impossible day included, is «—».
 *
 * @param {string | Date | null | undefined} value
 * @param {{ style?: 'short' | 'long', locale?: string, timeZone?: string | null }} [options]
 */
export function formatBusinessDate(value, { style = 'short', locale = 'es-DO', timeZone = null } = {}) {
  const shape = style === 'long' ? 'long' : 'short';
  if (typeof value === 'string' && DATE.test(value)) {
    const day = Date.parse(`${value}T00:00:00Z`);
    // The engine rolls an impossible day over (2026-02-30 would be 2 March): only a real calendar day is a date.
    if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== value) return '—';
    return dateFormatter(locale, shape, 'UTC').format(new Date(day));
  }
  const instant = value instanceof Date ? value.getTime()
    : typeof value === 'string' && INSTANT.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(instant)) return '—';
  return dateFormatter(locale, shape, knownZone(timeZone)).format(new Date(instant));
}

/**
 * A UTC instant as a date and a 24-hour time in the station's local time (phase 3, block E): «26/10/2026, 08:00».
 * Reports and their «Generado» use it instead of the browser's zone; an unknown zone falls back to AVIAM's calendar,
 * like the server, and an invalid instant is «—».
 *
 * @param {string | Date | null | undefined} value an ISO instant (UTC) or a Date
 * @param {{ timeZone?: string | null, locale?: string }} [options] the station's IANA zone and the screen's locale
 */
export function formatBusinessDateTime(value, { timeZone = null, locale = 'es-DO' } = {}) {
  const instant = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(instant)) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone: knownZone(timeZone), day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(instant));
}

/**
 * The `datetime-local` value (`yyyy-mm-ddThh:mm`) of a UTC instant in the station's local time (3-N19), to prefill a
 * form; an empty string for an invalid instant.
 *
 * @param {string | Date} iso
 * @param {string | null} [timeZone]
 */
export function utcToStationLocalInput(iso, timeZone = null) {
  const instant = iso instanceof Date ? iso.getTime() : typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(instant)) return '';
  const clock = wallClock(instant, knownZone(timeZone));
  return `${clock.year}-${clock.month}-${clock.day}T${clock.hour}:${clock.minute}`;
}
