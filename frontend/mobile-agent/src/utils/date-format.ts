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
