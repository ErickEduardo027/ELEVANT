const INITIAL = [
  { id: 'TAR-018-01', contract: 'CTR-2026-018', airline: 'Arajet', service: 'Puente de abordaje', amount: 18500, currency: 'DOP', unit: 'Por operación', validFrom: '2026-03-01' },
  { id: 'TAR-014-03', contract: 'CTR-2026-014', airline: 'American Airlines', service: 'GPU', amount: 325, currency: 'USD', unit: 'Por hora', validFrom: '2026-01-01' },
  { id: 'TAR-009-02', contract: 'CTR-2025-009', airline: 'Delta Air Lines', service: 'Aire acondicionado', amount: 280, currency: 'USD', unit: 'Por hora', validFrom: '2025-09-16' },
];
let tariffs = structuredClone(INITIAL); let history = [];
export async function getFinanceTariffs() { return { tariffs: structuredClone(tariffs), history: structuredClone(history) }; }
export async function scheduleTariffChange(id, { amount, effectiveFrom }) { const item = tariffs.find(row => row.id === id); if (!item) throw new Error('Tarifa no encontrada.'); if (!(Number(amount) > 0)) throw new Error('Indique una tarifa válida.'); if (!effectiveFrom) throw new Error('Indique la fecha de aplicación.'); const change = { id: `CAM-${Date.now()}`, tariffId: id, previousAmount: item.amount, newAmount: Number(amount), currency: item.currency, effectiveFrom, createdAt: new Date().toISOString(), appliesTo: 'future-services' }; history.unshift(change); item.pendingChange = { amount: Number(amount), effectiveFrom }; return structuredClone(change); }
export function resetFinanceTariffsForTests() { tariffs = structuredClone(INITIAL); history = []; }
