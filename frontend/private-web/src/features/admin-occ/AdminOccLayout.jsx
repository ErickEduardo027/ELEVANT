import AppShell from '../shell/AppShell';
import { useMemo } from 'react';
import { allowedNavigation, useDepartmentAccess } from '../access/DepartmentAccessContext';
import { useNavigationGuard } from '../access/useNavigationGuard';
import NoModulesNotice from '../access/NoModulesNotice';
import { LanguageScope } from '../../i18n/LanguageScope';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK } from './mockData';
import OccWorkspace from './ui/OccWorkspace';
import { OperationalNotificationProvider, useOperationalNotificationCenter } from './notifications/OperationalNotificationCenter';
import OccAccessNotice from './OccAccessNotice';
import OccHorizontalHeader, { NoOccSidebar } from './shell/OccHorizontalHeader';
import refinement from './ui/OccRefinement.module.css';

// One shared chrome instance for every OCC route; Panorama keeps its own content.
const OCC_FRAME = {
  department: 'occ',
  SidebarComponent: NoOccSidebar,
  TopbarComponent: OccHorizontalHeader,
  rootClassName: 'bg-occ-canvas text-occ-text ' + refinement.frame,
};

function OperationalShell(props) {
  const notificationCenter = useOperationalNotificationCenter();
  return <AppShell {...props} notificationCenter={notificationCenter} />;
}

export default function AdminOccLayout({ user = CURRENT_USER_MOCK, onLogout, children }) {
  const { access } = useDepartmentAccess();
  const navigation = useMemo(() => allowedNavigation(ADMIN_OCC_NAVIGATION, access), [access]);
  const { permitted, empty, homeDenied } = useNavigationGuard(ADMIN_OCC_NAVIGATION, navigation, {
    homePath: `${ADMIN_OCC_BASE_PATH}/dashboard`, basePath: ADMIN_OCC_BASE_PATH,
  });

  return (
    <LanguageScope>
      <OperationalNotificationProvider navigation={navigation} enabled={navigation.some(item => item.id === 'notifications')}>
      <OperationalShell
        navigation={navigation}
        roleLabel="Administrador / OCC"
        user={user}
        onLogout={onLogout}
        notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
        notificationsSource="operational"
        notificationsEnabled={navigation.some(item => item.id === 'notifications')}
        frameProps={OCC_FRAME}
      ><OccWorkspace>{homeDenied ? <OccAccessNotice navigation={navigation} /> : empty ? <NoModulesNotice /> : permitted ? children : null}</OccWorkspace></OperationalShell>
      </OperationalNotificationProvider>
    </LanguageScope>
  );
}
