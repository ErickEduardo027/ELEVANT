import FlightStripCard from './FlightStripCard';
import StatusBadge from '../../../components/StatusBadge';
import { ChecklistIcon } from './icons';
import { mapApprovalToStrip } from '../mappers';
import { getStatusMeta } from '../statusMeta';

function SkeletonRows() {
  return (
    <div data-testid="approvals-skeleton" className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          data-testid="strip-skeleton-row"
          className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5"
        />
      ))}
    </div>
  );
}

export default function ApprovalPreviewList({ approvals, onViewAll, loading = false }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          Aprobaciones pendientes
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Ver todas
        </button>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : approvals.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
          <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
            No hay operaciones pendientes de revisión
          </p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Las nuevas solicitudes aparecerán aquí en cuanto se registren.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {approvals.slice(0, 5).map(approval => {
            const strip = mapApprovalToStrip(approval);
            const statusMeta = getStatusMeta('service', strip.status);
            return (
              <FlightStripCard
                key={strip.key}
                accentColor={strip.accentColor}
                primary={strip.primary}
                secondary={strip.secondary}
                meta={strip.meta}
                badge={<StatusBadge tone={statusMeta.color} label={statusMeta.label} />}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
