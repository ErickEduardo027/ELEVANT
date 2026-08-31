import { useEffect } from 'react';
import { XIcon } from './icons';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';

function Section({ title, children }) {
  return (
    <div className="space-y-1 border-b border-black/5 pb-3 dark:border-white/5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        {title}
      </h3>
      <div className="text-sm text-ink-900 dark:text-text-primary-dark">{children}</div>
    </div>
  );
}

function ListOrEmpty({ items, emptyLabel }) {
  if (!items || items.length === 0) {
    return <span className="text-text-secondary-light dark:text-text-secondary-dark">{emptyLabel}</span>;
  }
  return <span>{items.join(', ')}</span>;
}

const DISABLED_ACTIONS = ['Editar planificación', 'Crear Work Order'];

export default function PlanningDrawer({ flight, onClose, onAssign }) {
  useEffect(() => {
    if (!flight) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [flight, onClose]);

  if (!flight) return null;

  const meta = getStatusMeta('flight', flight.status);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
      />
      <aside
        data-testid="planning-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-drawer-title"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-black/5 bg-white/95 p-5 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p id="planning-drawer-title" className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
              {flight.flightNumber} · {flight.airlineName}
            </p>
            <StatusBadge tone={meta.color} label={meta.label} />
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

        <div className="space-y-3">
          <Section title="Información general">
            <p>
              {flight.origin} → {flight.destination}
            </p>
            <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Programado: {formatClockTime(flight.scheduledTime)} · Estimado: {formatClockTime(flight.estimatedTime)}
            </p>
          </Section>

          <Section title="Aeronave">
            {flight.aircraftType || (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin información de aeronave</span>
            )}
          </Section>

          <Section title="Tripulación">
            <ListOrEmpty items={flight.supervisor ? [flight.supervisor] : []} emptyLabel="Sin supervisor asignado" />
          </Section>

          <Section title="Posición asignada">
            {flight.position ?? (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin posición asignada</span>
            )}
          </Section>

          <Section title="Agentes">
            <ListOrEmpty items={flight.agents} emptyLabel="Sin agentes asignados" />
          </Section>

          <Section title="Equipos">
            <ListOrEmpty items={flight.teams} emptyLabel="Sin equipos asignados" />
          </Section>

          <Section title="Servicios">
            <ListOrEmpty items={flight.services} emptyLabel="Sin servicios registrados" />
          </Section>

          <Section title="Observaciones">
            {flight.observations || (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin observaciones</span>
            )}
          </Section>

          <Section title="Historial">
            {flight.history.length === 0 ? (
              <span className="text-text-secondary-light dark:text-text-secondary-dark">Sin eventos registrados</span>
            ) : (
              <ul className="space-y-1">
                {flight.history.map(entry => (
                  <li key={entry.at} className="text-xs">
                    <span className="font-mono text-text-secondary-light dark:text-text-secondary-dark">
                      {formatClockTime(entry.at)}
                    </span>{' '}
                    {entry.note}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => onAssign?.(flight)} className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white">Asignar recursos</button>
          {DISABLED_ACTIONS.map(label => (
            <button
              key={label}
              type="button"
              disabled
              title="Próximamente"
              className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
            >
              {label}
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
