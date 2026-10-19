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

export function formatPlanningDate(value, locale = 'es-DO') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}
