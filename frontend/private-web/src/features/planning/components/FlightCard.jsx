import StatusBadge from '../../../components/StatusBadge';
import { STATUS_COLORS } from '../../dashboard/statusMeta';
import { UsersIcon } from '../../dashboard/components/icons';
import { PencilIcon, EyeIcon, ClipboardIcon } from './icons';
import { formatCountdown } from '../planningMappers';
import { getPlanningStatusMeta } from '../planningStatus';
import { formatPlanningClock } from '../planningTime';
import AssignmentSummary from './AssignmentSummary';

const QUICK_ACTIONS = [
  { id: 'edit', label: 'Editar', icon: PencilIcon, enabled: false },
  { id: 'assign', label: 'Asignar recursos', icon: UsersIcon, enabled: false },
  { id: 'detail', label: 'Ver detalle', icon: EyeIcon, enabled: true },
  { id: 'workOrder', label: 'Crear Work Order', icon: ClipboardIcon, enabled: false },
];

function LegSummary({ kind, leg, timeZone }) {
  const isArrival = kind === 'arrival';
  const label = isArrival ? 'Llegada' : 'Salida';

  if (!leg) {
    return (
      <div className="rounded-lg border border-dashed border-black/10 px-3 py-2 dark:border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
        <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Sin tramo registrado</p>
      </div>
    );
  }

  const route = `${leg.origin.iataCode} → ${leg.destination.iataCode}`;
  const scheduled = formatPlanningClock(leg.scheduledAt, timeZone);
  const estimated = formatPlanningClock(leg.estimatedAt, timeZone);
  const actual = formatPlanningClock(leg.actualAt, timeZone);

  return (
    <div className="rounded-lg border border-black/5 bg-white/55 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
        <span className="font-mono text-xs font-semibold text-ink-900 dark:text-text-primary-dark">{leg.flightNumber}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{route}</span>
        <span className="font-mono text-sm text-accent-600">{actual !== '—' ? actual : estimated !== '—' ? estimated : scheduled}</span>
      </div>
      {(estimated !== '—' || actual !== '—') && (
        <p className="mt-1 text-right font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
          Programado {scheduled}
        </p>
      )}
    </div>
  );
}

export default function FlightCard({ flight, now, onSelect }) {
  const meta = getPlanningStatusMeta(flight.status);
  const accentColor = STATUS_COLORS[meta.color];
  const timeZone = flight.station?.ianaTimeZone;

  return (
    <article
      data-testid="flight-card"
      onClick={() => onSelect(flight.id)}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="cursor-pointer rounded-xl border border-black/5 bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={meta.color} label={meta.label} />
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{flight.operationCode}</span>
        <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {flight.airlineIata} · {flight.airlineName}
        </span>
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {flight.aircraftType ?? 'Aeronave sin definir'}
        </span>
        <span className="ml-auto font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {formatCountdown(flight.timelineTime, now)}
        </span>
        <div className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
          {QUICK_ACTIONS.map(({ id, label, icon: ActionIcon, enabled }) => (
            <button
              key={id}
              type="button"
              title={enabled ? label : 'Próximamente'}
              aria-label={label}
              disabled={!enabled}
              onClick={() => enabled && onSelect(flight.id)}
              className={`rounded-md p-1.5 transition ${enabled
                ? 'text-text-secondary-light hover:bg-black/5 hover:text-accent-600 dark:text-text-secondary-dark dark:hover:bg-white/5'
                : 'cursor-not-allowed text-text-secondary-light/35 dark:text-text-secondary-dark/35'}`}
            >
              <ActionIcon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
        <LegSummary kind="arrival" leg={flight.arrival} timeZone={timeZone} />
        <div className="flex min-w-[130px] flex-col items-center justify-center rounded-lg bg-ink-900/[0.035] px-3 py-2 text-center dark:bg-white/[0.04]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">Escala</span>
          <span className="mt-1 font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{flight.position ?? 'Sin posición'}</span>
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">{flight.terminalCode ? `Terminal ${flight.terminalCode}` : 'Sin terminal'}</span>
        </div>
        <LegSummary kind="departure" leg={flight.departure} timeZone={timeZone} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/5 pt-2 dark:border-white/5">
        <AssignmentSummary
          position={flight.position}
          agents={flight.assignedAgents ?? []}
          equipment={flight.assignedEquipment ?? []}
          services={flight.assignedServices ?? []}
        />
        {flight.hasAssignmentGap && (
          <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-[10px] font-semibold text-status-warning">Requiere recursos</span>
        )}
      </div>
    </article>
  );
}
