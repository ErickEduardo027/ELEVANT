import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import HumanResourcesDashboardPage from '../features/human-resources/dashboard/DashboardPage';
import UsersPage from '../features/human-resources/users/UsersPage';
import {
  HUMAN_RESOURCES_NAVIGATION,
  HUMAN_RESOURCES_BASE_PATH,
  HUMAN_RESOURCES_MODULE_IDS,
} from '../features/human-resources/navigation';

const humanResourcesChildren = HUMAN_RESOURCES_NAVIGATION.map(item => ({
  path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
  element:
    item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ? (
      <HumanResourcesDashboardPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? (
      <UsersPage />
    ) : (
      <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />
    ),
}));

const router = createBrowserRouter([
  { path: '/', element: <LoginPage /> },
  {
    path: HUMAN_RESOURCES_BASE_PATH,
    element: <HumanResourcesLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      ...humanResourcesChildren,
    ],
  },
]);

export default router;
