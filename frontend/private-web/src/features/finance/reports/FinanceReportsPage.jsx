import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import FilterBar from '../../../components/FilterBar';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { ReportIcon } from '../components/icons';
import { downloadFinanceReport, formatMoney, getFinanceReport } from '../../../services/financeBookService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

export const FINANCE_REPORTS = [
  { key: 'revenue', label: 'Ingresos por período' },
  { key: 'receivables', label: 'Cuentas por cobrar' },
  { key: 'collections', label: 'Cobranza' },
  { key: 'pipeline', label: 'Pipeline de facturación' },
  { key: 'charges', label: 'Cargos y ajustes' },
  { key: 'disputes', label: 'Disputas' },
  { key: 'tariffs', label: 'Uso de tarifas' },
  { key: 'credit-notes', label: 'Notas de crédito' },
];

const isoDate = date => date.toISOString().slice(0, 10);

/** Formats an invariant report cell by its column type; money uses the row's currency column when present. */
export function formatCell(value, column, row, columns) {
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'money') {
    const currencyIndex = columns.findIndex(item => item.key === 'currency');
    const currency = column.key === 'usd' ? 'USD' : currencyIndex >= 0 ? row[currencyIndex] : '';
    return formatMoney(value, currency);
  }
  if (column.type === 'percent') return `${Number(value).toLocaleString('es-DO')} %`;
  if (column.type === 'number') return Number(value).toLocaleString('es-DO');
  return value;
}

export default function FinanceReportsPage({ initialStationId }) {
  const { access } = useDepartmentAccess();
  const canExport = Boolean(access?.can('finance.reports.export'));
  const stations = (readSession()?.stationScopes ?? []).filter(scope => scope?.stationId);
  const today = new Date();
  const [reportKey, setReportKey] = useState('revenue');
  const [filters, setFilters] = useState({
    from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today),
    stationId: initialStationId ?? '', currency: '',
  });
  const [state, setState] = useState({ status: 'loading', report: null, error: '' });
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    setState(current => ({ ...current, status: 'loading' }));
    try {
      setState({ status: 'ready', report: await getFinanceReport(reportKey, filters), error: '' });
    } catch (failure) {
      setState({ status: 'error', report: null, error: failure.status === 403
        ? 'No tiene acceso a este reporte o los filtros no son válidos.' : failure.message });
    }
  }, [reportKey, filters]);
  useEffect(() => { void load(); }, [load]);

  async function exportAs(format) {
    setExporting(format);
    try { await downloadFinanceReport(reportKey, format, filters); }
    catch (failure) { setState(current => ({ ...current, error: failure.message })); }
    finally { setExporting(''); }
  }

  const report = state.report;
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Reportes financieros" description={report?.description ?? 'Reportes calculados en el servidor sobre sus estaciones.'}
        actions={canExport && (
          <>
            <button type="button" disabled={Boolean(exporting) || !report} onClick={() => void exportAs('csv')} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold disabled:opacity-60 dark:border-white/10">{exporting === 'csv' ? 'Generando…' : 'Exportar CSV'}</button>
            <button type="button" disabled={Boolean(exporting) || !report} onClick={() => void exportAs('pdf')} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{exporting === 'pdf' ? 'Generando…' : 'Exportar PDF'}</button>
          </>
        )} />
      <div role="tablist" aria-label="Reportes" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FINANCE_REPORTS.map(item => (
          <button key={item.key} type="button" role="tab" aria-selected={reportKey === item.key} onClick={() => setReportKey(item.key)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${reportKey === item.key ? 'bg-accent-600 text-white' : 'text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5'}`}>
            {item.label}
          </button>
        ))}
      </div>
      <FilterBar>
        <label className="text-xs font-semibold">Desde<input type="date" value={filters.from} max={filters.to} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} className={fieldClass} /></label>
        <label className="text-xs font-semibold">Hasta<input type="date" value={filters.to} min={filters.from} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} className={fieldClass} /></label>
        {stations.length > 1 && <label className="text-xs font-semibold">Estación<select value={filters.stationId} onChange={event => setFilters(current => ({ ...current, stationId: event.target.value }))} className={fieldClass}>
          <option value="">Todas</option>{stations.map(station => <option key={station.stationId} value={station.stationId}>{station.stationCode}</option>)}</select></label>}
        <label className="text-xs font-semibold">Moneda<select value={filters.currency} onChange={event => setFilters(current => ({ ...current, currency: event.target.value }))} className={fieldClass}>
          <option value="">Todas</option><option>USD</option><option>DOP</option></select></label>
      </FilterBar>
      {state.status === 'loading' && !report && <p role="status" className="text-sm">Calculando reporte…</p>}
      {state.error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{state.error}</p>}
      {report && (
        <>
          {report.summary.length > 0 && (
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {report.summary.map(metric => (
                <div key={metric.label} className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light">{metric.label}</dt>
                  <dd className="mt-1 text-xl font-bold tabular-nums text-accent-600">
                    {metric.type === 'money' ? formatMoney(metric.value, metric.currencyCode) : metric.type === 'percent' ? `${metric.value} %` : Number(metric.value).toLocaleString('es-DO')}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {report.rows.length === 0 ? (
            <EmptyState icon={ReportIcon} title="Sin datos" description="No hay movimientos para los filtros elegidos." />
          ) : (
            <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
              <table className="table-stack w-full min-w-[720px] text-left text-sm">
                <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]">
                  <tr>{report.columns.map(column => <th key={column.key} className={`p-3 ${['money', 'number', 'percent'].includes(column.type) ? 'text-right' : ''}`}>{column.label}</th>)}</tr>
                </thead>
                <tbody>{report.rows.map((row, index) => (
                  <tr key={index} className="border-t border-black/5 dark:border-white/5">
                    {report.columns.map((column, cell) => (
                      <td key={column.key} className={`p-3 ${['money', 'number', 'percent'].includes(column.type) ? 'text-right tabular-nums' : ''}`}>
                        {formatCell(row[cell], column, row, report.columns)}
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </StackedTable>
          )}
          {report.notes.map(note => <p key={note} className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{note}</p>)}
        </>
      )}
    </div>
  );
}
