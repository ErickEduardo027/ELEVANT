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

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** Fecha y hora local corta para mensajes, avisos e incidencias. */
export function formatLocalDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat(DATE_TIME).format(date);
}

/**
 * Fecha y hora corta en la hora local de la estación. Sin zona conocida (un registro guardado por una versión anterior)
 * se usa la del equipo.
 */
export function formatStationDateTime(value: string | null | undefined, timeZone?: string) {
  if (!timeZone) return formatLocalDateTime(value);
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return dateTimeFormat({ ...DATE_TIME, timeZone }).format(date);
  } catch {
    return dateTimeFormat(DATE_TIME).format(date);
  }
}
