import StatusBadge from '../../../components/StatusBadge';
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';

export default function FlightListItem({ flight, selected, onSelect }) {
  const meta = getStatusMeta('flight', flight.status);
  const accentColor = STATUS_COLORS[meta.color];

  return (
    <div
      data-testid="flight-list-item"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(flight.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(flight.id);
      }}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className={`cursor-pointer rounded-xl border bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:bg-surface-dark-card ${
        selected ? 'border-signal-500 ring-1 ring-signal-500' : 'border-black/5 dark:border-white/5'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={meta.color} label={meta.label} />
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {flight.flightNumber}
        </span>
        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{flight.airline}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <span>
          {flight.origin} → {flight.destination}
        </span>
        <span className="font-mono">ETA {formatClockTime(flight.eta)}</span>
        <span className="font-mono">{flight.stand ?? 'Sin stand'}</span>
        {flight.supervisor && <span className="ml-auto">{flight.supervisor}</span>}
      </div>
    </div>
  );
}
