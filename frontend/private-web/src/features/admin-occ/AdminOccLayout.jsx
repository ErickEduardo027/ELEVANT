import AppShell from '../shell/AppShell';
import DevPreviewPanel from '../dashboard/components/DevPreviewPanel';
import { useMemo } from 'react';
import { allowedNavigation, useDepartmentAccess } from '../access/DepartmentAccessContext';
import { useNavigationGuard } from '../access/useNavigationGuard';
import NoModulesNotice from '../access/NoModulesNotice';
import { LanguageScope } from '../../i18n/LanguageScope';
import { useAdminOccPreview } from './AdminOccPreviewContext';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK } from './mockData';
import OccSidebar from './shell/OccSidebar';
import OccTopbar from './shell/OccTopbar';
import { OccShellProvider } from './shell/OccShellProvider';

// Marco propio del Centro de Operaciones: riel navy, barra contextual PUJ y
// tokens `occ-*`. Comparte con los demás departamentos solo ShellFrame/AppShell.
// `data-occ-bridge` enciende el puente de estilos heredados
// (src/styles/occ-legacy-bridge.css); quitarlo lo apaga entero.
// OccShellProvider tiene el único observador de cambios de la pestaña y lee los
// avisos una vez para todo el marco: AppShell no lee avisos ni pinta toasts aquí.
const OCC_FRAME = {
  department: 'occ',
  rootAttributes: { 'data-occ-bridge': '' },
  SidebarComponent: OccSidebar,
  TopbarComponent: OccTopbar,
  rootClassName: 'bg-occ-canvas text-occ-text',
};

export default function AdminOccLayout({ user = CURRENT_USER_MOCK, onLogout, children }) {
  const { forceState, setForceState } = useAdminOccPreview();
  const { access } = useDepartmentAccess();
  const navigation = useMemo(() => allowedNavigation(ADMIN_OCC_NAVIGATION, access), [access]);
  const { permitted, empty } = useNavigationGuard(ADMIN_OCC_NAVIGATION, navigation);

  return (
    <LanguageScope>
      <OccShellProvider>
        <AppShell
          navigation={navigation}
          roleLabel="Administrador / OCC"
          user={user}
          onLogout={onLogout}
          notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
          notificationsEnabled={false}
          frameProps={OCC_FRAME}
        >{empty ? <NoModulesNotice /> : permitted ? children : null}</AppShell>
      </OccShellProvider>
      {process.env.NODE_ENV === 'development' && (
        <DevPreviewPanel forceState={forceState} onSetForceState={setForceState} defaultOpen={false} />
      )}
    </LanguageScope>
  );
}
