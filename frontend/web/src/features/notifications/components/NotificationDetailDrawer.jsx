import { formatClockTime } from '../../dashboard/mappers';
import { NOTIFICATION_CATEGORIES } from '../notificationsMappers';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import NotificationSeverityBadge from './NotificationSeverityBadge';
import { ArrowRightIcon, CheckCheckIcon } from './icons';
import { XIcon } from '../../review/components/icons';

const RESOURCE_ACTION_LABEL = {
  'flight-monitoring': 'Ver vuelo',
  approvals: 'Ver operación',
  reports: 'Ver reporte',
};

function categoryLabel(categoryId, categoryLabelMap) {
  return categoryLabelMap?.[categoryId] ?? NOTIFICATION_CATEGORIES.find(category => category.id === categoryId)?.label ?? categoryId;
}

function MetadataRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-text-secondary-light dark:text-text-secondary-dark">{label}</span>
      <span className="text-right font-medium text-ink-900 dark:text-text-primary-dark">{value}</span>
    </div>
  );
}

export default function NotificationDetailDrawer({
  notification,
  onClose,
  onMarkAsRead,
  onMarkAsUnread,
  onNavigate,
  categoryLabelMap,
  resourceActionLabelMap = RESOURCE_ACTION_LABEL,
  detailFields,
}) {
  useEscapeToClose(Boolean(notification), onClose);

  if (!notification) return null;

  const actionLabel = resourceActionLabelMap[notification.relatedModule];
  const metadataEntries = Object.entries(notification.metadata ?? {});
  const resolvedDetailFields = detailFields ?? notification.detailFields ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200" onClick={onClose} />
      <aside
        data-testid="notification-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-drawer-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-black/5 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card lg:w-[420px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              {categoryLabel(notification.category, categoryLabelMap)}
            </p>
            <p id="notification-drawer-title" className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">
              {notification.title}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NotificationSeverityBadge severity={notification.severity} />
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {notification.read ? 'Leída' : 'No leída'} · {formatClockTime(notification.createdAt)}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-sm text-ink-900 dark:text-text-primary-dark">{notification.description}</p>

          <div className="space-y-1.5 rounded-xl border border-black/5 p-3 dark:border-white/5">
            {resolvedDetailFields.length > 0 ? (
              resolvedDetailFields.map(field => <MetadataRow key={field.label} label={field.label} value={field.value} />)
            ) : (
              <>
                <MetadataRow label="Origen" value={notification.source} />
                <MetadataRow label="Vuelo" value={notification.flightNumber} />
                <MetadataRow label="Aerolínea" value={notification.airline} />
                <MetadataRow label="Posición" value={notification.position} />
                <MetadataRow label="Operación" value={notification.operationId} />
              </>
            )}
            {metadataEntries.map(([key, value]) => (
              <MetadataRow key={key} label={key} value={String(value)} />
            ))}
          </div>

          <div className="flex gap-2">
            {notification.read ? (
              <button
                type="button"
                onClick={() => onMarkAsUnread(notification.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
              >
                Marcar como no leída
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onMarkAsRead(notification.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent-600/30 px-3 py-1.5 text-xs font-semibold text-accent-600 hover:bg-accent-600/10"
              >
                <CheckCheckIcon className="h-3.5 w-3.5" />
                Marcar como leída
              </button>
            )}
          </div>
        </div>

        {actionLabel && (
          <div className="border-t border-black/5 px-5 py-4 dark:border-white/5">
            <button
              type="button"
              onClick={() => onNavigate(notification.relatedModule, notification.relatedRoute)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-600/90"
            >
              {actionLabel}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
