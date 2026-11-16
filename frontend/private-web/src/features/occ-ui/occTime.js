// The clock of the OCC primitives: «14:32» in the station's time zone and the words of a countdown («en 12 min»,
// «hace 3 min», «ahora»). Pure: the instant `now` always comes from the caller, the server's clock, so nothing here
// reads the device's clock and every screen counts from the same instant.

/** What a clock shows without a valid instant. */
export const OCC_EMPTY_CLOCK = '--:--';

const MINUTE_MS = 60_000;
const clockFormats = new Map();

/** Milliseconds since the epoch of an ISO instant, a number of milliseconds or a Date; NaN for anything else. */
export function toInstantMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim() !== '') return Date.parse(value);
  return Number.NaN;
}

// One formatter per locale and zone: building an Intl.DateTimeFormat is the slow part of a clock.
function clockFormat(locale, timeZone) {
  const key = `${locale ?? ''}|${timeZone ?? ''}`;
  let format = clockFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
    clockFormats.set(key, format);
  }
  return format;
}

/** «14:32» for an instant in `timeZone`, written for `locale`, on 24 hours and without seconds; «--:--» without one. */
export function formatClock(value, locale, timeZone) {
  const ms = toInstantMs(value);
  return Number.isFinite(ms) ? clockFormat(locale, timeZone).format(ms) : OCC_EMPTY_CLOCK;
}

/** The minutes from `now` to `at`, rounded to the nearest minute: positive ahead, negative behind, NaN without both. */
export function minutesBetween(at, now) {
  const delta = toInstantMs(at) - toInstantMs(now);
  if (!Number.isFinite(delta)) return Number.NaN;
  const minutes = Math.round(Math.abs(delta) / MINUTE_MS);
  if (minutes === 0) return 0;
  return delta < 0 ? -minutes : minutes;
}

/**
 * How far `at` is from `now`, as the words of a countdown need it: `{ tense, hours, minutes }`, with `tense` `now`
 * (less than a minute either way), `future` or `past`, and the distance rounded to the minute and split into hours and
 * minutes. `null` without two valid instants.
 */
export function relativeTimeParts(at, now) {
  const delta = toInstantMs(at) - toInstantMs(now);
  if (!Number.isFinite(delta)) return null;
  if (Math.abs(delta) < MINUTE_MS) return { tense: 'now', hours: 0, minutes: 0 };
  const total = Math.round(Math.abs(delta) / MINUTE_MS);
  return { tense: delta > 0 ? 'future' : 'past', hours: Math.floor(total / 60), minutes: total % 60 };
}

/** «12 min», «2 h» or «1 h 25 min»; `t` translates occUiMessages. */
export function durationText({ hours, minutes }, t) {
  if (hours === 0) return t('time.minutes', { count: minutes });
  if (minutes === 0) return t('time.hours', { hours });
  return t('time.hoursMinutes', { hours, minutes });
}

/** «en 12 min», «hace 1 h 5 min» or «ahora»; an empty text without two valid instants. `t` translates occUiMessages. */
export function relativeTimeText(at, now, t) {
  const parts = relativeTimeParts(at, now);
  if (parts === null) return '';
  if (parts.tense === 'now') return t('time.now');
  return t(parts.tense === 'future' ? 'time.in' : 'time.ago', { duration: durationText(parts, t) });
}
