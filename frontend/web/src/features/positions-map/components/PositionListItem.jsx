import StatusBadge from '../../dashboard/components/StatusBadge';
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';

export default function PositionListItem({ position, selected, onSelect }) {
  const meta = getStatusMeta('position', position.status);
  const accentColor = STATUS_COLORS[meta.color];

  return (
    <div
      data-testid="position-list-item"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(position.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(position.id);
      }}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className={`cursor-pointer rounded-xl border bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:bg-surface-dark-card ${
        selected ? 'border-signal-500 ring-1 ring-signal-500' : 'border-black/5 dark:border-white/5'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{position.id}</span>
        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {position.terminal === 'FBO' ? 'FBO' : `Terminal ${position.terminal}`}
        </span>
        <span className="ml-auto">
          <StatusBadge domain="position" status={position.status} />
        </span>
      </div>
      <div className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {position.flightNumber ? `${position.flightNumber} · ${position.airline}` : 'Sin vuelo asignado'}
      </div>
    </div>
  );
}
