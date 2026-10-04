import AppShell from '../shell/AppShell';
import DevPreviewPanel from '../dashboard/components/DevPreviewPanel';
import { useTheme } from '../shell/useTheme';
import { useAdminOccPreview } from './AdminOccPreviewContext';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK, fallbackStation } from './mockData';

export default function AdminOccLayout({ user = CURRENT_USER_MOCK, onLogout, children }) {
  const { theme, toggleTheme } = useTheme();
  const { forceState, setForceState } = useAdminOccPreview();

  return (
    <>
      <AppShell
        navigation={ADMIN_OCC_NAVIGATION}
        roleLabel="Administrador / OCC"
        user={user}
        onLogout={onLogout}
        station={fallbackStation()}
        notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
        notificationsSource="operational"
      >{children}</AppShell>
      {process.env.NODE_ENV === 'development' && (
        <DevPreviewPanel theme={theme} forceState={forceState} onToggleTheme={toggleTheme} onSetForceState={setForceState} defaultOpen={false} />
      )}
    </>
  );
}
