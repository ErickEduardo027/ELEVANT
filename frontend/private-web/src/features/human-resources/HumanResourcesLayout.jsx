import { useMemo } from 'react';
import AppShell from '../shell/AppShell';
import {
  HUMAN_RESOURCES_BASE_PATH, HUMAN_RESOURCES_MODULE_IDS, HUMAN_RESOURCES_NAVIGATION, humanResourcesNavigation,
} from './navigation';
import { CURRENT_USER_MOCK } from './mockData';
import { HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO } from '../../config/hrDemoMode';
import { allowedNavigation, useDepartmentAccess } from '../access/DepartmentAccessContext';
import { useNavigationGuard } from '../access/useNavigationGuard';
import NoModulesNotice from '../access/NoModulesNotice';

const DEMO_MODULES = new Set([
  HUMAN_RESOURCES_MODULE_IDS.DASHBOARD,
  HUMAN_RESOURCES_MODULE_IDS.EMPLOYEES,
  HUMAN_RESOURCES_MODULE_IDS.USERS,
  HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS,
  HUMAN_RESOURCES_MODULE_IDS.PERMITS,
  HUMAN_RESOURCES_MODULE_IDS.SCHEDULES,
  HUMAN_RESOURCES_MODULE_IDS.ATTENDANCE,
  HUMAN_RESOURCES_MODULE_IDS.REPORTS,
  HUMAN_RESOURCES_MODULE_IDS.AUDIT,
  HUMAN_RESOURCES_MODULE_IDS.ACCESS_REQUESTS,
  HUMAN_RESOURCES_MODULE_IDS.DEPARTMENT_USERS,
  HUMAN_RESOURCES_MODULE_IDS.SETTINGS,
]);
const DEMO_WITHOUT_BADGE = new Set([
  HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS,
  HUMAN_RESOURCES_MODULE_IDS.PERMITS,
  HUMAN_RESOURCES_MODULE_IDS.SCHEDULES,
  HUMAN_RESOURCES_MODULE_IDS.REPORTS,
]);

export default function HumanResourcesLayout({
  user = CURRENT_USER_MOCK,
  onLogout,
  dashboardReadOnlyDemo = HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO,
  children,
}) {
  const { access } = useDepartmentAccess();
  // Department alerts are real data (ADR-0019), so the read-only demo keeps them.
  const notificationsEnabled = Boolean(access?.can('human_resources.notifications.read'));

  // The read-only demo of the Development VPS lists the modules it shows; Configuración is real data (ADR-0045).
  const allowed = useMemo(
    () =>
      allowedNavigation(HUMAN_RESOURCES_NAVIGATION, access)
        .filter(item => !dashboardReadOnlyDemo || DEMO_MODULES.has(item.id))
        .map(item => (dashboardReadOnlyDemo && DEMO_WITHOUT_BADGE.has(item.id) ? { ...item, badge: null } : item)),
    [access, dashboardReadOnlyDemo]
  );
  const navigation = useMemo(() => humanResourcesNavigation(allowed), [allowed]);

  const { permitted, empty } = useNavigationGuard(HUMAN_RESOURCES_NAVIGATION, allowed,
    { homePath: `${HUMAN_RESOURCES_BASE_PATH}/dashboard`, basePath: HUMAN_RESOURCES_BASE_PATH });

  return (
    <AppShell
      navigation={navigation}
      roleLabel="Gestión Humana"
      user={user}
      onLogout={onLogout}
      notificationsSource="department"
      notificationsEnabled={notificationsEnabled}
      profileActionsEnabled={!dashboardReadOnlyDemo}
    >{empty ? <NoModulesNotice /> : permitted ? children : null}</AppShell>
  );
}
