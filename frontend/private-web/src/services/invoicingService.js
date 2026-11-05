import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

async function call(action) {
  try {
    return await action(client());
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** ADR-0035: one simulated e-CF invoice for approved operations of a single airline. */
export const issueInvoiceFromOperations = request =>
  call(api => api.issueInvoiceFromOperations(request));

/** ADR-0036: card attempts of an invoice (brand and last four digits only). */
export const getInvoiceCardPayments = invoiceId =>
  call(api => api.getFinanceInvoiceCardPayments(invoiceId, { cache: 'no-store' }));

export const getInvoiceDocument = invoiceId =>
  call(api => api.getFinanceInvoiceDocumentById(invoiceId, { cache: 'no-store' }));

/** Saves the invoice PDF with a readable file name. */
export async function downloadInvoiceDocument(invoiceId, fileName) {
  const blob = await getInvoiceDocument(invoiceId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Spanish text for the reason a request could not be invoiced. */
export function invoicingError(error) {
  const reason = (error?.reasons ?? [])[0];
  if (reason === 'mixed_airline') return 'Una factura solo puede incluir operaciones de la misma aerolínea.';
  if (reason === 'already_invoiced') return 'Alguna operación ya fue facturada. Actualizamos la lista.';
  if (reason === 'operation_not_approved') return 'Alguna operación aún no está aprobada por OCC.';
  if (reason === 'nothing_to_invoice') return 'Alguna operación no tiene servicios completados para facturar.';
  if (error?.status === 403) return 'No tiene permiso para emitir facturas en esta estación.';
  if (error?.status === 409) return 'La selección cambió mientras se emitía. Actualizamos la lista.';
  if (error?.status === 422) return 'Estas operaciones no pueden facturarse juntas.';
  return 'No se pudo confirmar la emisión. Puede reintentar: la misma selección conserva su clave y no duplica la factura.';
}
