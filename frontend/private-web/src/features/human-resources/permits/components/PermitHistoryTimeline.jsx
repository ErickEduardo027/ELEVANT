import EmptyState from '../../../../components/EmptyState';
import { TONE_HEX } from '../../../../components/toneColors';
import { ChecklistIcon } from '../../../shell/components/icons';
import { getHistoryEventMeta, PERMIT_DOCUMENT_TYPE_META } from '../statusMeta';
import { formatEventDateTime } from '../mappers';

function SkeletonRows() {
  return (
    <div data-testid="permit-history-skeleton" className="space-y-2">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      ))}
    </div>
  );
}

// Generaliza QualificationHistoryTimeline para el dominio "carnets y
// permisos": historial combinado de ambos documentos (skill.md
// §"DETALLE": "historial de renovaciones"), etiquetado por tipo de
// documento para que no se confunda a cuál pertenece cada evento. Nunca se
// elimina historial al renovar.
export default function PermitHistoryTimeline({ events, loading = false }) {
  if (loading) return <SkeletonRows />;

  if (!events.length) {
    return (
      <EmptyState
        icon={ChecklistIcon}
        title="Sin eventos registrados"
        description="Las emisiones y renovaciones de este agente aparecerán aquí."
      />
    );
  }

  return (
    <ol className="space-y-3">
      {events.map(event => {
        const meta = getHistoryEventMeta(event.eventType);
        const Icon = meta.icon;
        const documentLabel = PERMIT_DOCUMENT_TYPE_META[event.documentType]?.label ?? event.documentType;
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
              <p className="text-sm text-ink-900 dark:text-text-primary-dark">
                <span className="font-medium">{documentLabel}</span> — {event.description}
              </p>
              <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {event.performedBy ? `${event.performedBy} · ` : ''}
                {formatEventDateTime(event.occurredAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
