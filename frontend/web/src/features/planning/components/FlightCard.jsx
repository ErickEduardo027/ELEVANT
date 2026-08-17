import StatusBadge from '../../../components/StatusBadge';
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { UsersIcon } from '../../dashboard/components/icons';
import { PencilIcon, EyeIcon, ClipboardIcon } from './icons';
import { formatCountdown } from '../planningMappers';
import ConflictIndicator from './ConflictIndicator';
import AssignmentSummary from './AssignmentSummary';

const QUICK_ACTIONS = [
  { id: 'edit', label: 'Editar', icon: PencilIcon },
  { id: 'assign', label: 'Asignar', icon: UsersIcon },
  { id: 'detail', label: 'Ver detalle', icon: EyeIcon },
  { id: 'workOrder', label: 'Crear Work Order', icon: ClipboardIcon },
];

export default function FlightCard({ flight, now, onSelect }) {
  const meta = getStatusMeta('flight', flight.status);
  const accentColor = STATUS_COLORS[meta.color];

  return (
    <div
      data-testid="flight-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(flight.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(flight.id);
        }
      }}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="cursor-pointer rounded-xl border border-black/5 bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={meta.color} label={meta.label} />
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {formatClockTime(flight.scheduledTime)}
        </span>
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {flight.flightNumber} · {flight.airlineName}
        </span>
        <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {flight.origin} → {flight.destination}
        </span>
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {flight.aircraftType}
        </span>
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {flight.position ?? 'Sin posición'}
        </span>
        <span className="ml-auto font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {formatCountdown(flight.scheduledTime, now)}
        </span>
        <div className="flex items-center gap-1">
          {QUICK_ACTIONS.map(({ id, label, icon: ActionIcon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              onClick={event => {
                event.stopPropagation();
                onSelect(flight.id);
              }}
              className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 hover:text-accent-600 dark:text-text-secondary-dark dark:hover:bg-white/5"
            >
              <ActionIcon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 hidden items-center justify-between gap-3 lg:flex">
        <AssignmentSummary
          position={flight.position}
          supervisor={flight.supervisor}
          agents={flight.agents}
          teams={flight.teams}
        />
        <ConflictIndicator conflict={flight.conflict} />
      </div>
    </div>
  );
}
