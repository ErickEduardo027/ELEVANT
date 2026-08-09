import AppShell from '../shell/AppShell';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK, fallbackStation } from './mockData';

export default function AdminOccLayout() {
  return (
    <AppShell
      navigation={ADMIN_OCC_NAVIGATION}
      roleLabel="Administrador / OCC"
      user={CURRENT_USER_MOCK}
      station={fallbackStation()}
      notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
    />
  );
}
