// Fila de lista compartida entre ExpirationList y PendingAccountsList
// (mismo trazo que FlightStripCard en feat/adminocc: borde de acento a la
// izquierda, título/subtítulo truncados, meta a la derecha).
export default function DashboardListRow({ accentColor, title, subtitle, meta, badge, action }) {
  return (
    <div
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="flex flex-col gap-2 rounded-lg border border-black/5 bg-white/70 px-3 py-2.5 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card sm:flex-row sm:items-center sm:gap-3"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{title}</div>
        {subtitle && (
          <div className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{subtitle}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {badge}
        {meta && (
          <div className="text-right font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {meta}
          </div>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-xs font-medium text-accent-600 hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
