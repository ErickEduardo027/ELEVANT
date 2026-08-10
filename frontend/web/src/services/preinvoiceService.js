const INITIAL = [
  { id: 'PRE-2026-082', airline: 'American Airlines', period: 'Agosto 2026', services: 8, total: 2680, currency: 'USD', status: 'draft' },
  { id: 'PRE-2026-079', airline: 'Arajet', period: 'Agosto 2026', services: 6, total: 111000, currency: 'DOP', status: 'approved' },
  { id: 'PRE-2026-074', airline: 'Delta Air Lines', period: 'Julio 2026', services: 11, total: 3475, currency: 'USD', status: 'sent' },
];
let preinvoices = structuredClone(INITIAL);

export async function getPreinvoices() { return structuredClone(preinvoices); }
export async function createPreinvoice({ airline, period, currency = 'USD' }) {
  if (!airline || !period) throw new Error('Aerolínea y período son obligatorios.');
  const item = { id: `PRE-2026-${String(83 + preinvoices.length).padStart(3, '0')}`, airline, period, services: 4, total: currency === 'DOP' ? 74000 : 1240, currency, status: 'draft' };
  preinvoices.unshift(item); return structuredClone(item);
}
export async function approvePreinvoice(id) { const item = preinvoices.find(row => row.id === id); if (!item) throw new Error('Pre-factura no encontrada.'); item.status = 'approved'; return structuredClone(item); }
export async function sendPreinvoice(id) { const item = preinvoices.find(row => row.id === id); if (!item || item.status !== 'approved') throw new Error('La pre-factura debe estar aprobada antes del envío.'); item.status = 'sent'; item.sentAt = new Date().toISOString(); return structuredClone(item); }
export function resetPreinvoicesForTests() { preinvoices = structuredClone(INITIAL); }
