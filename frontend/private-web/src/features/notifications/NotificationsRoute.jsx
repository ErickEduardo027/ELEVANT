import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NotificationsPage from './NotificationsPage';
import { useNotificationsData } from './useNotificationsData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

// La navegación cruzada hacia Monitoreo de Vuelos / Revisión sigue el mismo
// patrón de query param que FlightMonitoringRoute/ReviewRoute
// (`?flightId=`/`?operationId=`); el backend simulado también produce
// `relatedModule: 'reports'`, que navega directamente al módulo de Reportes
// (sin recurso específico) (ver notificationsService.js/RESOURCE_ACTION_LABEL
// en NotificationDetailDrawer).
export default function NotificationsRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const notifications = useNotificationsData('PUJ', retryToken);
  const router = useRouter();

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
        if (moduleId === 'flight-monitoring') router.push(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
        if (moduleId === 'approvals') router.push(`/admin-occ/review?operationId=${resourceId}`);
        if (moduleId === 'reports') router.push('/admin-occ/reports');
      }}
      forceState={forceState}
    />
  );
}
