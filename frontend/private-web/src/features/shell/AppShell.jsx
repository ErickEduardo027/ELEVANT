import { usePathname, useRouter } from 'next/navigation';
import ShellFrame from './ShellFrame';
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
  children,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebar = useResponsiveSidebar();
  const { theme, toggleTheme } = useTheme();
  const notification = navigation.find(item => item.id === 'notifications');
  const fallbackCount = typeof notification?.badge === 'number' ? notification.badge : notification?.badge?.count ?? 0;
  const notifications = useNotificationBadge({ fallback: fallbackCount, enabled: notificationsEnabled, source: notificationsSource });

  return (
    <ShellFrame
      mainKey={pathname}
      sidebarProps={{
        navigation, user, onLogout, profileActionsEnabled,
        breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible, railExpanded: sidebar.railExpanded,
        overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle, onCloseOverlay: sidebar.closeOverlay,
      }}
      topbarProps={{
        roleLabel, station, notificationsCount: notifications.count, notificationsEnabled, profileActionsEnabled,
        theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout,
        onOpenNotifications: () => (notificationsPath ? router.push(notificationsPath) : notifications.refresh()),
      }}
    >
      {children}
    </ShellFrame>
  );
}
