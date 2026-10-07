import KpiCard from '../../../components/KpiCard';
import { AlertIcon, ApprovedServicesIcon, ArrowIcon,
  PreInvoiceIcon, ReconciliationIcon } from '../components/icons';

function formatOperationDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || !currency) return '—';
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount);
}

function SectionCard({ title, actionLabel, onAction, children }) {
  return <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
    <header className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/5">
      <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
      <button type="button" onClick={onAction} className="flex items-center gap-1 text-xs font-semibold text-accent-600">
        {actionLabel}<ArrowIcon className="h-3.5 w-3.5" />
      </button>
    </header>
    {children}
  </section>;
}

export default function FinanceHomePage({ status, data, onRetry, onNavigate,
  stations = [], stationId = '', onStationChange }) {
  const isLoading = status === 'loading';

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Departamento de Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Resumen financiero</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Servicios aprobados de los últimos 30 días y prefacturas de la estación autorizada.
        </p>
      </div>
      {stations.length > 0 && <label className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark">
        Estación financiera
        <select aria-label="Estación financiera" value={stationId}
          onChange={event => onStationChange(event.target.value)}
          className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink-900 dark:bg-surface-dark-card dark:text-text-primary-dark">
          {stations.map(station => <option key={station.stationId} value={station.stationId}>{station.stationCode}</option>)}
        </select>
      </label>}
    </header>

    {(status === 'error' || status === 'forbidden') && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{status === 'forbidden'
        ? 'No hay una estación financiera autorizada para esta consulta.'
        : 'No se pudo cargar el resumen financiero.'}</p>
      <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
        {status === 'forbidden' ? 'Comprueba tus permisos vigentes con Superadministración.'
          : 'Verifique la conexión e intente nuevamente.'}
      </p>
      {status === 'error' && <button type="button" onClick={onRetry}
        className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {(isLoading || status === 'success') && <>
      {(data?.bounds?.servicesHaveMore || data?.bounds?.preinvoicesHaveMore) &&
        <p role="status" className="rounded-xl border border-accent-600/20 bg-accent-600/5 px-4 py-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {data.bounds.servicesHaveMore && 'Esta consulta muestra hasta 200 servicios; acota fechas en Servicios aprobados si hay más. '}
          {data.bounds.preinvoicesHaveMore && 'Esta consulta muestra hasta 50 prefacturas; abre Pre-facturación para consultar las demás.'}
        </p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Servicios en consulta" value={data?.kpis.approvedServices} icon={ApprovedServicesIcon} loading={isLoading} />
        <KpiCard label="Listos para prefacturar" value={data?.kpis.readyForPreinvoice} icon={AlertIcon} loading={isLoading} />
        <KpiCard label="Borradores en consulta" value={data?.kpis.draftPreinvoices} icon={PreInvoiceIcon} loading={isLoading} />
        <KpiCard label="Disputas en consulta" value={data?.kpis.disputedPreinvoices} icon={ReconciliationIcon} loading={isLoading} tone="signal" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard title="Servicios aprobados recientes" actionLabel="Ver servicios"
          onAction={() => onNavigate('finance-approved-services')}>
          {isLoading ? <div data-testid="services-table-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
            : data.approvedServices.length ? <div className="overflow-x-auto"><table className="table-stack w-full text-left text-sm">
              <thead className="bg-black/[0.025] text-xs uppercase tracking-wide text-text-secondary-light dark:bg-white/[0.025] dark:text-text-secondary-dark">
                <tr><th className="px-5 py-3">Servicio</th><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Vuelo</th><th className="px-5 py-3">Operación</th><th className="px-5 py-3 text-right">Importe</th></tr>
              </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
                {data.approvedServices.map(service => <tr key={service.id}>
                  <td className="px-5 py-4"><span className="block font-semibold">{service.service}</span><span className="font-mono text-[11px] text-text-secondary-light">{service.id}</span></td>
                  <td className="px-5 py-4">{service.airline}</td>
                  <td className="px-5 py-4 font-semibold">{service.flight}</td>
                  <td className="px-5 py-4 text-text-secondary-light">{formatOperationDate(service.operationDate)}</td>
                  <td className="px-5 py-4 text-right font-semibold tabular-nums">{formatMoney(service.amount, service.currency)}</td>
                </tr>)}
              </tbody>
            </table></div> : <p className="p-6 text-sm text-text-secondary-light">No hay servicios aprobados en este período.</p>}
        </SectionCard>
        <SectionCard title="Acciones pendientes en consulta" actionLabel="Ver pre-facturación"
          onAction={() => onNavigate('finance-preinvoices')}>
          {isLoading ? <div data-testid="actions-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
            : data.pendingActions.length ? <ul className="divide-y divide-black/5 dark:divide-white/5">
              {data.pendingActions.map(action => <li key={action.id}><button type="button"
                onClick={() => onNavigate(action.moduleId)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{action.airline}</span>
                  <span className="block text-xs text-text-secondary-light">{action.kind} · {action.detail}</span></span>
                <span className="font-mono text-[11px] text-text-secondary-light">{action.id}</span>
              </button></li>)}
            </ul> : <p className="p-6 text-sm text-text-secondary-light">No hay acciones financieras pendientes en esta consulta.</p>}
        </SectionCard>
      </div>
    </>}
  </div>;
}
