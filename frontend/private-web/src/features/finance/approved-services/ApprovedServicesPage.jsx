import { useApprovedServicesData } from './useApprovedServicesData';

function money(value, currency) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency, maximumFractionDigits: currency === 'DOP' ? 0 : 2 }).format(value);
}

function date(value) {
  return new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

export default function ApprovedServicesPage() {
  const data = useApprovedServicesData();

  if (data.status === 'error') return <div role="alert" className="rounded-2xl bg-white p-6 dark:bg-surface-dark-card"><p className="font-semibold text-status-danger">No se pudieron cargar los servicios aprobados.</p><button type="button" onClick={data.retry} className="mt-3 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button></div>;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p><h1 className="mt-1 text-2xl font-bold">Servicios aprobados</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Consulta y revisión de servicios aprobados por aerolínea o período.</p></header>
      <section className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold">Buscar<input aria-label="Buscar servicios" value={data.query} onChange={event => data.setQuery(event.target.value)} placeholder="Vuelo, servicio o contrato" className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" /></label>
          <label className="text-xs font-semibold">Aerolínea<select aria-label="Filtrar por aerolínea" value={data.airline} onChange={event => data.setAirline(event.target.value)} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark"><option value="all">Todas</option>{data.airlines.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="text-xs font-semibold">Período<select aria-label="Filtrar por período" value={data.period} onChange={event => data.setPeriod(event.target.value)} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark"><option value="all">Todos</option><option value="2026-08">Agosto 2026</option><option value="2026-07">Julio 2026</option></select></label>
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        {data.status === 'loading' ? <div data-testid="approved-services-loading" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" /> : data.services.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]"><tr><th className="px-5 py-3">Servicio</th><th className="px-5 py-3">Aerolínea / vuelo</th><th className="px-5 py-3">Contrato</th><th className="px-5 py-3">Fecha</th><th className="px-5 py-3 text-right">Importe</th><th className="px-5 py-3">Revisión</th></tr></thead><tbody className="divide-y divide-black/5 dark:divide-white/5">{data.services.map(item => <tr key={item.id}><td className="px-5 py-4"><span className="block font-semibold">{item.service}</span><span className="font-mono text-[11px] text-text-secondary-light">{item.id}</span></td><td className="px-5 py-4">{item.airline}<span className="block text-xs text-text-secondary-light">{item.flight}</span></td><td className="px-5 py-4 font-mono text-xs">{item.contract}</td><td className="px-5 py-4">{date(item.date)}</td><td className="px-5 py-4 text-right font-semibold">{money(item.amount, item.currency)}</td><td className="px-5 py-4">{item.status === 'reviewed' ? <span className="rounded-full bg-status-success/10 px-2.5 py-1 text-xs font-semibold text-status-success">Revisado</span> : <button type="button" onClick={() => data.markReviewed(item.id)} className="rounded-lg border border-accent-600 px-3 py-1.5 text-xs font-semibold text-accent-600">Marcar revisado</button>}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-text-secondary-light">No hay servicios que coincidan con los filtros.</p>}
      </section>
    </div>
  );
}
