import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NotificationsPage from './NotificationsPage';
import { useNotificationsData } from './useNotificationsData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

// La navegación cruzada hacia Monitoreo de Vuelos / Revisión sigue el mismo
// patrón de query param que FlightMonitoringRoute/ReviewRoute
// (`?flightId=`/`?operationId=`); los únicos `relatedModule` navegables que
// produce el backend simulado son `flight-monitoring` y `approvals` (ver
// notificationsService.js/RESOURCE_ACTION_LABEL en NotificationDetailDrawer).
export default function NotificationsRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const notifications = useNotificationsData('PUJ', retryToken);
  const navigate = useNavigate();

  return (
    <NotificationsPage
      status={notifications.status}
      data={notifications.data}
      error={notifications.error}
      onRetry={() => setRetryToken(token => token + 1)}
      onMarkAsRead={notifications.markAsRead}
      onMarkAsUnread={notifications.markAsUnread}
      onMarkManyAsRead={notifications.markManyAsRead}
      onMarkManyAsUnread={notifications.markManyAsUnread}
      onMarkAllAsRead={notifications.markAllAsRead}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'flight-monitoring') navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
        if (moduleId === 'approvals') navigate(`/admin-occ/review?operationId=${resourceId}`);
      }}
      forceState={forceState}
    />
  );
}
