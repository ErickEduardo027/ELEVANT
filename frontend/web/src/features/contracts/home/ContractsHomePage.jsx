import KpiCard from '../../../components/KpiCard';
import { ContractIcon, RequestIcon, ServiceIcon, AlertIcon, ArrowIcon } from '../components/icons';

const STATUS_META = {
  active: { label: 'Activo', classes: 'bg-status-success/10 text-status-success' },
  expiring: { label: 'Próximo a vencer', classes: 'bg-status-warning/15 text-amber-700 dark:text-status-warning' },
};

function formatDate(value) {
  return new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
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

export default function ContractsHomePage({ status, data, error, onRetry, onNavigate }) {
  const isLoading = status === 'loading';

  if (status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
        <p className="font-semibold text-status-danger">No se pudo cargar el resumen contractual.</p>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{error?.message ?? 'Intente nuevamente.'}</p>
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Departamento de Contratos</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Resumen contractual</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Seguimiento de contratos, vigencias, servicios pactados y solicitudes recibidas.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Contratos activos" value={data?.kpis?.activeContracts ?? 0} icon={ContractIcon} loading={isLoading} />
        <KpiCard label="Próximos a vencer" value={data?.kpis?.expiringSoon ?? 0} icon={AlertIcon} loading={isLoading} tone="signal" />
        <KpiCard label="Solicitudes pendientes" value={data?.kpis?.pendingRequests ?? 0} icon={RequestIcon} loading={isLoading} />
        <KpiCard label="Servicios pactados" value={data?.kpis?.agreedServices ?? 0} icon={ServiceIcon} loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <SectionCard title="Contratos recientes" actionLabel="Ver contratos" onAction={() => onNavigate('contracts-list')}>
          {isLoading ? (
            <div data-testid="contracts-table-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
          ) : data?.recentContracts?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-black/[0.025] text-xs uppercase tracking-wide text-text-secondary-light dark:bg-white/[0.025] dark:text-text-secondary-dark">
                  <tr><th className="px-5 py-3">Contrato</th><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Vigencia</th><th className="px-5 py-3">Servicios</th><th className="px-5 py-3">Estado</th></tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {data.recentContracts.map(contract => {
                    const meta = STATUS_META[contract.status] ?? STATUS_META.active;
                    return <tr key={contract.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"><td className="px-5 py-4 font-mono text-xs font-semibold text-ink-900 dark:text-text-primary-dark">{contract.id}</td><td className="px-5 py-4 font-medium">{contract.airline}</td><td className="px-5 py-4 text-text-secondary-light dark:text-text-secondary-dark">{formatDate(contract.validUntil)}</td><td className="px-5 py-4 tabular-nums">{contract.servicesCount}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.classes}`}>{meta.label}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="p-6 text-sm text-text-secondary-light dark:text-text-secondary-dark">No hay contratos registrados.</p>}
        </SectionCard>

        <SectionCard title="Solicitudes por atender" actionLabel="Ver solicitudes" onAction={() => onNavigate('contracts-requests')}>
          {isLoading ? (
            <div data-testid="requests-skeleton" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
          ) : data?.pendingRequests?.length ? (
            <ul className="divide-y divide-black/5 dark:divide-white/5">
              {data.pendingRequests.map(request => <li key={request.id} className="flex items-center gap-3 px-5 py-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-accent-600"><RequestIcon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{request.airline}</span><span className="block text-xs text-text-secondary-light dark:text-text-secondary-dark">{request.kind} · {formatDateTime(request.receivedAt)}</span></span><span className="font-mono text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{request.id}</span></li>)}
            </ul>
          ) : <p className="p-6 text-sm text-text-secondary-light dark:text-text-secondary-dark">No hay solicitudes pendientes.</p>}
        </SectionCard>
      </div>
    </div>
  );
}
