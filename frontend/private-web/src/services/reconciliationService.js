const INITIAL = [
  { id: 'CON-2026-026', airline: 'Delta Air Lines', period: 'Julio 2026', registered: 3475, invoiced: 3195, collected: 3195, currency: 'USD', status: 'difference' },
  { id: 'CON-2026-025', airline: 'American Airlines', period: 'Julio 2026', registered: 4320, invoiced: 4320, collected: 4320, currency: 'USD', status: 'matched' },
  { id: 'CON-2026-024', airline: 'Arajet', period: 'Julio 2026', registered: 148000, invoiced: 148000, collected: 130000, currency: 'DOP', status: 'difference' },
];
let rows = structuredClone(INITIAL);
export async function getReconciliations() { return structuredClone(rows); }
export async function reconcileRecord(id, note) { const item = rows.find(row => row.id === id); if (!item) throw new Error('Conciliación no encontrada.'); if (!note?.trim()) throw new Error('Indique cómo fue resuelta la diferencia.'); item.invoiced = item.registered; item.collected = item.registered; item.status = 'reconciled'; item.note = note.trim(); item.reconciledAt = new Date().toISOString(); return structuredClone(item); }
export function resetReconciliationsForTests() { rows = structuredClone(INITIAL); }
