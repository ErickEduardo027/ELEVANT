import { formatBusinessDate } from '../../services/businessDay';

export function formatPlanningClock(value, timeZone, locale = 'es-DO') {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

/** The operation date as every internal list writes a date (N36): «19/08/2026», or «08/19/2026» in English. */
export function formatPlanningDate(value, locale = 'es-DO') {
  return formatBusinessDate(value, { locale });
}
