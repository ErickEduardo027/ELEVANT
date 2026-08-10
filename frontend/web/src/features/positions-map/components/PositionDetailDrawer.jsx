import { useEffect } from 'react';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { XIcon } from '../../flight-monitoring/components/icons';
import { TERMINAL_LABELS } from '../positionsMapMappers';
import CombinedPositionBanner from './CombinedPositionBanner';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-text-secondary-light dark:text-text-secondary-dark">{label}</dt>
      <dd className="font-mono text-ink-900 dark:text-text-primary-dark">{children}</dd>
    </div>
  );
}

export default function PositionDetailDrawer({ position, onClose, onViewFlightInMonitoring }) {
  useEffect(() => {
    if (!position) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [position, onClose]);

  if (!position) return null;

  const hasFlight = Boolean(position.flightId);
  const meta = getStatusMeta('position', position.status);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200" onClick={onClose} />
      <aside
        data-testid="position-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-drawer-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-black/5 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card lg:w-[420px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div className="space-y-1.5">
            <p id="position-drawer-title" className="font-mono text-base font-semibold text-ink-900 dark:text-text-primary-dark">
              {position.id}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={meta.color} label={meta.label} />
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {TERMINAL_LABELS[position.terminal] ?? position.terminal}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <CombinedPositionBanner position={position} />

          {hasFlight ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
              <Field label="Vuelo">{position.flightNumber}</Field>
              <Field label="Aerolínea">{position.airline}</Field>
              <Field label="Matrícula">{position.aircraftRegistration}</Field>
              <Field label="Tipo de aeronave">{position.aircraftType}</Field>
              <Field label="Agente">{position.assignedAgent ?? 'Sin asignar'}</Field>
              <Field label="Hora estimada de liberación">
                {position.estimatedReleaseTime ? formatClockTime(position.estimatedReleaseTime) : '—'}
              </Field>
            </dl>
          ) : (
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Sin vuelo asignado</p>
          )}

          <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Última actualización: {position.updatedAt ? formatClockTime(position.updatedAt) : '—'}
          </p>
        </div>

        {hasFlight && (
          <div className="border-t border-black/5 px-5 py-3 dark:border-white/5">
            <button
              type="button"
              onClick={() => onViewFlightInMonitoring(position.flightId)}
              className="w-full rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white hover:bg-accent-600/90"
            >
              Ver vuelo en Monitoreo
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
