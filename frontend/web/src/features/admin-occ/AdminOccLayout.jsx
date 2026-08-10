import AppShell from '../shell/AppShell';
import DevPreviewPanel from '../dashboard/components/DevPreviewPanel';
import { useTheme } from '../shell/useTheme';
import { useAdminOccPreview } from './AdminOccPreviewContext';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK, fallbackStation } from './mockData';

export default function AdminOccLayout() {
  const { theme, toggleTheme } = useTheme();
  const { forceState, setForceState } = useAdminOccPreview();

  return (
    <>
      <AppShell
        navigation={ADMIN_OCC_NAVIGATION}
        roleLabel="Administrador / OCC"
        user={CURRENT_USER_MOCK}
        station={fallbackStation()}
        notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
      />
      {import.meta.env.DEV && (
        <DevPreviewPanel theme={theme} forceState={forceState} onToggleTheme={toggleTheme} onSetForceState={setForceState} />
      )}
    </>
  );
}
