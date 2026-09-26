const FINANCE_HOME_SNAPSHOT = {
  kpis: {
    approvedServices: 36,
    pendingReview: 7,
    draftPreinvoices: 4,
    reconciliationDifferences: 3,
  },
  approvedServices: [
    { id: 'SRV-2608-041', airline: 'Arajet', flight: 'DM 1763', service: 'Puente de abordaje', approvedAt: '2026-08-10T08:42:00-04:00', amount: 18500, currency: 'DOP' },
    { id: 'SRV-2608-039', airline: 'American Airlines', flight: 'AA 2401', service: 'GPU', approvedAt: '2026-08-10T08:15:00-04:00', amount: 325, currency: 'USD' },
    { id: 'SRV-2608-035', airline: 'Delta Air Lines', flight: 'DL 1826', service: 'Aire acondicionado', approvedAt: '2026-08-09T18:27:00-04:00', amount: 280, currency: 'USD' },
    { id: 'SRV-2608-031', airline: 'JetBlue', flight: 'B6 1015', service: 'Puente de abordaje', approvedAt: '2026-08-09T17:54:00-04:00', amount: 310, currency: 'USD' },
  ],
  pendingActions: [
    { id: 'PRE-2026-082', kind: 'Pre-factura', airline: 'American Airlines', detail: 'Revisión previa al envío', moduleId: 'finance-preinvoices' },
    { id: 'CON-2026-026', kind: 'Conciliación', airline: 'Delta Air Lines', detail: 'Diferencia en servicios registrados', moduleId: 'finance-reconciliation' },
    { id: 'PRE-2026-079', kind: 'Pre-factura', airline: 'Arajet', detail: 'Pendiente de revisión', moduleId: 'finance-preinvoices' },
  ],
};

export async function getFinanceHomeSnapshot() {
  return structuredClone(FINANCE_HOME_SNAPSHOT);
}
