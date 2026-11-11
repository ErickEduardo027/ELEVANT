import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { businessToday } from './businessDay';
import { commercialApi } from './commercialGovernanceApi';
import { newRequestId } from './financeBookService';
import { TREASURY_PROBLEM_MESSAGES } from './financeErrors';
import { problemMessage } from './problemMessages';

const query = values => {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  });
  return search.size ? `?${search}` : '';
};
const read = (path, options) => commercialApi(path, { cache: 'no-store', ...options });
const post = (path, body) => commercialApi(path, { method: 'POST', body: JSON.stringify(body) });
const id = value => encodeURIComponent(value);

/** Treasury cash receipts, applications and adjustment notes use the shared authenticated API. */
export const getTreasuryOptions = options => read('/finance/receipts/options', options);
export const listTreasuryReceipts = (filters = {}, options) => read(
  `/finance/receipts${query({ page: 1, limit: 25, ...filters })}`, options);
export const getTreasuryReceipt = (receiptId, options) => read(`/finance/receipts/${id(receiptId)}`, options);
export const recordTreasuryReceipt = body => post('/finance/receipts', body);
export const applyTreasuryReceipt = (receiptId, body) => post(`/finance/receipts/${id(receiptId)}/applications`, body);
export const reverseTreasuryReceipt = (receiptId, body) => post(`/finance/receipts/${id(receiptId)}/reversals`, body);
export const refundTreasuryReceipt = (receiptId, body) => post(`/finance/receipts/${id(receiptId)}/refunds`, body);
export const getTreasuryAdjustments = (invoiceId, options) => read(`/finance/invoices/${id(invoiceId)}/adjustment-notes`, options);
export const issueTreasuryAdjustment = (invoiceId, body) => post(`/finance/invoices/${id(invoiceId)}/adjustment-notes`, body);
export const getTreasuryStatement = (filters, options) => read(`/finance/statements${query(filters)}`, options);

/**
 * 4-N17: saves the PDF of a credit or debit note with a readable name: its e-NCF E34/E33 when it modifies an E31
 * invoice, the ITBIS frozen for each line and «Simulación — sin validez fiscal».
 */
export async function downloadAdjustmentNoteDocument(noteId, fileName) {
  let blob;
  try {
    blob = await createPrivateWebApiClient({ getAccessToken: () => readSession()?.token })
      .getFinanceAdjustmentNoteDocument(noteId, { cache: 'no-store' });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** 4-N17: a note on an E31 invoice has its own simulated e-NCF: E34 credits the invoice, E33 debits it. */
export const isFiscalNoteNumber = number => /^E3[34][0-9]{10}$/.test(String(number ?? ''));

/** «Nota de crédito electrónica E34…» for a note with an e-NCF; the internal TC-/TD- number otherwise. */
export function adjustmentNoteTitle(note) {
  const kind = note?.kind === 'Credit' ? 'crédito' : 'débito';
  return isFiscalNoteNumber(note?.number) ? `Nota de ${kind} electrónica ${note.number}` : `Nota de ${kind} ${note?.number ?? ''}`.trim();
}

/** Rejects invalid decimal text and amounts that would lose precision during JSON conversion. */
export function parseTreasuryAmount(value, { allowZero = false } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(text)) throw new Error('Escriba un importe válido con hasta cuatro decimales.');
  const scaled = decimalUnits(text);
  const amount = Number(text);
  if ((!allowZero && scaled === 0n) || scaled > 9000000000000000n || !Number.isFinite(amount) ||
      decimalUnits(String(amount)) !== scaled) throw new Error('El importe debe ser positivo y conservar hasta cuatro decimales.');
  return amount;
}
function decimalUnits(text) {
  const [whole, fraction = ''] = text.split('.');
  if (!/^\d+$/.test(whole) || !/^\d{0,4}$/.test(fraction)) return -1n;
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
}
export function treasuryIntent(previous, payload) {
  const signature = JSON.stringify(payload);
  return previous?.signature === signature ? previous : { signature, body: { requestId: newRequestId(), ...payload } };
}
/** 4-N10: the day of Finance is the business day of AVIAM in Santo Domingo, the one the server checks. */
export const treasuryToday = (now = new Date()) => businessToday(now);
export function formatTreasuryMoney(value, currency) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
/** The default code of a treasury refusal by its status, for an answer that carries none. */
const TREASURY_DEFAULT_CODES = Object.freeze({ 400: 'invalid_treasury_request', 404: 'not_found', 409: 'treasury_conflict' });

/**
 * Spanish text of a treasury failure (phase 4, block A): the code names the cause (4-N10: a date before the day of the
 * invoice or the receipt); an answer without a code takes the default of its status. Never the server's text.
 */
/** Spanish text of a note PDF that could not be downloaded (4-N17), by its Problem Details code. */
export function noteDocumentError(error) {
  return problemMessage(error, TREASURY_PROBLEM_MESSAGES, {
    forbidden: 'No tiene permiso para descargar las notas de ajuste de esta estación.',
    fallback: 'No se pudo descargar el PDF de la nota. Intente de nuevo.',
  });
}

export function treasuryError(error) {
  const code = typeof error?.code === 'string' ? error.code : TREASURY_DEFAULT_CODES[error?.status];
  return problemMessage(code ? { status: error.status, code } : error, TREASURY_PROBLEM_MESSAGES, {
    fallback: 'No se pudo completar la acción. Revise la conexión e intente de nuevo.',
  });
}
