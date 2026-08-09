import { useNavigate } from 'react-router-dom';
import DashboardListRow from './DashboardListRow';
import { UsersIcon } from '../../../shell/components/icons';
import { formatRelativeDaysAgo } from '../mappers';
import { TONE_HEX } from '../../../../components/toneColors';

function SkeletonRows() {
  return (
    <div data-testid="pending-accounts-skeleton" className="space-y-2">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      ))}
    </div>
  );
}

export default function PendingAccountsList({ accounts, loading = false }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Cuentas pendientes de activar</h2>
        <button
          type="button"
          onClick={() => navigate('/human-resources/users')}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Gestionar cuentas
        </button>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <UsersIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
          <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
            No hay cuentas pendientes de activación
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(account => (
            <DashboardListRow
              key={account.id}
              accentColor={TONE_HEX.info}
              title={account.name}
              subtitle={account.role}
              meta={formatRelativeDaysAgo(account.registeredAt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
