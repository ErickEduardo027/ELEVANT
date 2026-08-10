const REPORT = {
  kpis: { approvedServices: 36, preinvoiced: 11, reconciled: 8, differences: 3 },
  byAirline: [
    { airline: 'American Airlines', approved: 12, billed: 10, amount: 4320, currency: 'USD' },
    { airline: 'Delta Air Lines', approved: 9, billed: 8, amount: 3475, currency: 'USD' },
    { airline: 'Arajet', approved: 8, billed: 7, amount: 148000, currency: 'DOP' },
    { airline: 'JetBlue', approved: 7, billed: 6, amount: 2890, currency: 'USD' },
  ],
};
let audit = [];
export async function getFinanceReport() { return { ...structuredClone(REPORT), audit: structuredClone(audit) }; }
export async function registerFinanceReportExport(format, user = 'Usuario de Finanzas') { const row = { id: `EXP-${Date.now()}`, format, user, exportedAt: new Date().toISOString() }; audit.unshift(row); return structuredClone(row); }
export function resetFinanceReportsForTests() { audit = []; }
