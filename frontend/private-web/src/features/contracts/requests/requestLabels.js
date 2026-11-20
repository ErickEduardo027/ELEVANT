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

// A public request's reference is its id as 32 hex digits (with dashes, the same id); a new contract keeps «DRAFT-» and
// that id as its code until Contratos confirms its validity and it gets its final code («CTR-2026-0007»).
const GUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DRAFT_CODE = /^DRAFT-(.+)$/;
const trimmed = value => (typeof value === 'string' ? value.trim() : '');
const shortGuid = value => (GUID.test(value) ? `${value.slice(0, 8)}…` : value);

/**
 * The request's reference as the API sends it (N35). A list shortens a GUID to its first 8 characters and keeps it
 * whole in `title`; a reference such as «REQ-2026-000001» is never cut, and nothing is rewritten.
 * @returns {{ text: string, title: string | undefined }}
 */
export function requestReferenceLabel(reference, { list = false } = {}) {
  const value = trimmed(reference);
  if (!value) return { text: '—', title: undefined };
  const text = list ? shortGuid(value) : value;
  return { text, title: text === value ? undefined : value };
}

/**
 * The contract's code as people read it (N35): a new contract's «DRAFT-1cc18541…» is «Borrador 1cc18541…», with the
 * whole code in `title` and the id it shows in `draftId`; a final code stays as it is, with a null `draftId`.
 * @returns {{ text: string, title: string | undefined, draftId: string | null }}
 */
export function contractCodeLabel(code) {
  const value = trimmed(code);
  const draft = DRAFT_CODE.exec(value);
  if (!draft) return { text: value || '—', title: undefined, draftId: null };
  const draftId = shortGuid(draft[1]);
  return { text: `Borrador ${draftId}`, title: value, draftId };
}

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
