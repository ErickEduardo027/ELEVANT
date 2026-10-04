import { useRouter } from 'next/navigation';
import DashboardListRow from './DashboardListRow';
import { UsersIcon } from '../../../shell/components/icons';
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

export default function PendingAccountsList({ accounts, loading = false, actionsEnabled = true }) {
  const router = useRouter();

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Perfiles sin cuenta vinculada</h2>
        {actionsEnabled && (
          <button
            type="button"
            onClick={() => router.push('/gestion-humana/users')}
            className="text-xs font-medium text-accent-600 hover:underline"
          >
            Gestionar perfiles
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <UsersIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
          <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
            Todos los perfiles activos tienen cuenta vinculada
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
