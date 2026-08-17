const INITIAL = [
  { id: 'PRE-2026-082', airline: 'American Airlines', period: 'Agosto 2026', services: 8, total: 2680, currency: 'USD', status: 'draft' },
  { id: 'PRE-2026-079', airline: 'Arajet', period: 'Agosto 2026', services: 6, total: 111000, currency: 'DOP', status: 'approved' },
  { id: 'PRE-2026-074', airline: 'Delta Air Lines', period: 'Julio 2026', services: 11, total: 3475, currency: 'USD', status: 'sent' },
];
let preinvoices = structuredClone(INITIAL);

function usesPrototypeApi() { return import.meta.env.MODE !== 'test'; }
async function financeApi(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la pre-facturación.');
  return payload;
}

export async function getPreinvoices() { return usesPrototypeApi() ? financeApi('/api/finance/preinvoices') : structuredClone(preinvoices); }
export async function createPreinvoice({ airline, period, currency = 'USD' }) {
  if (!airline || !period) throw new Error('Aerolínea y período son obligatorios.');
  if (usesPrototypeApi()) return financeApi('/api/finance/preinvoices', { method: 'POST', body: JSON.stringify({ airline, period, currency }) });
  const item = { id: `PRE-2026-${String(83 + preinvoices.length).padStart(3, '0')}`, airline, period, services: 4, total: currency === 'DOP' ? 74000 : 1240, currency, status: 'draft' };
  preinvoices.unshift(item); return structuredClone(item);
}
export async function approvePreinvoice(id) { if (usesPrototypeApi()) return financeApi(`/api/finance/preinvoices/${id}/approve`, { method: 'POST' }); const item = preinvoices.find(row => row.id === id); if (!item) throw new Error('Pre-factura no encontrada.'); item.status = 'approved'; return structuredClone(item); }
export async function sendPreinvoice(id) { if (usesPrototypeApi()) return financeApi(`/api/finance/preinvoices/${id}/send`, { method: 'POST' }); const item = preinvoices.find(row => row.id === id); if (!item || item.status !== 'approved') throw new Error('La pre-factura debe estar aprobada antes del envío.'); item.status = 'sent'; item.sentAt = new Date().toISOString(); return structuredClone(item); }
export function resetPreinvoicesForTests() { preinvoices = structuredClone(INITIAL); }
import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';
