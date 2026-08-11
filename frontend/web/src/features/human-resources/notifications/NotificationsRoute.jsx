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
        if (moduleId === 'certifications') navigate(`/human-resources/certifications${resourceId ? `?agentId=${resourceId}` : ''}`);
        if (moduleId === 'permits') navigate(`/human-resources/permits${resourceId ? `?agentId=${resourceId}` : ''}`);
        if (moduleId === 'users') navigate('/human-resources/users');
        if (moduleId === 'schedules') navigate('/human-resources/schedules');
        if (moduleId === 'reports') navigate('/human-resources/reports');
      }}
    />
  );
}

