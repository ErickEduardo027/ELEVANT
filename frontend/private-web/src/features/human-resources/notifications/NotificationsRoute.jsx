import { useRouter } from 'next/navigation';
import NotificationsPage from './NotificationsPage';
import { useNotificationsData } from './useNotificationsData';

export default function NotificationsRoute() {
  const notifications = useNotificationsData('PUJ');
  const router = useRouter();

  return (
    <NotificationsPage
      status={notifications.status}
      data={notifications.data}
      error={notifications.error}
      onRetry={notifications.refresh}
      onMarkAsRead={notifications.markAsRead}
      onMarkAsUnread={notifications.markAsUnread}
      onMarkManyAsRead={notifications.markManyAsRead}
      onMarkManyAsUnread={notifications.markManyAsUnread}
      onMarkAllAsRead={notifications.markAllAsRead}
      preferences={notifications.preferences}
      onUpdatePreferences={notifications.updatePreferences}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'certifications') router.push(`/gestion-humana/certifications${resourceId ? `?agentId=${resourceId}` : ''}`);
        if (moduleId === 'permits') router.push(`/gestion-humana/permits${resourceId ? `?agentId=${resourceId}` : ''}`);
        if (moduleId === 'users') router.push('/gestion-humana/users');
        if (moduleId === 'schedules') router.push('/gestion-humana/schedules');
        if (moduleId === 'reports') router.push('/gestion-humana/reports');
      }}
    />
  );
}
