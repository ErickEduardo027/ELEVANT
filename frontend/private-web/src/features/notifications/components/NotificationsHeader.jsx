import { SettingsIcon, CheckCheckIcon } from './icons';

function CountStat({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'critical'
      ? 'text-status-danger'
      : tone === 'warning'
        ? 'text-status-warning'
        : 'text-ink-900 dark:text-text-primary-dark';

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`text-sm font-semibold ${toneClass}`}>{value}</span>
      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</span>
    </span>
  );
}

export default function NotificationsHeader({ counts, onMarkAllAsRead, onOpenSettings }) {
  const hasUnread = (counts?.unread ?? 0) > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Notificaciones</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Historial y alertas operativas del sistema.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onMarkAllAsRead}
            disabled={!hasUnread}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
              hasUnread
                ? 'border-accent-600/30 text-accent-600 hover:bg-accent-600/10'
                : 'cursor-not-allowed border-black/10 text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60'
            }`}
          >
            <CheckCheckIcon className="h-3.5 w-3.5" />
            Marcar todas como leídas
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Preferencias de notificaciones"
            className="rounded-lg border border-black/10 p-2 text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:border-white/10 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-black/5 bg-white/60 px-4 py-2.5 dark:border-white/5 dark:bg-surface-dark-card">
        <CountStat label="Total" value={counts?.total ?? 0} />
        <CountStat label="No leídas" value={counts?.unread ?? 0} />
        <CountStat label="Críticas" value={counts?.critical ?? 0} tone="critical" />
        <CountStat label="Requieren atención" value={counts?.needsAttention ?? 0} tone="warning" />
      </div>
    </div>
  );
}
