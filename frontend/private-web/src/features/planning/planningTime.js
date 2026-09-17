export function formatPlanningClock(value, timeZone) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '—';
  try {
    return new Intl.DateTimeFormat('es-DO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

export function formatPlanningDate(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
