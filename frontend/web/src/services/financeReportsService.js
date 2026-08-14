import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

const EMPTY_REPORT = { kpis: { approvedServices: 0, preinvoiced: 0, reconciled: 0, differences: 0 }, byAirline: [] };
let report = structuredClone(EMPTY_REPORT);
let audit = [];
const usesApi = () => import.meta.env.MODE !== 'test';

async function request(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.token ?? ''}`, ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { handleUnauthorizedResponse(response); throw new Error(payload.error || 'No fue posible generar el reporte.'); }
  return payload;
}

export async function getFinanceReport() { return usesApi() ? request('/api/finance/reports') : { ...structuredClone(report), audit: structuredClone(audit) }; }
export async function registerFinanceReportExport(format, user = 'Usuario de Finanzas') {
  if (usesApi()) return request('/api/finance/reports/export', { method: 'POST', body: JSON.stringify({ format }) });
  const row = { id: `EXP-${Date.now()}`, format, user, exportedAt: new Date().toISOString(), report: structuredClone(report), fileName: `reporte.${format === 'excel' ? 'xls' : 'pdf'}` }; audit.unshift(row); return structuredClone(row);
}
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function downloadFinanceReport(result) {
  const rows = result.report.byAirline ?? [];
  if (result.format === 'excel') {
    const body = rows.map(row => `<Row><Cell><Data ss:Type="String">${esc(row.airline)}</Data></Cell><Cell><Data ss:Type="Number">${row.approved}</Data></Cell><Cell><Data ss:Type="Number">${row.billed}</Data></Cell><Cell><Data ss:Type="Number">${row.amount}</Data></Cell></Row>`).join('');
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Finanzas"><Table><Row><Cell><Data ss:Type="String">Aerolínea</Data></Cell><Cell><Data ss:Type="String">Aprobados</Data></Cell><Cell><Data ss:Type="String">Facturados</Data></Cell><Cell><Data ss:Type="String">Importe</Data></Cell></Row>${body}</Table></Worksheet></Workbook>`;
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' })); const link = document.createElement('a'); link.href = url; link.download = result.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  const popup = window.open('', '_blank', 'noopener,noreferrer'); if (!popup) throw new Error('El navegador bloqueó la ventana de impresión.');
  popup.document.write(`<html><head><title>Reporte financiero</title><style>body{font-family:Arial;padding:32px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px}</style></head><body><h1>Reporte financiero ELEVANT</h1><table><tr><th>Aerolínea</th><th>Aprobados</th><th>Facturados</th><th>Importe</th></tr>${rows.map(row => `<tr><td>${esc(row.airline)}</td><td>${row.approved}</td><td>${row.billed}</td><td>${row.amount} ${esc(row.currency)}</td></tr>`).join('')}</table><script>window.onload=()=>window.print()</script></body></html>`); popup.document.close();
}
export function setFinanceReportForTests(value) { report = structuredClone(value); }
export function resetFinanceReportsForTests() { audit = []; report = structuredClone(EMPTY_REPORT); }
