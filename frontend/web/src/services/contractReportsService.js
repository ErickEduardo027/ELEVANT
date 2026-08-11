const SNAPSHOT = {
  generatedAt: '2026-08-10T11:00:00-04:00',
  rows: [
    { airline: 'Arajet', activeContracts: 1, expiringContracts: 0, services: 6, estimatedValue: 48600 },
    { airline: 'American Airlines', activeContracts: 1, expiringContracts: 0, services: 8, estimatedValue: 78250 },
    { airline: 'Delta Air Lines', activeContracts: 0, expiringContracts: 1, services: 7, estimatedValue: 64100 },
    { airline: 'JetBlue', activeContracts: 0, expiringContracts: 1, services: 5, estimatedValue: 42300 },
  ],
};

let exportsLog = [];

export async function getContractReportsSnapshot() {
  return { ...SNAPSHOT, rows: SNAPSHOT.rows.map(row => ({ ...row })) };
}

export async function recordContractReportExport({ format, airline, user }) {
  const record = { id: `EXP-${exportsLog.length + 1}`, format, airline, user, exportedAt: new Date().toISOString() };
  exportsLog = [record, ...exportsLog];
  return { ...record };
}

export function buildExcelCompatibleContent(rows) {
  const headers = ['Aerolínea', 'Contratos activos', 'Próximos a vencer', 'Servicios pactados', 'Valor estimado USD'];
  const body = rows.map(row => [row.airline, row.activeContracts, row.expiringContracts, row.services, row.estimatedValue]);
  return [headers, ...body].map(columns => columns.join('\t')).join('\n');
}

export function __resetContractReportsForTests() {
  exportsLog = [];
}
