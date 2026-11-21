import { exportFinanceReport, financeReportFileName, getFinanceReport, listFinanceReports } from
  '../../../services/financeBookService';
import { financeReportMessage } from '../../../services/financeErrors';
import { formatReportValue } from '../../reports/reportModel';

/**
 * The six reports of the simplified Finance (4-A, 4-N19, 4-N20), used when the API list does not answer with one. The
 * cut-off ones (ADR-0048) ask only for the date.
 */
export const FINANCE_REPORTS = Object.freeze([
  { key: 'revenue', title: 'Ingresos por período', description: '' },
  { key: 'receivables', title: 'Cuentas por cobrar y antigüedad', description: '', asOfDate: true },
  { key: 'collections', title: 'Cobranza', description: '' },
  { key: 'payables', title: 'Cuentas por pagar', description: '', asOfDate: true },
  { key: 'charges', title: 'Recargos', description: '' },
  { key: 'sales', title: 'Ventas (e-CF simulado)', description: '' },
]);

/** A finance report covers up to two years (FinanceReportsController). */
const MAX_RANGE_DAYS = 731;
const CUT_OFF = new Set(FINANCE_REPORTS.filter(item => item.asOfDate).map(item => item.key));

/** The currency of a money cell: the fixed one of a USD or DOP column, else the row's currency column. */
function currencyReader(column, columns) {
  if (column.key === 'usd') return () => 'USD';
  if (column.key === 'dop') return () => 'DOP';
  const index = columns.findIndex(item => item.key === (column.key === 'invoiceAmount' ? 'invoiceCurrency' : 'currency'));
  return index >= 0 ? row => row[index] ?? '' : undefined;
}

function metricValue(metric) {
  if (metric.type === 'money') return formatReportValue(metric.value, 'money', { currency: metric.currencyCode ?? '' });
  return formatReportValue(metric.value, metric.type === 'percent' ? 'percent' : 'number');
}

/** A finance report in the shape of useServerReport. It is not paged: every row of the period is on screen. */
export function normalizeFinanceReport(report, { now = new Date() } = {}) {
  return {
    key: report.key, title: report.title, description: report.description,
    // The finance report carries no time of its own: it was computed when it answered.
    asOf: report.generatedAt ?? now.toISOString(), generatedBy: report.generatedBy ?? '',
    columns: report.columns.map(column => ({ label: column.label, type: column.type,
      ...(column.type === 'money' && { currencyOf: currencyReader(column, report.columns) }) })),
    rows: report.rows, page: 1, hasMore: false, totalRows: report.rows.length,
    summary: (report.summary ?? []).map(metric => ({ label: metric.label, value: metricValue(metric),
      context: metric.context ?? null })),
    appliedFilters: Array.isArray(report.filters) ? report.filters : [],
    notes: report.notes ?? [],
  };
}

/** A failure in Finance's words, keeping its status and code for the screen. */
const explained = (error, options) => Object.assign(new Error(financeReportMessage(error, options)),
  { status: error?.status ?? null, code: error?.code });

/** The adapter of Finanzas › Reportes for useServerReport. */
export function createFinanceReportSource() {
  return {
    paged: false,
    baseParams: ['stationId', 'airlineId', 'currency'],
    loadCatalog: async () => {
      let list;
      try { list = await listFinanceReports(); } catch (error) { throw explained(error); }
      const reports = Array.isArray(list) && list.length ? list : FINANCE_REPORTS;
      return { maxRangeDays: MAX_RANGE_DAYS, reports: reports.map(item => ({ key: item.key, title: item.title,
        description: item.description ?? '', asOfDate: item.asOfDate ?? CUT_OFF.has(item.key), filters: [] })) };
    },
    loadPage: async (key, query) => {
      try { return normalizeFinanceReport(await getFinanceReport(key, query)); } catch (error) { throw explained(error); }
    },
    exportReport: async (key, query, format) => {
      try { return await exportFinanceReport(key, format, query); } catch (error) {
        throw explained(error, { forbidden: 'No tienes permiso para descargar este reporte.',
          fallback: 'Revisa la conexión e inténtalo de nuevo.' });
      }
    },
    fileName: (key, query, format) => financeReportFileName(key, query, format),
  };
}
