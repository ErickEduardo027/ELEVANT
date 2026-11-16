/**
 * Spanish labels of the Finance codes the screens receive (phase 1, 1-N26): the package scope and the
 * status of packages, contract versions under Finance review and tariff versions. A code the screen
 * does not know is never shown raw.
 */

export const PACKAGE_SCOPE_LABELS = Object.freeze({ Turnaround: 'Por escala', Flight: 'Por vuelo', Period: 'Por período' });
export const FLIGHT_DIRECTION_LABELS = Object.freeze({ Arrival: 'Llegada', Departure: 'Salida' });

export const PACKAGE_STATUS = Object.freeze({
  Draft: { label: 'Borrador', tone: 'warning' },
  Published: { label: 'Publicada', tone: 'success' },
  Superseded: { label: 'Reemplazada', tone: 'neutral' },
  Discarded: { label: 'Descartada', tone: 'neutral' },
  Retired: { label: 'Retirada', tone: 'danger' },
});

export const CONTRACT_APPROVAL_STATUS = Object.freeze({
  PendingFinanceApproval: { label: 'Pendiente de Finanzas', tone: 'warning' },
  Approved: { label: 'Precios aprobados', tone: 'success' },
  Draft: { label: 'Devuelto a Contratos', tone: 'danger' },
  Rejected: { label: 'Descartado por Contratos', tone: 'neutral' },
  Superseded: { label: 'Reemplazado por una versión posterior', tone: 'neutral' },
});

export const TARIFF_VERSION_STATUS = Object.freeze({
  Draft: { label: 'Borrador', tone: 'warning' },
  Published: { label: 'Vigente', tone: 'success' },
  Superseded: { label: 'Histórica', tone: 'neutral' },
});

const UNKNOWN_STATUS = Object.freeze({ label: 'Estado no reconocido', tone: 'info' });

/** Label and tone of a status code in one of the maps above. */
export const statusMeta = (statuses, status) =>
  (Object.prototype.hasOwnProperty.call(statuses, status) ? statuses[status] : UNKNOWN_STATUS);

export const packageScopeLabel = scope =>
  (Object.prototype.hasOwnProperty.call(PACKAGE_SCOPE_LABELS, scope) ? PACKAGE_SCOPE_LABELS[scope] : 'Alcance no reconocido');

/**
 * How Finance and the airline name an invoice (4-N19): its simulated e-NCF (ADR-0035), or the start of the internal
 * number of a non-fiscal invoice issued before it. «Facturas», the statement and «Aplicar cobro» use the same label.
 */
export function invoiceLabel(invoice) {
  if (invoice?.fiscalNumber) return invoice.fiscalNumber;
  const number = invoice?.number ?? '';
  return number.length > 15 ? `${number.slice(0, 15)}…` : number;
}
