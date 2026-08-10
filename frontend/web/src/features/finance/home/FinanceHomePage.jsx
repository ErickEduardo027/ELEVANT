import KpiCard from '../../dashboard/components/KpiCard';
import {
  AlertIcon,
  ApprovedServicesIcon,
  ArrowIcon,
  PreInvoiceIcon,
  ReconciliationIcon,
} from '../components/icons';

function formatDateTime(value) {
  return new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency, maximumFractionDigits: currency === 'DOP' ? 0 : 2 }).format(amount);
}

function SectionCard({ title, actionLabel, onAction, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <header className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/5">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
        <button type="button" onClick={onAction} className="flex items-center gap-1 text-xs font-semibold text-accent-600 hover:text-accent-600/80">
          {actionLabel}<ArrowIcon className="h-3.5 w-3.5" />
        </button>
      </header>
      {children}
    </section>
  );
}

export default function FinanceHomePage({ status, data, error, onRetry, onNavigate }) {
  const isLoading = status === 'loading';

  if (status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
        <p className="font-semibold text-status-danger">No se pudo cargar el resumen financiero.</p>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{error?.message ?? 'Intente nuevamente.'}</p>
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Departamento de Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Resumen financiero</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Seguimiento de servicios aprobados, pre-facturación y conciliaciones pendientes.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Servicios aprobados" value={data?.kpis?.approvedServices ?? 0} icon={ApprovedServicesIcon} loading={isLoading} />
        <KpiCard label="Pendientes de revisión" value={data?.kpis?.pendingReview ?? 0} icon={AlertIcon} loading={isLoading} tone="signal" />
        <KpiCard label="Pre-facturas guardadas" value={data?.kpis?.draftPreinvoices ?? 0} icon={PreInvoiceIcon} loading={isLoading} />
        <KpiCard label="Diferencias por conciliar" value={data?.kpis?.reconciliationDifferences ?? 0} icon={ReconciliationIcon} loading={isLoading} tone="signal" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <SectionCard title="Servicios aprobados recientes" actionLabel="Ver servicios" onAction={() => onNavigate('finance-approved-services')}>
          {isLoading ? <div data-testid="services-table-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" /> : data?.approvedServices?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-black/[0.025] text-xs uppercase tracking-wide text-text-secondary-light dark:bg-white/[0.025] dark:text-text-secondary-dark">
                  <tr><th className="px-5 py-3">Servicio</th><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Vuelo</th><th className="px-5 py-3">Aprobado</th><th className="px-5 py-3 text-right">Importe</th></tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {data.approvedServices.map(service => <tr key={service.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"><td className="px-5 py-4"><span className="block font-semibold text-ink-900 dark:text-text-primary-dark">{service.service}</span><span className="font-mono text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{service.id}</span></td><td className="px-5 py-4">{service.airline}</td><td className="px-5 py-4 font-semibold">{service.flight}</td><td className="px-5 py-4 text-text-secondary-light dark:text-text-secondary-dark">{formatDateTime(service.approvedAt)}</td><td className="px-5 py-4 text-right font-semibold tabular-nums">{formatMoney(service.amount, service.currency)}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : <p className="p-6 text-sm text-text-secondary-light dark:text-text-secondary-dark">No hay servicios aprobados.</p>}
        </SectionCard>

        <SectionCard title="Acciones pendientes" actionLabel="Ver pre-facturación" onAction={() => onNavigate('finance-preinvoices')}>
          {isLoading ? <div data-testid="actions-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" /> : data?.pendingActions?.length ? (
            <ul className="divide-y divide-black/5 dark:divide-white/5">
              {data.pendingActions.map(action => <li key={action.id}><button type="button" onClick={() => onNavigate(action.moduleId)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-accent-600">{action.kind === 'Conciliación' ? <ReconciliationIcon className="h-4 w-4" /> : <PreInvoiceIcon className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{action.airline}</span><span className="block text-xs text-text-secondary-light dark:text-text-secondary-dark">{action.kind} · {action.detail}</span></span><span className="font-mono text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{action.id}</span></button></li>)}
            </ul>
          ) : <p className="p-6 text-sm text-text-secondary-light dark:text-text-secondary-dark">No hay acciones financieras pendientes.</p>}
        </SectionCard>
      </div>
    </div>
  );
}
