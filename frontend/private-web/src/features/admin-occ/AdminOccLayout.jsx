import AppShell from '../shell/AppShell';
import DevPreviewPanel from '../dashboard/components/DevPreviewPanel';
import { useMemo } from 'react';
import { useTheme } from '../shell/useTheme';
import { allowedNavigation, useDepartmentAccess } from '../access/DepartmentAccessContext';
import { useNavigationGuard } from '../access/useNavigationGuard';
import NoModulesNotice from '../access/NoModulesNotice';
import { useAdminOccPreview } from './AdminOccPreviewContext';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK, fallbackStation } from './mockData';

export default function AdminOccLayout({ user = CURRENT_USER_MOCK, onLogout, children }) {
  const { theme, toggleTheme } = useTheme();
  const { forceState, setForceState } = useAdminOccPreview();
  const { access } = useDepartmentAccess();
  const navigation = useMemo(() => allowedNavigation(ADMIN_OCC_NAVIGATION, access), [access]);
  const { permitted, empty } = useNavigationGuard(ADMIN_OCC_NAVIGATION, navigation);

  return (
    <>
      <AppShell
        navigation={navigation}
        roleLabel="Administrador / OCC"
        user={user}
        onLogout={onLogout}
        station={fallbackStation()}
        notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
        notificationsSource="operational"
      >{empty ? <NoModulesNotice /> : permitted ? children : null}</AppShell>
      {process.env.NODE_ENV === 'development' && (
        <DevPreviewPanel theme={theme} forceState={forceState} onToggleTheme={toggleTheme} onSetForceState={setForceState} defaultOpen={false} />
      )}
    </>
  );
}
