import KpiCard from './components/KpiCard';
import ProgressRing from './components/ProgressRing';
import FlyAwareStatusPanel from './components/FlyAwareStatusPanel';
import FlightStatusChart from './components/FlightStatusChart';
import ApprovalPreviewList from './components/ApprovalPreviewList';
import AlertsFeed from './components/AlertsFeed';
import PositionsMapPreview from './components/PositionsMapPreview';
import { PlaneIcon, ChecklistIcon, UsersIcon } from './components/icons';

export default function DashboardPage({ status, data, error, onRetry, forceState = 'default' }) {
  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = status === 'error' && forceState === 'default';

  const approvals = forceState === 'emptyApprovals' ? [] : data?.pendingApprovals ?? [];
  const flyAware =
    forceState === 'flyAwareError'
      ? { status: 'error', lastSyncMinutesAgo: data?.flyAware?.lastSyncMinutesAgo ?? 0 }
      : data?.flyAware ?? { status: 'online', lastSyncMinutesAgo: 0 };

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">
          No se pudo cargar el panorama operativo de la estación.
        </p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Vuelos programados hoy" value={data?.kpis?.flightsToday ?? 0} icon={PlaneIcon} loading={isLoading} />
        <KpiCard
          label="Servicios: pendientes vs. ejecutados"
          icon={ChecklistIcon}
          loading={isLoading}
          visual={
            <div className="flex items-center gap-3">
              <ProgressRing
                pending={data?.kpis?.servicesPending ?? 0}
                executed={data?.kpis?.servicesExecuted ?? 0}
                size={56}
                strokeWidth={6}
              />
              <div className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <div>{data?.kpis?.servicesExecuted ?? 0} ejecutados</div>
                <div>{data?.kpis?.servicesPending ?? 0} pendientes</div>
              </div>
            </div>
          }
        />
        <KpiCard
          label="Agentes en operaciones activas"
          value={data?.kpis?.agentsActive ?? 0}
          icon={UsersIcon}
          loading={isLoading}
        />
        <KpiCard
          label="Aprobaciones pendientes"
          value={data?.kpis?.approvalsPending ?? 0}
          icon={ChecklistIcon}
          loading={isLoading}
          tone={(data?.kpis?.approvalsPending ?? 0) > 0 ? 'signal' : 'default'}
        />
      </div>

      <FlyAwareStatusPanel status={flyAware.status} lastSyncMinutesAgo={flyAware.lastSyncMinutesAgo} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <FlightStatusChart distribution={data?.flightStatusDistribution ?? []} />
          <PositionsMapPreview onOpenMap={() => {}} />
        </div>
        <div className="space-y-4">
          <ApprovalPreviewList approvals={approvals} onViewAll={() => {}} loading={isLoading} />
          <AlertsFeed alerts={data?.alerts ?? []} loading={isLoading} />
        </div>
      </div>
    </div>
  );
}
