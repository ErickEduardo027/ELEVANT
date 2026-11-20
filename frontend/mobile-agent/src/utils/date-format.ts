const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Reutiliza instancias de `Intl.DateTimeFormat`. Crearlas es costoso en Hermes y
 * las listas formatean varias fechas por fila en cada render.
 */
export function dateTimeFormat(options: Intl.DateTimeFormatOptions, locale = 'es-DO') {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * AVIAM's calendar (D-S6): a station whose zone the tablet does not know shows its times here, as private-web and the
 * server's `BusinessCalendar` do. Never the device's zone.
 */
export const BUSINESS_TIME_ZONE = 'America/Santo_Domingo';

const knownZones = new Map<string, string>();

/** The station's IANA zone when the runtime knows it; otherwise AVIAM's calendar. */
export function stationTimeZone(timeZone?: string | null): string {
  if (!timeZone) return BUSINESS_TIME_ZONE;
  let zone = knownZones.get(timeZone);
  if (zone === undefined) {
    try {
      dateTimeFormat({ timeZone });
      zone = timeZone;
    } catch {
      zone = BUSINESS_TIME_ZONE;
    }
    knownZones.set(timeZone, zone);
  }
  return zone;
}

type Instant = string | Date | null | undefined;

// N11 (D-N11): one format on the whole tablet, «lun, 16 nov» and «16 nov, 19:46», always on a 24-hour clock.
const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

function instantOf(value: Instant) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A runtime that ignores `hourCycle` may still write midnight as «24:05»: the 24-hour clock reads «00:05». */
function midnightAsZero(text: string) {
  return text.replace(/(^|\D)24:(\d{2})/, (_match, before: string, minutes: string) => `${before}00:${minutes}`);
}

function format(options: Intl.DateTimeFormatOptions, value: Instant, timeZone?: string) {
  const date = instantOf(value);
  if (!date) return '—';
  return midnightAsZero(dateTimeFormat(timeZone ? { ...options, timeZone } : options).format(date));
}

/** The day at the station, «lun, 16 nov». An unknown zone uses AVIAM's calendar; an invalid instant is «—». */
export function formatStationDate(value: Instant, timeZone?: string | null) {
  return format(DATE, value, stationTimeZone(timeZone));
}

/**
 * The time at the station on a 24-hour clock, «19:46». An unknown zone uses AVIAM's calendar; an invalid instant is
 * «—».
 */
export function formatStationTime(value: Instant, timeZone?: string | null) {
  return format(TIME, value, stationTimeZone(timeZone));
}

/**
 * Date and time at the station on a 24-hour clock, «16 nov, 19:46». A station without a known zone (also a record an
 * older version saved without it) uses AVIAM's calendar; an invalid instant is «—».
 */
export function formatStationDateTime(value: Instant, timeZone?: string | null) {
  return format(DATE_TIME, value, stationTimeZone(timeZone));
}

/**
 * Date and time on the device's clock, in the same format and on a 24-hour clock. A time that belongs to a station uses
 * `formatStationDateTime`.
 */
export function formatLocalDateTime(value: Instant) {
  return format(DATE_TIME, value);
}

/**
 * A calendar day such as a shift's workDate («2026-11-16»), «lun, 16 nov» like every other day on the tablet. It is a
 * day, not an instant, so no time zone moves it; an empty or impossible day is «—».
 */
export function formatBusinessDay(value?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return '—';
  const [, year, month, day] = match.map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  if (noon.getUTCFullYear() !== year || noon.getUTCMonth() !== month - 1 || noon.getUTCDate() !== day) return '—';
  return format(DATE, noon, 'UTC');
}

/**
 * How the tablet names the station's clock (S6, D-S6): «hora local de PUJ». Without a code, «hora local de la
 * estación».
 */
export function stationTimeLabel(stationCode?: string | null) {
  const code = stationCode?.trim();
  return code ? `hora local de ${code}` : 'hora local de la estación';
}

/** The same label at the start of a line or as a subtitle: «Hora local de PUJ». */
export function stationTimeTitle(stationCode?: string | null) {
  const label = stationTimeLabel(stationCode);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

// S6 (D-S6): the attendance card edits its times as «2026-11-16 19:46» on the station's clock and saves UTC instants.
const WALL_CLOCK: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};
// en-US writes the numbers in a fixed order, «11/16/2026, 19:46»: a runtime without `formatToParts` is read from it.
const WALL_CLOCK_LOCALE = 'en-US';
const WALL_CLOCK_TEXT = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/;
const WALL_CLOCK_INPUT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The hour on a 24-hour clock, also from a runtime that counts to 24 («24:05») or ignores `hourCycle` («07:46 PM»). */
function hourOf(hour: number, dayPeriod?: string) {
  const period = dayPeriod?.trim().charAt(0).toUpperCase();
  if (period === 'P') return (hour % 12) + 12;
  if (period === 'A') return hour % 12;
  return hour % 24;
}

/** The wall clock of `date` in `timeZone`; `null` if the runtime does not write it as expected. */
function wallClockOf(date: Date, timeZone: string): WallClock | null {
  const formatter = dateTimeFormat({ ...WALL_CLOCK, timeZone }, WALL_CLOCK_LOCALE);
  let clock: WallClock;
  let dayPeriod: string | undefined;
  if (typeof formatter.formatToParts === 'function') {
    const parts = formatter.formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
    clock = {
      year: Number(part('year')),
      month: Number(part('month')),
      day: Number(part('day')),
      hour: Number(part('hour')),
      minute: Number(part('minute')),
    };
    dayPeriod = part('dayPeriod');
  } else {
    // Some Hermes builds have no `formatToParts`.
    const match = WALL_CLOCK_TEXT.exec(formatter.format(date));
    if (!match) return null;
    clock = {
      year: Number(match[3]),
      month: Number(match[1]),
      day: Number(match[2]),
      hour: Number(match[4]),
      minute: Number(match[5]),
    };
    dayPeriod = match[6];
  }
  if (!Object.values(clock).every(Number.isInteger)) return null;
  return { ...clock, hour: hourOf(clock.hour, dayPeriod) };
}

function utcClockOf(instant: number): WallClock {
  const date = new Date(instant);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function sameClock(left: WallClock | null, right: WallClock) {
  return !!left && left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute;
}

/** Minutes the zone's clock is ahead of UTC at `instant` (−240 in Santo Domingo); `null` if it cannot be read. */
function offsetMinutes(instant: number, timeZone: string) {
  const clock = wallClockOf(new Date(instant), timeZone);
  if (!clock) return null;
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  return Math.round((asUtc - Math.floor(instant / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

/**
 * An instant on the station's wall clock as the attendance card edits it, «2026-11-16 19:46», on a 24-hour clock (S6,
 * D-S6). An unknown zone uses AVIAM's calendar, never the device's zone; a missing or invalid instant is ''.
 */
export function stationWallClock(value: Instant, timeZone?: string | null) {
  const date = instantOf(value);
  const clock = date && wallClockOf(date, stationTimeZone(timeZone));
  if (!clock) return '';
  return `${String(clock.year).padStart(4, '0')}-${twoDigits(clock.month)}-${twoDigits(clock.day)} ` +
    `${twoDigits(clock.hour)}:${twoDigits(clock.minute)}`;
}

/**
 * The UTC instant (ISO) of a time typed on the station's wall clock, «2026-11-16 19:46» or with a «T» (S6, D-S6). An
 * unknown zone uses AVIAM's calendar, never the device's zone.
 * - An empty value is `null`: nothing to save.
 * - A value that is not a time is `undefined`, and so is a time the station's clock skips when it moves forward
 *   (02:30 on 8 March in New York): it is never moved to another hour, the agent writes it again.
 * - A time the clock repeats when it moves back (01:30 on 1 November in New York) is its first occurrence.
 * The instant always reads back as the typed time.
 */
export function stationWallClockToInstant(value: string | null | undefined, timeZone?: string | null) {
  const text = value?.trim() ?? '';
  if (!text) return null;
  const match = WALL_CLOCK_INPUT.exec(text);
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const typed: WallClock = { year, month, day, hour, minute };
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Date.UTC rolls 30 February or 24:00 over to another day: those are not times.
  if (!sameClock(utcClockOf(wall), typed)) return undefined;
  const zone = stationTimeZone(timeZone);
  // The zone's offsets a day before and a day after: one on each side of a clock change, or the same one twice.
  const offsets = new Set([offsetMinutes(wall - DAY_MS, zone), offsetMinutes(wall + DAY_MS, zone)]);
  const instants = [...offsets]
    .filter((offset): offset is number => offset !== null)
    .map(offset => wall - offset * MINUTE_MS)
    .filter(instant => sameClock(wallClockOf(new Date(instant), zone), typed))
    .sort((left, right) => left - right);
  return instants.length > 0 ? new Date(instants[0]).toISOString() : undefined;
}
