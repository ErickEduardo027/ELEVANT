import ProgressRing from '../../../../components/ProgressRing';
import HorizontalBarList from '../../../../components/HorizontalBarList';

const BREAKDOWN_ITEMS = [
  { key: 'available', label: 'Disponible' },
  { key: 'onShift', label: 'En turno' },
  { key: 'absent', label: 'Ausente' },
  { key: 'unavailable', label: 'No disponible' },
  { key: 'unassigned', label: 'Sin asignación' },
];

function SkeletonBlock() {
  return <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />;
}

export default function PersonnelAvailability({ availability, loading = false }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-4 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Disponibilidad actual</h2>

      {loading ? (
        <SkeletonBlock />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <ProgressRing percent={availability.overallCoveragePercent} size={80} strokeWidth={9} />
            <div>
              <p className="font-mono text-lg font-semibold text-ink-900 dark:text-text-primary-dark">
                {availability.overallCoveragePercent}% de cobertura actual
              </p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Cobertura estimada sobre el personal activo total.
              </p>
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-1">
            {BREAKDOWN_ITEMS.map(item => (
              <li key={item.key} className="flex items-center justify-between gap-3">
                <span className="text-text-secondary-light dark:text-text-secondary-dark">{item.label}</span>
                <span className="font-mono font-medium text-ink-900 dark:text-text-primary-dark">
                  {availability.breakdown[item.key]}
                </span>
              </li>
            ))}
          </ul>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              Cobertura por terminal
            </h3>
            <HorizontalBarList
              max={100}
              items={availability.byTerminal.map(entry => ({
                key: entry.terminal,
                label: entry.terminal,
                value: entry.coveragePercent,
                displayValue: `${entry.coveragePercent}%`,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
