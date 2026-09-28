import { useMemo } from 'react';
import AppShell from '../shell/AppShell';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH, HUMAN_RESOURCES_MODULE_IDS } from './navigation';
import { CURRENT_USER_MOCK } from './mockData';
import { useUnreadNotificationsCount } from './notifications/useUnreadNotificationsCount';
import { HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO } from '../../config/hrDemoMode';

export default function HumanResourcesLayout({
  user = CURRENT_USER_MOCK,
  onLogout,
  dashboardReadOnlyDemo = HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO,
}) {
  const unreadNotificationsCount = useUnreadNotificationsCount({ enabled: !dashboardReadOnlyDemo });

  const navigation = useMemo(
    () =>
      HUMAN_RESOURCES_NAVIGATION
        .filter(item => !dashboardReadOnlyDemo ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS)
        .map(item =>
        dashboardReadOnlyDemo && item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS
          ? { ...item, badge: null }
          : item.id === HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS
          ? {
              ...item,
              badge: unreadNotificationsCount > 0 ? { count: unreadNotificationsCount, tone: 'default' } : null,
            }
          : item
      ),
    [dashboardReadOnlyDemo, unreadNotificationsCount]
  );

  return (
    <AppShell
      navigation={navigation}
      roleLabel="Gestión Humana"
      user={user}
      onLogout={onLogout}
      notificationsPath={dashboardReadOnlyDemo ? undefined : `${HUMAN_RESOURCES_BASE_PATH}/notifications`}
      notificationsEnabled={!dashboardReadOnlyDemo}
      profileActionsEnabled={!dashboardReadOnlyDemo}
    />
  );
}
