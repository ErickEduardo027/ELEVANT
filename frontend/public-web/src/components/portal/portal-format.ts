const DATE_TIME_FORMAT = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const TIME_FORMAT = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatPortalDateTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : DATE_TIME_FORMAT.format(date);
}

export function formatPortalTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : TIME_FORMAT.format(date);
}

export function splitRoute(route: string): [string, string] {
  const [origin, destination] = route
    .split(/\s*(?:→|–|—|-)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [origin || route || "—", destination || "—"];
}

export function statusTone(status: string | undefined) {
  const normalized = (status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/cancel|critical|rechaz|vencid|incident/.test(normalized)) return "critical";
  if (/complet|confirm|a tiempo|cerrad|normal|disponible/.test(normalized)) {
    return "positive";
  }
  if (/demor|pendiente|revision|proceso|abord|aproxim/.test(normalized)) {
    return "attention";
  }
  if (/activo|rampa|arrib|salida|en vuelo/.test(normalized)) return "active";
  return "neutral";
}
