// The console's dates: the station's operational date as the old dashboard wrote it («vie, 13 nov»), never moved by the
// device's time zone. Times of day use occ-ui/occTime.js (formatClock). Pure.

const dateFormats = new Map();

function dateFormat(locale) {
  const key = locale ?? '';
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * «vie, 13 nov» for an operational date `YYYY-MM-DD` written for `locale`; the date as it came when it is not one. The
 * date is read at noon UTC, so no time zone of the device moves it to another day.
 */
export function formatConsoleDate(isoDate, locale) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
  if (!match) return isoDate ?? '';
  const [, year, month, day] = match.map(Number);
  const noon = Date.UTC(year, month - 1, day, 12);
  return Number.isFinite(noon) ? dateFormat(locale).format(noon) : String(isoDate);
}
