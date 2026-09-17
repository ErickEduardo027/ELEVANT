import { useNavigate } from 'react-router-dom';
import { getActivityMeta } from '../statusMeta';
import { formatEventDateTime } from '../mappers';
import { TONE_HEX } from '../../../../components/toneColors';

function SkeletonRows() {
  return (
    <div data-testid="activity-skeleton" className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      ))}
    </div>
  );
}

export default function AuditActivityFeed({ activity, loading = false, actionsEnabled = true }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Actividad reciente</h2>
        {actionsEnabled && (
          <button
            type="button"
            onClick={() => navigate('/gestion-humana/audit')}
            className="text-xs font-medium text-accent-600 hover:underline"
          >
            Ver historial completo
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : (
        <ul className="space-y-3">
          {activity.slice(0, 6).map(event => {
            const meta = getActivityMeta(event.type);
            const Icon = meta.icon;
            return (
              <li key={event.id} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/5"
                  style={{ color: TONE_HEX[meta.tone] }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-900 dark:text-text-primary-dark">{event.description}</p>
                  <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {event.responsible} · {formatEventDateTime(event.occurredAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
