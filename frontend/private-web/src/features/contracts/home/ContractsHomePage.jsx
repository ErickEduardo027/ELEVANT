import KpiCard from '../../../components/KpiCard';
import { ContractIcon, RequestIcon, ServiceIcon, ArrowIcon } from '../components/icons';

const statusLabels = {
  Pending: 'Pendiente', InReview: 'En revisión', Approved: 'Aprobada',
  Rejected: 'Rechazada', Cancelled: 'Cancelada',
};

function SectionCard({ title, actionLabel, onAction, children }) {
  return <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
    <header className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/5">
      <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
      <button type="button" onClick={onAction} className="flex items-center gap-1 text-xs font-semibold text-accent-600 hover:text-accent-600/80">
        {actionLabel}<ArrowIcon className="h-3.5 w-3.5" />
      </button>
    </header>
    {children}
  </section>;
}

export default function ContractsHomePage({ status, data, error, onRetry, onNavigate }) {
  if (status === 'error') return <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
    <p className="font-semibold text-status-danger">No se pudo cargar el resumen contractual.</p>
    <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{error?.message ?? 'Intente nuevamente.'}</p>
    <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
  </div>;

  const isLoading = status === 'loading';
  const kpis = data?.kpis;
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Departamento de Contratos</p>
      <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Resumen contractual</h1>
      <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Solicitudes comerciales, borradores y servicios publicados en Development.</p>
      <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">La API devuelve hasta 200 solicitudes recientes y 100 borradores; los indicadores reflejan ese alcance.</p>
      {status === 'refreshing' && <p role="status" className="mt-2 text-xs font-semibold text-accent-600">Actualizando datos…</p>}
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Solicitudes pendientes" value={kpis?.pendingRequests ?? 0} icon={RequestIcon} loading={isLoading} />
      <KpiCard label="Solicitudes aprobadas" value={kpis?.approvedRequests ?? 0} icon={RequestIcon} loading={isLoading} />
      <KpiCard label="Borradores por activar" value={kpis?.pendingDrafts ?? 0} icon={ContractIcon} loading={isLoading} />
      <KpiCard label="Servicios públicos activos" value={kpis?.publishedServices ?? 0} icon={ServiceIcon} loading={isLoading} />
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
      <SectionCard title="Solicitudes recientes" actionLabel="Ver solicitudes" onAction={() => onNavigate('contracts-requests')}>
        {isLoading ? <div data-testid="requests-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" /> :
          data?.recentRequests?.length ? <ul className="divide-y divide-black/5 dark:divide-white/5">{data.recentRequests.map(request =>
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm">
              <span><strong className="block">{request.airline}</strong><span className="font-mono text-xs text-text-secondary-light">{request.reference}</span></span>
              <span className="rounded-full bg-accent-600/10 px-2.5 py-1 text-xs font-semibold text-accent-600">{statusLabels[request.status] ?? request.status}</span>
            </li>)}</ul> : <p className="p-6 text-sm text-text-secondary-light">No hay solicitudes comerciales registradas.</p>}
      </SectionCard>
      <SectionCard title="Borradores por activar" actionLabel="Ver borradores" onAction={() => onNavigate('contracts-drafts')}>
        {isLoading ? <div data-testid="drafts-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" /> :
          data?.pendingDrafts?.length ? <ul className="divide-y divide-black/5 dark:divide-white/5">{data.pendingDrafts.map(draft =>
            <li key={draft.id} className="px-5 py-4 text-sm"><strong className="block">{draft.airline}</strong>
              <span className="font-mono text-xs text-text-secondary-light">{draft.contractCode}</span>
            </li>)}</ul> : <p className="p-6 text-sm text-text-secondary-light">No hay versiones pendientes de activar.</p>}
      </SectionCard>
    </div>
  </div>;
}
