import { usePathname, useRouter } from 'next/navigation';
import ShellFrame from './ShellFrame';
import { useResponsiveSidebar } from './useResponsiveSidebar';
import { useTheme } from './useTheme';
import useNotificationBadge from '../notifications/useNotificationBadge';
import { useDepartmentNotificationCenter } from '../notifications/DepartmentNotificationCenter';

export default function AppShell({
  navigation,
  roleLabel,
  user,
  notificationsPath,
  station,
  onLogout,
  notificationsEnabled = true,
  notificationsSource = 'legacy',
  // Turns on the department bell, toasts and drawer; tests enable it explicitly.
  observeNotifications = process.env.NODE_ENV !== 'test',
  profileActionsEnabled = true,
  frameProps,
  notificationCenter,
  children,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebar = useResponsiveSidebar();
  const { theme, toggleTheme } = useTheme();
  const notification = navigation.find(item => item.id === 'notifications');
  const fallbackCount = typeof notification?.badge === 'number' ? notification.badge : notification?.badge?.count ?? 0;
  // 'department' alerts pop up on screen and open in a drawer; the other sources keep their page.
  const department = notificationsSource === 'department';
  const notifications = useNotificationBadge({ fallback: fallbackCount, enabled: notificationsEnabled && !department && !notificationCenter, source: notificationsSource });
  const center = useDepartmentNotificationCenter({
    enabled: notificationsEnabled && department && observeNotifications,
    onOpen: target => target.path && router.push(target.path),
  });

  return (
    <ShellFrame
      {...frameProps}
      mainKey={pathname}
      sidebarProps={{
        navigation, user, onLogout, profileActionsEnabled,
        breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible, railExpanded: sidebar.railExpanded,
        overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle, onCloseOverlay: sidebar.closeOverlay,
      }}
      topbarProps={{
        roleLabel, station, notificationsCount: notificationCenter ? notificationCenter.count : department ? center.count : notifications.count, notificationsEnabled, profileActionsEnabled,
        notificationCenter,
        theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout, navigation,
        onOpenNotifications: () => (department ? center.openPanel()
          : notificationsPath ? router.push(notificationsPath) : notifications.refresh()),
      }}
    >
      {children}
      {center.ui}
      {notificationCenter?.ui}
    </ShellFrame>
  );
}
