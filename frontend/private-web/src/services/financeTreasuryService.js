import { commercialApi } from './commercialGovernanceApi';
import { newRequestId } from './financeBookService';

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
export const treasuryToday = () => new Date().toISOString().slice(0, 10);
export function formatTreasuryMoney(value, currency) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
export function treasuryError(error) {
  if (error?.status === 401) return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (error?.status === 403) return 'No tiene permiso para esta acción.';
  if (error?.status === 404) return 'El documento no está disponible en su estación o aerolínea.';
  if (error?.status === 409) return 'El saldo, la versión o la referencia cambió. Recargue el documento antes de preparar otra solicitud.';
  if (error?.status === 400) return 'Revise importes, fechas y motivos de la solicitud.';
  return error?.status ? 'No se pudo completar la acción. Intente de nuevo.' : error?.message || 'No hay conexión con ELEVANT. Intente de nuevo.';
}
