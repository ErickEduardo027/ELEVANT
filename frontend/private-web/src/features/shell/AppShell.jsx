import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Toast from '../../components/Toast';
import { useToast } from '../../hooks/useToast';
import { isAlertNotification, isMessageNotification, notificationKindLabel, notificationTargetPath } from '../notifications/notificationKinds';
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
  // OCC: incidents and deviations pop up as alerts, other operational notices as information (ADR-0029).
  const operational = notificationsSource === 'operational' && observeNotifications;
  const { toasts, showToast, dismissToast } = useToast();
  const onArrive = useCallback(arrived => {
    // Messages need no toast while the chat itself is open; it already shows them.
    const fresh = pathname?.includes('/chat') ? arrived.filter(item => !isMessageNotification(item.kind)) : arrived;
    fresh.slice(0, 3).forEach(item => {
      const alert = isAlertNotification(item.kind);
      showToast(`${notificationKindLabel(item.kind)} · ${item.operationCode}`, alert ? 'danger' : 'info', alert ? 15_000 : 8000,
        { label: 'Abrir', onClick: () => router.push(notificationTargetPath(item)) });
    });
    if (fresh.length > 3) showToast(`Tienes ${fresh.length - 3} avisos operativos nuevos más.`, 'info', 8000,
      notificationsPath ? { label: 'Ver', onClick: () => router.push(notificationsPath) } : null);
  }, [notificationsPath, pathname, router, showToast]);
  const notifications = useNotificationBadge({ fallback: fallbackCount, enabled: notificationsEnabled && !department, source: notificationsSource,
    observe: operational, onArrive: operational ? onArrive : undefined });
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
        roleLabel, station, notificationsCount: department ? center.count : notifications.count, notificationsEnabled, profileActionsEnabled,
        theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout, navigation,
        onOpenNotifications: () => (department ? center.openPanel()
          : notificationsPath ? router.push(notificationsPath) : notifications.refresh()),
      }}
    >
      {children}
      {center.ui}
      {operational && <Toast toasts={toasts} onDismiss={dismissToast} />}
    </ShellFrame>
  );
}
