import { useNavigate } from 'react-router-dom';
import KpiCard from '../../../components/KpiCard';
import { UsersIcon, ShieldCheckIcon, AlertTriangleIcon, RefreshCwIcon } from '../../shell/components/icons';
import { useHumanResourcesDashboardData } from './useHumanResourcesDashboardData';
import { mapExpirations, deriveExpirationKpis } from './mappers';
import ExpirationList from './components/ExpirationList';
import StaffDistributionChart from './components/StaffDistributionChart';
import PersonnelAvailability from './components/PersonnelAvailability';
import PendingAccountsList from './components/PendingAccountsList';
import AuditActivityFeed from './components/AuditActivityFeed';
import HRQuickActions from './components/HRQuickActions';

function formatToday() {
  return new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatUpdatedAt(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Composición del Dashboard de Gestión Humana. La Topbar y el Sidebar ya
// existen (AppShell); este componente solo aporta el contenido del área
// principal, siguiendo el mismo patrón de estados (loading/error) que
// DashboardPage en feat/adminocc.
export default function DashboardPage({ forceState = 'default' }) {
  const navigate = useNavigate();
  const { status, data, error, lastUpdatedAt, refresh } = useHumanResourcesDashboardData();

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' || forceState === 'error') && forceState !== 'loading';

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar el resumen.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const expirations = mapExpirations(forceState === 'allClear' ? [] : data?.expirations ?? []);
  const { expiringSoonCount, expiredCount } = deriveExpirationKpis(expirations);
  const pendingAccounts = data?.pendingAccounts ?? [];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Dashboard</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Resumen del personal y gestión humana
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          <span className="capitalize">{formatToday()}</span>
          <span>Actualizado: {formatUpdatedAt(lastUpdatedAt)}</span>
          <button
            type="button"
            onClick={refresh}
            aria-label="Actualizar resumen"
            className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Personal activo"
          value={data?.activeStaffTotal}
          icon={UsersIcon}
          loading={isLoading}
          subtext={
            data?.activeStaffByTerminal &&
            `A: ${data.activeStaffByTerminal.terminalA} · B: ${data.activeStaffByTerminal.terminalB} · FBO: ${data.activeStaffByTerminal.fbo}`
          }
        />
        <KpiCard
          label="Cuentas pendientes de activar"
          value={pendingAccounts.length}
          icon={UsersIcon}
          tone={pendingAccounts.length > 0 ? 'signal' : 'default'}
          loading={isLoading}
          action={{ label: 'Revisar cuentas', onClick: () => navigate('/gestion-humana/users') }}
        />
        <KpiCard
          label="Habilitaciones próximas a vencer"
          value={expiringSoonCount}
          icon={ShieldCheckIcon}
          tone="warning"
          loading={isLoading}
          action={{ label: 'Ver habilitaciones', onClick: () => navigate('/gestion-humana/certifications') }}
        />
        <KpiCard
          label="Habilitaciones y carnets vencidos"
          value={expiredCount}
          icon={AlertTriangleIcon}
          tone="danger"
          loading={isLoading}
          emphasize={expiredCount > 0}
          action={{ label: 'Revisar vencidos', onClick: () => navigate('/gestion-humana/certifications') }}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[3fr_2fr]">
        <ExpirationList expirations={expirations} loading={isLoading} />
        <div className="space-y-4">
          <StaffDistributionChart
            byTerminal={data?.activeStaffByTerminal}
            byShift={data?.staffByShift}
            loading={isLoading}
          />
          <PersonnelAvailability availability={data?.availability} loading={isLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PendingAccountsList accounts={pendingAccounts} loading={isLoading} />
        <AuditActivityFeed activity={data?.activity ?? []} loading={isLoading} />
      </div>

      <HRQuickActions />
    </div>
  );
}
