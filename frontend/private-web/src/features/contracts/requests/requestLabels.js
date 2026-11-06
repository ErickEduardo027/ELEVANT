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
