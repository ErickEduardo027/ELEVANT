import { useCountUp } from '../useCountUp';

export default function KpiCard({ label, value, icon: IconComponent, tone = 'default', loading = false, visual }) {
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0);

  if (loading) {
    return (
      <div
        data-testid="kpi-skeleton"
        className="h-28 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:bg-surface-dark-card"
      />
    );
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
          {label}
        </span>
        <IconComponent className="h-4 w-4 text-accent-600" />
      </div>
      <div className="mt-3">
        {visual ?? (
          <span
            className={`font-sans text-3xl font-semibold tabular-nums ${
              tone === 'signal' ? 'text-signal-500' : 'text-ink-900 dark:text-text-primary-dark'
            }`}
          >
            {animatedValue}
          </span>
        )}
      </div>
    </div>
  );
}
