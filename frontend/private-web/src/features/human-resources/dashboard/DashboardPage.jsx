import { useNavigate } from 'react-router-dom';
import KpiCard from '../../../components/KpiCard';
import { UsersIcon, RefreshCwIcon } from '../../shell/components/icons';
import { useHumanResourcesDashboardData } from './useHumanResourcesDashboardData';
import PendingAccountsList from './components/PendingAccountsList';

function formatToday() {
  return new Date().toLocaleDateString('es-DO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatUpdatedAt(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('es-DO', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { status, data, lastUpdatedAt, refresh } = useHumanResourcesDashboardData();
  const isLoading = status === 'loading';

  if (status === 'error') {
    return <div className="mx-auto max-w-[1440px] rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card" role="alert">
      <p className="text-sm font-semibold text-status-danger">No fue posible cargar el resumen.</p>
      <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Verifique la conexión e intente nuevamente.</p>
      <button type="button" onClick={refresh} className="mt-3 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white">
        Reintentar
      </button>
    </div>;
  }

  const pendingAccounts = data?.pendingAccounts ?? [];
  return <div className="mx-auto max-w-[1440px] space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div>
        <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Dashboard</h1>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Perfiles operativos registrados en ELEVANT</p>
      </div>
      <div className="flex items-center gap-4 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <span className="capitalize">{formatToday()}</span>
        <span>Actualizado: {formatUpdatedAt(lastUpdatedAt)}</span>
        <button type="button" onClick={refresh} aria-label="Actualizar resumen" className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5">
          <RefreshCwIcon className="h-3.5 w-3.5" /> Actualizar
        </button>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <KpiCard label="Agentes de rampa activos" value={data?.activeStaffTotal} icon={UsersIcon} loading={isLoading} subtext="Perfiles operativos activos" />
      <KpiCard label="Perfiles sin cuenta vinculada" value={pendingAccounts.length} icon={UsersIcon} tone={pendingAccounts.length ? 'signal' : 'default'} loading={isLoading} action={{ label: 'Revisar perfiles', onClick: () => navigate('/gestion-humana/users') }} />
    </div>
    <PendingAccountsList accounts={pendingAccounts} loading={isLoading} />
  </div>;
}
