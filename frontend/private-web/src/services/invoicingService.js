import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { INVOICING_PROBLEM_MESSAGES } from './financeErrors';
import { problemMessage } from './problemMessages';

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

/** ADR-0035: one simulated e-CF invoice for approved operations of a single airline, with the versions on screen. */
export const issueInvoiceFromOperations = request =>
  call(api => api.issueInvoiceFromOperations(request));

/**
 * «Por facturar» (4-N16): the pending operations of the station from the oldest, a page at a time, with the limits of
 * one invoice and what blocks each operation.
 */
export const getFinancePendingOperations = (query, options) =>
  call(api => api.getFinancePendingOperations(query, { cache: 'no-store', ...options }));

/** 4-N07: closes operations valued at zero without an invoice, with their versions, a reason and the intent key. */
export const closeOperationsWithoutCharge = (command, idempotencyKey) =>
  call(api => api.closeOperationsWithoutCharge(command, idempotencyKey));

/** ADR-0036: card attempts of an invoice (brand and last four digits only). */
export const getInvoiceCardPayments = invoiceId =>
  call(api => api.getFinanceInvoiceCardPayments(invoiceId, { cache: 'no-store' }));

/** 1-N08: the «Factura emitida» emails the invoice queued and their delivery state (none when nobody could receive it). */
export const getInvoiceEmailDeliveries = invoiceId =>
  call(api => api.getInvoiceEmailDeliveries(invoiceId, { cache: 'no-store' }));

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

/** The code of a failure, or the first reason an older server sent instead. */
const coded = error => (typeof error?.code === 'string' || typeof error?.reasons?.[0] !== 'string'
  ? error : { status: error.status, code: error.reasons[0] });

/** Spanish text for why a selection could not be invoiced or closed; the server title is never shown. */
export function invoicingError(error) {
  return problemMessage(coded(error), INVOICING_PROBLEM_MESSAGES, {
    forbidden: 'No tiene permiso para emitir facturas en esta estación.',
    fallback: 'No se pudo confirmar la emisión. Puede reintentar: la misma selección conserva su clave y no duplica la factura.',
  });
}

/** Spanish text for why a no-charge closure was refused (4-N07). */
export function closureError(error) {
  return problemMessage(coded(error), INVOICING_PROBLEM_MESSAGES, {
    forbidden: 'No tiene permiso para cerrar operaciones sin cargo en esta estación.',
    fallback: 'No se pudo confirmar el cierre. Puede reintentar: el mismo motivo conserva su clave y no repite el cierre.',
  });
}

/** Spanish text for a code that blocks an operation of «Por facturar» (4-N18). */
export const blockingReasonMessage = code =>
  (Object.hasOwn(INVOICING_PROBLEM_MESSAGES, code) ? INVOICING_PROBLEM_MESSAGES[code] : 'Requiere revisión antes de facturar.');
