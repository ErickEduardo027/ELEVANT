function formatTime(date, timeZone, locale = 'es-DO') {
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatClockTime(isoString, locale) {
  return formatTime(new Date(isoString), undefined, locale);
}

// Used by the Topbar's dual clock: the station clock reads the viewing
// machine's local time (this tool is operated on-site at the station).
export function formatUtcClockTime(isoString) {
  return formatTime(new Date(isoString), 'UTC');
}
