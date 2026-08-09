import AppShell from '../shell/AppShell';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK } from './mockData';

export default function HumanResourcesLayout() {
  return (
    <AppShell
      navigation={HUMAN_RESOURCES_NAVIGATION}
      roleLabel="Gestión Humana"
      user={CURRENT_USER_MOCK}
      notificationsPath={`${HUMAN_RESOURCES_BASE_PATH}/notifications`}
    />
  );
}
