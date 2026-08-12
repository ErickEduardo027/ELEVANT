function formatTime(date, timeZone) {
  return date.toLocaleTimeString('es-DO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatClockTime(isoString) {
  return formatTime(new Date(isoString));
}

// Used by the Topbar's dual clock: the station clock reads the viewing
// machine's local time (this tool is operated on-site at the station).
export function formatUtcClockTime(isoString) {
  return formatTime(new Date(isoString), 'UTC');
}
