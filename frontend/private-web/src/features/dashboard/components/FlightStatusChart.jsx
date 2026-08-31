import { STATUS_COLORS, getStatusMeta } from '../statusMeta';

const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function FlightStatusChart({ distribution }) {
  const total = distribution.reduce((sum, entry) => sum + entry.count, 0);
  let cumulative = 0;

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-4 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        Distribución de vuelos por estado
      </h2>
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} className="-rotate-90">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              className="fill-none stroke-black/5 dark:stroke-white/5"
            />
            {distribution.map(entry => {
              const meta = getStatusMeta('flight', entry.status);
              const fraction = total === 0 ? 0 : entry.count / total;
              const dash = fraction * CIRCUMFERENCE;
              const dashArray = `${dash} ${CIRCUMFERENCE - dash}`;
              const dashOffset = -cumulative;
              cumulative += dash;
              return (
                <circle
                  key={entry.status}
                  data-testid="donut-segment"
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  strokeWidth={STROKE}
                  strokeDasharray={dashArray}
                  strokeDashoffset={dashOffset}
                  className="fill-none"
                  stroke={STATUS_COLORS[meta.color]}
                />
              );
            })}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-semibold text-ink-900 dark:text-text-primary-dark">
            {total}
          </span>
        </div>

        <ul className="min-w-40 flex-1 space-y-1.5">
          {distribution.map(entry => {
            const meta = getStatusMeta('flight', entry.status);
            return (
              <li key={entry.status} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-ink-900 dark:text-text-primary-dark">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[meta.color] }}
                    aria-hidden="true"
                  />
                  {meta.label}
                </span>
                <span className="font-mono text-text-secondary-light dark:text-text-secondary-dark">
                  {entry.count}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
