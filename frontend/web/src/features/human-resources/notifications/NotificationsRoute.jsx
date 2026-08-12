import { useNavigate } from 'react-router-dom';
import NotificationsPage from './NotificationsPage';
import { useNotificationsData } from './useNotificationsData';

export default function NotificationsRoute() {
  const notifications = useNotificationsData('PUJ');
  const navigate = useNavigate();

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
        if (moduleId === 'certifications') navigate(`/gestion-humana/certifications${resourceId ? `?agentId=${resourceId}` : ''}`);
        if (moduleId === 'permits') navigate(`/gestion-humana/permits${resourceId ? `?agentId=${resourceId}` : ''}`);
        if (moduleId === 'users') navigate('/gestion-humana/users');
        if (moduleId === 'schedules') navigate('/gestion-humana/schedules');
        if (moduleId === 'reports') navigate('/gestion-humana/reports');
      }}
    />
  );
}
