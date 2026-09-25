import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import { useResponsiveSidebar } from './useResponsiveSidebar';
import { useTheme } from './useTheme';
import useNotificationBadge from '../notifications/useNotificationBadge';

export default function AppShell({
  navigation,
  roleLabel,
  user,
  notificationsPath,
  station,
  onLogout,
  notificationsEnabled = true,
  notificationsSource = 'legacy',
  profileActionsEnabled = true,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebar = useResponsiveSidebar();
  const { theme, toggleTheme } = useTheme();
  const notification = navigation.find(item => item.id === 'notifications');
  const fallbackCount = typeof notification?.badge === 'number' ? notification.badge : notification?.badge?.count ?? 0;
  const notifications = useNotificationBadge({ fallback: fallbackCount, enabled: notificationsEnabled, source: notificationsSource });

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar navigation={navigation} user={user} onLogout={onLogout} profileActionsEnabled={profileActionsEnabled} breakpoint={sidebar.breakpoint} railVisible={sidebar.railVisible} railExpanded={sidebar.railExpanded} overlayOpen={sidebar.overlayOpen} onToggle={sidebar.toggle} onCloseOverlay={sidebar.closeOverlay} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar roleLabel={roleLabel} station={station} notificationsCount={notifications.count} notificationsEnabled={notificationsEnabled} profileActionsEnabled={profileActionsEnabled} theme={theme} onToggleTheme={toggleTheme} user={user} onOpenMenu={sidebar.toggle} onOpenNotifications={() => notificationsPath ? navigate(notificationsPath) : notifications.refresh()} onLogout={onLogout} />
        <main key={location.pathname} className="min-w-0 flex-1 overflow-y-auto p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
