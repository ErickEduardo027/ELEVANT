import { useMemo } from 'react';
import AppShell from '../shell/AppShell';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH, HUMAN_RESOURCES_MODULE_IDS } from './navigation';
import { CURRENT_USER_MOCK } from './mockData';
import { useUnreadNotificationsCount } from './notifications/useUnreadNotificationsCount';
import { HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO } from '../../config/hrDemoMode';
import { allowedNavigation, useDepartmentAccess } from '../access/DepartmentAccessContext';
import { useNavigationGuard } from '../access/useNavigationGuard';
import NoModulesNotice from '../access/NoModulesNotice';

export default function HumanResourcesLayout({
  user = CURRENT_USER_MOCK,
  onLogout,
  dashboardReadOnlyDemo = HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO,
  children,
}) {
  const { access } = useDepartmentAccess();
  const unreadNotificationsCount = useUnreadNotificationsCount({ enabled: !dashboardReadOnlyDemo });

  const navigation = useMemo(
    () =>
      allowedNavigation(HUMAN_RESOURCES_NAVIGATION, access)
        .filter(item => !dashboardReadOnlyDemo ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.PERMITS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.ATTENDANCE ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.ACCESS_REQUESTS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.DEPARTMENT_USERS)
        .map(item =>
        dashboardReadOnlyDemo && (item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.PERMITS ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ||
          item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS)
          ? { ...item, badge: null }
          : item.id === HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS
          ? {
              ...item,
              badge: unreadNotificationsCount > 0 ? { count: unreadNotificationsCount, tone: 'default' } : null,
            }
          : item
      ),
    [access, dashboardReadOnlyDemo, unreadNotificationsCount]
  );

  const { permitted, empty } = useNavigationGuard(HUMAN_RESOURCES_NAVIGATION, navigation);

  return (
    <AppShell
      navigation={navigation}
      roleLabel="Gestión Humana"
      user={user}
      onLogout={onLogout}
      notificationsPath={dashboardReadOnlyDemo ? undefined : `${HUMAN_RESOURCES_BASE_PATH}/notifications`}
      notificationsEnabled={!dashboardReadOnlyDemo}
      profileActionsEnabled={!dashboardReadOnlyDemo}
    >{empty ? <NoModulesNotice /> : permitted ? children : null}</AppShell>
  );
}
