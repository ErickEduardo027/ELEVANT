/** Spanish labels of the commercial request review; the API sends codes, never these texts. */
export const REQUEST_STATUS_LABELS = Object.freeze({
  Pending: 'Pendiente', InReview: 'En revisión', Approved: 'Aprobada', Rejected: 'Rechazada', Cancelled: 'Cancelada',
});

export const DOCUMENT_TYPE_LABELS = Object.freeze({ NationalId: 'Cédula', Passport: 'Pasaporte' });

const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['es'], { type: 'region' }) : null;

/** «República Dominicana» for «DO»; the code itself when the browser has no name for it. */
export function countryName(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return code || null;
  try {
    return regions?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export const documentLabel = type => DOCUMENT_TYPE_LABELS[type] ?? 'Otro documento';

export const requestStatusLabel = status => REQUEST_STATUS_LABELS[status] ?? 'Estado desconocido';

/** Verdicts that block the approval unless Superadministración verified the airline by hand (ADR-0023). */
export const BLOCKING_REGISTRY_STATUSES = Object.freeze(['NotFound', 'Defunct', 'Mismatch']);

const REGISTRY_SOURCES = Object.freeze({ OpenFlights: 'OpenFlights', Wikidata: 'Wikidata' });

/**
 * The public-registry verdict in plain Spanish: «Encontrada en OpenFlights», «No encontrada en registros
 * públicos», «Inactiva», «No coincide: …» or «No se pudo comprobar».
 */
export function registryVerdictLabel(check) {
  if (!check) return null;
  const source = check.source ? REGISTRY_SOURCES[check.source] ?? check.source : null;
  switch (check.status) {
    case 'Found': return source ? `Encontrada en ${source}` : 'Encontrada en registros públicos';
    case 'NotFound': return 'No encontrada en registros públicos';
    case 'Defunct': return source ? `Inactiva según ${source}` : 'Inactiva';
    case 'Mismatch': return `No coincide: ${check.detail || 'el registro muestra otra aerolínea con esos códigos.'}`;
    case 'Unavailable': return 'No se pudo comprobar';
    default: return 'Comprobación desconocida';
  }
}
