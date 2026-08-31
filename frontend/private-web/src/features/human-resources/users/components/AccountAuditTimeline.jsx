import EmptyState from '../../../../components/EmptyState';
import { TONE_HEX } from '../../../../components/toneColors';
import { ChecklistIcon } from '../../../shell/components/icons';
import { getHistoryActionMeta } from '../statusMeta';
import { formatEventDateTime } from '../mappers';

function SkeletonRows() {
  return (
    <div data-testid="audit-timeline-skeleton" className="space-y-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      ))}
    </div>
  );
}

// Generaliza ReviewHistoryLog (feat/adminocc) para el dominio "cuenta":
// cada mutación del servicio (activar, desactivar, reenviar invitación,
// etc.) agrega un evento aquí — ver appendHistory en
// humanResourcesUsersService.js.
export default function AccountAuditTimeline({ events, loading = false }) {
  if (loading) return <SkeletonRows />;

  if (!events.length) {
    return (
      <EmptyState
        icon={ChecklistIcon}
        title="Sin eventos registrados"
        description="Las acciones sobre esta cuenta aparecerán aquí."
      />
    );
  }

  return (
    <ol className="space-y-3">
      {events.map(event => {
        const meta = getHistoryActionMeta(event.action);
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
              <p className="text-sm text-ink-900 dark:text-text-primary-dark">{meta.label}</p>
              <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {event.actorName} · {formatEventDateTime(event.occurredAt)}
                {event.detail ? ` · ${event.detail}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
