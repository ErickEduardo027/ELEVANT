import { useNavigate } from 'react-router-dom';
import ExpirationListItem from './ExpirationListItem';
import { ShieldCheckIcon } from '../../../shell/components/icons';

function SkeletonRows() {
  return (
    <div data-testid="expirations-skeleton" className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      ))}
    </div>
  );
}

export default function ExpirationList({ expirations, loading = false, actionsEnabled = true }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Vencimientos próximos</h2>
        {actionsEnabled && (
          <button
            type="button"
            onClick={() => navigate('/gestion-humana/certifications')}
            className="text-xs font-medium text-accent-600 hover:underline"
          >
            Ver todos
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : expirations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ShieldCheckIcon className="h-6 w-6 text-status-success" />
          <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
            No hay vencimientos pendientes
          </p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Todas las habilitaciones, certificaciones y carnets están vigentes.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {expirations.slice(0, 6).map(expiration => (
            <ExpirationListItem key={expiration.id} expiration={expiration} actionsEnabled={actionsEnabled} />
          ))}
        </div>
      )}
    </div>
  );
}
