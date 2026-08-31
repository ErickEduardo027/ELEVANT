import { useMemo } from 'react';
import AppShell from '../shell/AppShell';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH, HUMAN_RESOURCES_MODULE_IDS } from './navigation';
import { CURRENT_USER_MOCK } from './mockData';
import { useUnreadNotificationsCount } from './notifications/useUnreadNotificationsCount';

export default function HumanResourcesLayout({ user = CURRENT_USER_MOCK, onLogout }) {
  const unreadNotificationsCount = useUnreadNotificationsCount();

  const navigation = useMemo(
    () =>
      HUMAN_RESOURCES_NAVIGATION.map(item =>
        item.id === HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS
          ? {
              ...item,
              badge: unreadNotificationsCount > 0 ? { count: unreadNotificationsCount, tone: 'default' } : null,
            }
          : item
      ),
    [unreadNotificationsCount]
  );

  return (
    <AppShell
      navigation={navigation}
      roleLabel="Gestión Humana"
      user={user}
      onLogout={onLogout}
      notificationsPath={`${HUMAN_RESOURCES_BASE_PATH}/notifications`}
    />
  );
}
