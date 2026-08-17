import { groupNotificationsByDate } from '../notificationsMappers';
import NotificationCard from './NotificationCard';

export default function NotificationFeed({ notifications, nowIso, selectedIds, onToggleSelect, onOpen, cardProps = {} }) {
  const groups = groupNotificationsByDate(notifications, nowIso);

  return (
    <div data-testid="notification-feed" className="mx-auto max-w-[800px] space-y-5">
      {groups.map(group => (
        <div key={group.key} className="space-y-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            {group.label}
          </p>
          <div className="space-y-2">
            {group.items.map(notification => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                nowIso={nowIso}
                selected={selectedIds.has(notification.id)}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
                {...cardProps}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
