import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH } from '../features/human-resources/navigation';

const humanResourcesChildren = HUMAN_RESOURCES_NAVIGATION.map(item => ({
  path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
  element: <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />,
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
