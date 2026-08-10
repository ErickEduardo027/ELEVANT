import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import EnvironmentSelectorPage from '../features/auth/EnvironmentSelectorPage';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import HumanResourcesDashboardPage from '../features/human-resources/dashboard/DashboardPage';
import UsersPage from '../features/human-resources/users/UsersPage';
import CertificationsPage from '../features/human-resources/certifications/CertificationsPage';
import {
  HUMAN_RESOURCES_NAVIGATION,
  HUMAN_RESOURCES_BASE_PATH,
  HUMAN_RESOURCES_MODULE_IDS,
} from '../features/human-resources/navigation';
import AdminOccLayout from '../features/admin-occ/AdminOccLayout';
import { AdminOccPreviewProvider } from '../features/admin-occ/AdminOccPreviewContext';
import { ADMIN_OCC_BASE_PATH } from '../features/admin-occ/navigation';
import DashboardRoute from '../features/dashboard/DashboardRoute';
import PlanningRoute from '../features/planning/PlanningRoute';
import FlightMonitoringRoute from '../features/flight-monitoring/FlightMonitoringRoute';
import PositionsMapRoute from '../features/positions-map/PositionsMapRoute';
import { FileTextIcon, BarChartIcon, IdCardIcon, PlaneIcon } from '../features/shell/components/icons';

const humanResourcesChildren = HUMAN_RESOURCES_NAVIGATION.map(item => ({
  path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
  element:
    item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ? (
      <HumanResourcesDashboardPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? (
      <UsersPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS ? (
      <CertificationsPage />
    ) : (
      <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />
    ),
}));

const router = createBrowserRouter([
  { path: '/', element: <LoginPage /> },
  { path: '/select-role', element: <EnvironmentSelectorPage /> },
  {
    path: HUMAN_RESOURCES_BASE_PATH,
    element: <HumanResourcesLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      ...humanResourcesChildren,
    ],
  },
  {
    path: ADMIN_OCC_BASE_PATH,
    element: (
      <AdminOccPreviewProvider>
        <AdminOccLayout />
      </AdminOccPreviewProvider>
    ),
    // Las Tasks 6-12 agregan aquí, una por task, su import de `*Route` y su
    // entrada en este arreglo (planning, flight-monitoring, positions-map,
    // review, reports, notifications, chat).
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <DashboardRoute /> },
      { path: 'planning', element: <PlanningRoute /> },
      { path: 'flight-monitoring', element: <FlightMonitoringRoute /> },
      { path: 'positions-map', element: <PositionsMapRoute /> },
    ],
  },
  {
    path: '/contratos',
    element: <ModulePlaceholder icon={FileTextIcon} label="Contratos" description="Entorno de Contratos — pendiente de construcción." />,
  },
  {
    path: '/finanzas',
    element: <ModulePlaceholder icon={BarChartIcon} label="Finanzas" description="Entorno de Finanzas — pendiente de construcción." />,
  },
  {
    path: '/agente',
    element: <ModulePlaceholder icon={IdCardIcon} label="Agente" description="Experiencia de Agente — pendiente de construcción." />,
  },
  {
    path: '/aerolinea',
    element: <ModulePlaceholder icon={PlaneIcon} label="Cliente / Aerolínea" description="Portal de aerolínea — pendiente de construcción." />,
  },
]);

export default router;
