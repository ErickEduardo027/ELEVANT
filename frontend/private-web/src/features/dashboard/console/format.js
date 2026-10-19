// Formatos de hora/fecha del panorama. Si la estación trae zona IANA se usa
// esa; las horas UTC de la API se muestran en hora local de PUJ.
export function formatTime(iso, locale, timeZone) {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}),
  });
}

export function formatOperationalDate(isoDate, locale) {
  const [year, month, day] = String(isoDate ?? '').split('-').map(Number);
  if (!year || !month || !day) return isoDate ?? '';
  // Mediodía UTC: la fecha operacional no debe desplazarse por la zona del equipo.
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
