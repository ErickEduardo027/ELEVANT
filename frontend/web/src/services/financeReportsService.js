import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';
import { downloadTabularReport } from '../utils/reportDownloads';

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
export function downloadFinanceReport(result) {
  downloadTabularReport({
    title: 'Reporte financiero ELEVANT',
    format: result.format,
    fileName: result.fileName,
    rows: result.report.byAirline ?? [],
  });
}
export function setFinanceReportForTests(value) { report = structuredClone(value); }
export function resetFinanceReportsForTests() { audit = []; report = structuredClone(EMPTY_REPORT); }
