export default function FlightStripCard({ accentColor, primary, secondary, meta, badge }) {
  return (
    <div
      data-testid="flight-strip"
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="flex items-center gap-3 rounded-lg border border-black/5 bg-white/70 px-3 py-2.5 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {primary}
        </div>
        {secondary && (
          <div className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {secondary}
          </div>
        )}
      </div>
      {badge}
      {meta && (
        <div className="shrink-0 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {meta}
        </div>
      )}
    </div>
  );
}
