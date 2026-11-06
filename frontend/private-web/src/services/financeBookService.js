import { commercialApi } from './commercialGovernanceApi';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const json = (method, body) => ({ method, body: JSON.stringify(body) });
const query = params => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const FINANCE_CURRENCIES = ['USD', 'DOP'];

// Catalog services Finance can price
export const listFinanceServices = () => commercialApi('/finance/services');

// Billing units
export const listBillingUnits = () => commercialApi('/finance/billing-units');
export const saveBillingUnit = (id, values) =>
  commercialApi(id ? `/finance/billing-units/${id}` : '/finance/billing-units', json(id ? 'PUT' : 'POST', values));

// Base service tariff
export const listServiceTariffs = currency => commercialApi(`/finance/service-tariffs${query({ currency })}`);
export const getServiceTariff = id => commercialApi(`/finance/service-tariffs/${id}`);
export const createServiceTariffDraft = values => commercialApi('/finance/service-tariffs', json('POST', values));
export const saveServiceTariffDraft = (id, values) => commercialApi(`/finance/service-tariffs/${id}`, json('PUT', values));
export const publishServiceTariff = (id, expectedVersion) =>
  commercialApi(`/finance/service-tariffs/${id}/publish`, json('POST', { expectedVersion }));
export const deleteServiceTariffDraft = (id, expectedVersion) =>
  commercialApi(`/finance/service-tariffs/${id}${query({ expectedVersion })}`, { method: 'DELETE' });

// Charges
export const listCharges = () => commercialApi('/finance/charges');
export const saveCharge = (id, values) =>
  commercialApi(id ? `/finance/charges/${id}` : '/finance/charges', json(id ? 'PUT' : 'POST', values));
export const listChargeTariffs = currency => commercialApi(`/finance/charge-tariffs${query({ currency })}`);
export const getChargeTariff = id => commercialApi(`/finance/charge-tariffs/${id}`);
export const createChargeTariffDraft = values => commercialApi('/finance/charge-tariffs', json('POST', values));
export const saveChargeTariffDraft = (id, values) => commercialApi(`/finance/charge-tariffs/${id}`, json('PUT', values));
export const publishChargeTariff = (id, expectedVersion) =>
  commercialApi(`/finance/charge-tariffs/${id}/publish`, json('POST', { expectedVersion }));
export const deleteChargeTariffDraft = (id, expectedVersion) =>
  commercialApi(`/finance/charge-tariffs/${id}${query({ expectedVersion })}`, { method: 'DELETE' });

// Exchange rates
export const listExchangeRates = (from, to, includeHistory = false) =>
  commercialApi(`/finance/exchange-rates${query({ from, to, includeHistory })}`);
export const recordExchangeRate = values => commercialApi('/finance/exchange-rates', json('POST', values));
export const correctExchangeRate = (id, values) =>
  commercialApi(`/finance/exchange-rates/${id}/correction`, json('POST', values));

// Contract approvals
export const listContractApprovals = (pendingOnly = true) =>
  commercialApi(`/finance/contract-approvals${query({ pendingOnly })}`);
export const getContractApproval = versionId => commercialApi(`/finance/contract-approvals/${versionId}`);
/** Approves or returns a version with the version on screen and the intent's Idempotency-Key. */
export const decideContractApproval = (versionId, values, idempotencyKey) =>
  commercialApi(`/finance/contract-approvals/${versionId}/decision`, {
    ...json('POST', values), ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });

// Preinvoice draft edits
export const editPreinvoiceLine = (preinvoiceId, lineId, values) =>
  commercialApi(`/finance/preinvoices/${preinvoiceId}/lines/${lineId}`, json('PUT', values));
export const addPreinvoiceAdjustment = (preinvoiceId, values) =>
  commercialApi(`/finance/preinvoices/${preinvoiceId}/adjustments`, json('POST', values));

// Invoice ledger
export const listFinanceInvoices = (filters = {}) =>
  commercialApi(`/finance/invoices${query({ page: 1, limit: 25, ...filters })}`);
export const getFinanceInvoice = id => commercialApi(`/finance/invoices/${id}`);
export const issueCreditNote = (invoiceId, values) =>
  commercialApi(`/finance/invoices/${invoiceId}/credit-notes`, json('POST', values));
export const recordPartialPayment = values => commercialApi('/finance/payments', json('POST', values));

// Reports
export const listFinanceReports = () => commercialApi('/finance/reports');
export const getFinanceReport = (key, filters) => commercialApi(`/finance/reports/${key}${query(filters)}`);

/** Downloads an export with the session token; the browser saves it with the server's file name. */
export async function downloadFinanceReport(key, format, filters) {
  const origin = String(process.env.NEXT_PUBLIC_ELEVANT_API_URL || '').replace(/\/$/, '');
  const token = readSession()?.token;
  if (!origin || !token) throw Object.assign(new Error('La sesión expiró. Vuelva a iniciar sesión.'), { status: 401 });
  let response;
  try {
    response = await fetch(`${origin}/api/v1/finance/reports/${key}/export${query({ ...filters, format })}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
  } catch {
    throw new Error('No hay conexión con ELEVANT. Intente de nuevo.');
  }
  handleUnauthorizedResponse(response);
  if (!response.ok) {
    throw Object.assign(new Error(response.status === 403
      ? 'No tiene permiso para exportar este reporte.' : 'No se pudo generar la exportación.'), { status: response.status });
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `elevant-${key}-${filters.from}-${filters.to}.${format}`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.floor(Math.random() * 16);
      return (char === 'x' ? random : (random % 4) + 8).toString(16);
    });
}

export function formatMoney(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${currency ? `${currency} ` : ''}${number.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
