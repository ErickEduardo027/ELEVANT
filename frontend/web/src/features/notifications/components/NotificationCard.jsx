import { AlertTriangleIcon, BellIcon, ShieldCheckIcon } from '../../dashboard/components/icons';
import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { formatRelativeTime } from '../notificationsMappers';
import NotificationSeverityBadge from './NotificationSeverityBadge';
import { IdCardIcon, PlugIcon } from './icons';

const CATEGORY_ICON = {
  operational: AlertTriangleIcon,
  review: ShieldCheckIcon,
  system: PlugIcon,
  personal: IdCardIcon,
  general: BellIcon,
};

function Chip({ children }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 font-mono text-[11px] text-text-secondary-light dark:bg-white/10 dark:text-text-secondary-dark">
      {children}
    </span>
  );
}

export default function NotificationCard({ notification, nowIso, selected = false, onToggleSelect, onOpen }) {
  const CategoryIcon = CATEGORY_ICON[notification.category] ?? BellIcon;
  const accentColor = STATUS_COLORS[getStatusMeta('notification', notification.severity).color];
  const unread = !notification.read;

  return (
    <div
      data-testid="notification-card"
      data-unread={unread}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(notification.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(notification.id);
      }}
      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
      className={`flex items-start gap-3 rounded-xl border border-black/5 px-4 py-3 backdrop-blur-md transition-colors duration-200 dark:border-white/5 ${
        unread ? 'bg-accent-600/5 dark:bg-accent-600/10' : 'bg-white/70 dark:bg-surface-dark-card'
      }`}
    >
      <input
        type="checkbox"
        aria-label="Seleccionar notificación"
        checked={selected}
        onClick={event => event.stopPropagation()}
        onChange={() => onToggleSelect(notification.id)}
        className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-black/20 accent-accent-600 dark:border-white/20"
      />

      <CategoryIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary-light dark:text-text-secondary-dark" />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {unread && <span data-testid="notification-unread-dot" aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" />}
          <p
            className={`truncate text-sm ${unread ? 'font-semibold text-ink-900 dark:text-text-primary-dark' : 'font-medium text-text-secondary-light dark:text-text-secondary-dark'}`}
          >
            {notification.title}
          </p>
          <NotificationSeverityBadge severity={notification.severity} />
        </div>

        <p className="line-clamp-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {notification.description}
        </p>

        {(notification.flightNumber || notification.airline || notification.position) && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {notification.flightNumber && <Chip>{notification.flightNumber}</Chip>}
            {notification.airline && <Chip>{notification.airline}</Chip>}
            {notification.position && <Chip>Pos. {notification.position}</Chip>}
          </div>
        )}
      </div>

      <span
        title={formatClockTime(notification.createdAt)}
        className="shrink-0 whitespace-nowrap text-[11px] text-text-secondary-light dark:text-text-secondary-dark"
      >
        {formatRelativeTime(notification.createdAt, nowIso)}
      </span>
    </div>
  );
}
