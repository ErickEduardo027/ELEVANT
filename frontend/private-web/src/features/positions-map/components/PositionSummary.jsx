import { computePositionsSummary } from '../positionsMapMappers';
import { POSITION_STATUS_META, STATUS_COLORS } from '../../dashboard/statusMeta';

const ROWS = [
  { key: 'available', label: POSITION_STATUS_META.available.label },
  { key: 'occupied', label: POSITION_STATUS_META.occupied.label },
  { key: 'disabled', label: POSITION_STATUS_META.disabled.label },
  { key: 'releasing', label: POSITION_STATUS_META.releasing.label },
];

export default function PositionSummary({ positions }) {
  const summary = computePositionsSummary(positions);

  return (
    <div className="absolute bottom-4 right-4 z-10 w-48 rounded-xl border border-black/10 bg-white/90 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
      <p className="font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">Posiciones</p>
      <p className="mt-1 font-mono text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{summary.total}</p>
      <ul className="mt-2 space-y-1">
        {ROWS.map(row => (
          <li key={row.key} className="flex items-center justify-between text-text-secondary-light dark:text-text-secondary-dark">
            <span className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[POSITION_STATUS_META[row.key].color] }}
                aria-hidden="true"
              />
              {row.label}
            </span>
            <span className="font-mono font-medium text-ink-900 dark:text-text-primary-dark">{summary[row.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
