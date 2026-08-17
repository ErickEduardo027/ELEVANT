import { BarChartIcon } from '../../shell/components/icons';
import { ContractIcon, ServiceIcon, AlertIcon } from '../components/icons';
import KpiCard from '../../../components/KpiCard';
import { downloadTabularReport } from '../../../utils/reportDownloads';
import { useContractReportsData } from './useContractReportsData';

const money = value => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

function downloadExcel(rows) {
  downloadTabularReport({ title: 'Reporte contractual ELEVANT', format: 'excel', fileName: 'reporte-contractual.xls', rows });
}

export default function ContractReportsPage() {
  const reports = useContractReportsData();
  const maxServices = Math.max(...reports.rows.map(row => row.services), 1);

  async function exportExcel() {
    downloadExcel(reports.rows);
    await reports.registerExport('Excel');
  }

  async function exportPdf() {
    downloadTabularReport({ title: 'Reporte contractual ELEVANT', format: 'pdf', fileName: 'reporte-contractual.pdf', rows: reports.rows });
    await reports.registerExport('PDF');
  }

  if (reports.status === 'error') return <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card"><p className="font-semibold text-status-danger">No se pudo generar el reporte contractual.</p><button type="button" onClick={reports.retry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button></div>;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión contractual</p><h1 className="mt-1 text-2xl font-bold">Reportes contractuales</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Consulta indicadores contractuales según tus permisos.</p></div><div className="flex flex-wrap gap-2 print:hidden"><button type="button" onClick={exportExcel} disabled={!reports.rows.length} className="rounded-xl border border-accent-600 px-4 py-2.5 text-sm font-semibold text-accent-600 disabled:opacity-50">Exportar Excel</button><button type="button" onClick={exportPdf} disabled={!reports.rows.length} className="rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Exportar PDF</button></div></header>
      <section className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm dark:border-white/5 dark:bg-surface-dark-card sm:flex-row sm:items-center"><label htmlFor="report-airline" className="text-sm font-semibold">Aerolínea</label><select id="report-airline" value={reports.airlineFilter} onChange={event => reports.setAirlineFilter(event.target.value)} className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm dark:border-white/10 dark:bg-surface-dark"><option value="all">Todas las aerolíneas</option>{reports.data?.rows?.map(row => <option key={row.airline}>{row.airline}</option>)}</select>{reports.lastExport && <p role="status" className="text-xs text-status-success sm:ml-auto">Exportación {reports.lastExport.format} registrada.</p>}</section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="Contratos activos" value={reports.totals.activeContracts} icon={ContractIcon} loading={reports.status === 'loading'} /><KpiCard label="Próximos a vencer" value={reports.totals.expiringContracts} icon={AlertIcon} tone="signal" loading={reports.status === 'loading'} /><KpiCard label="Servicios pactados" value={reports.totals.services} icon={ServiceIcon} loading={reports.status === 'loading'} /><KpiCard label="Valor contractual estimado" icon={BarChartIcon} loading={reports.status === 'loading'} visual={<span className="text-2xl font-semibold">{money(reports.totals.estimatedValue)}</span>} /></div>
      <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
        <section className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm dark:border-white/5 dark:bg-surface-dark-card"><h2 className="text-sm font-semibold">Servicios por aerolínea</h2><div className="mt-5 space-y-4">{reports.rows.map(row => <div key={row.airline}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold">{row.airline}</span><span>{row.services}</span></div><div className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"><div className="h-full rounded-full bg-accent-600" style={{ width: `${(row.services / maxServices) * 100}%` }} /></div></div>)}</div></section>
        <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">{reports.status === 'loading' ? <div className="h-64 animate-pulse bg-black/[0.03]" /> : reports.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light"><tr><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Activos</th><th className="px-5 py-3">Por vencer</th><th className="px-5 py-3">Servicios</th><th className="px-5 py-3">Valor estimado</th></tr></thead><tbody className="divide-y divide-black/5 dark:divide-white/5">{reports.rows.map(row => <tr key={row.airline}><td className="px-5 py-4 font-semibold">{row.airline}</td><td className="px-5 py-4">{row.activeContracts}</td><td className="px-5 py-4">{row.expiringContracts}</td><td className="px-5 py-4">{row.services}</td><td className="px-5 py-4 font-semibold">{money(row.estimatedValue)}</td></tr>)}</tbody></table></div> : <p className="p-10 text-center text-sm text-text-secondary-light">No hay datos para el filtro seleccionado.</p>}</section>
      </div>
    </div>
  );
}
