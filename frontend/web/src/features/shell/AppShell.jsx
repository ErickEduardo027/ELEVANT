import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import { useResponsiveSidebar } from './useResponsiveSidebar';
import { useTheme } from './useTheme';

// Shell compartido por todos los entornos de ELEVANT (Admin/OCC, Gestión
// Humana, Contratos, Finanzas). Cada rol aporta su propia configuración de
// navegación y usuario; el shell visual (Sidebar, Topbar, layout de
// contenido) se mantiene único para que la identidad de producto no se
// fragmente entre roles.
export default function AppShell({ navigation, roleLabel, user, notificationsPath, station }) {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebar = useResponsiveSidebar();
  const { theme, toggleTheme } = useTheme();

  const notificationsItem = navigation.find(item => item.id === 'notifications');
  const notificationsCount = typeof notificationsItem?.badge === 'number'
    ? notificationsItem.badge
    : notificationsItem?.badge?.count ?? 0;

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar
        navigation={navigation}
        user={user}
        breakpoint={sidebar.breakpoint}
        railVisible={sidebar.railVisible}
        railExpanded={sidebar.railExpanded}
        overlayOpen={sidebar.overlayOpen}
        onToggle={sidebar.toggle}
        onCloseOverlay={sidebar.closeOverlay}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          roleLabel={roleLabel}
          station={station}
          notificationsCount={notificationsCount}
          theme={theme}
          onToggleTheme={toggleTheme}
          user={user}
          onOpenMenu={sidebar.toggle}
          onOpenNotifications={() => notificationsPath && navigate(notificationsPath)}
        />

        <main key={location.pathname} className="flex-1 overflow-y-auto p-6 [animation:elevant-fade-in_180ms_ease-out]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
