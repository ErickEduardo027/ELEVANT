import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import EnvironmentSelectorPage from '../features/auth/EnvironmentSelectorPage';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import HumanResourcesDashboardPage from '../features/human-resources/dashboard/DashboardPage';
import UsersPage from '../features/human-resources/users/UsersPage';
import CertificationsPage from '../features/human-resources/certifications/CertificationsPage';
import PermitsPage from '../features/human-resources/permits/PermitsPage';
import SchedulesPage from '../features/human-resources/schedules/SchedulesPage';
import HumanResourcesReportsPage from '../features/human-resources/reports/ReportsRoute';
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
import ReviewRoute from '../features/review/ReviewRoute';
import ReportsRoute from '../features/reports/ReportsRoute';
import NotificationsRoute from '../features/notifications/NotificationsRoute';
import ChatRoute from '../features/chat/ChatRoute';
import { FileTextIcon, BarChartIcon, IdCardIcon, PlaneIcon, AlertTriangleIcon } from '../features/shell/components/icons';

const humanResourcesChildren = HUMAN_RESOURCES_NAVIGATION.map(item => ({
  path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
  element:
    item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ? (
      <HumanResourcesDashboardPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? (
      <UsersPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS ? (
      <CertificationsPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.PERMITS ? (
      <PermitsPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ? (
      <SchedulesPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS ? (
      <HumanResourcesReportsPage />
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
      {
        path: '*',
        element: <ModulePlaceholder icon={AlertTriangleIcon} label="Módulo no encontrado" description="La ruta que buscas no existe dentro de Recursos Humanos." />,
      },
    ],
  },
  {
    path: ADMIN_OCC_BASE_PATH,
    element: (
      <AdminOccPreviewProvider>
        <AdminOccLayout />
      </AdminOccPreviewProvider>
    ),
    // Los 8 módulos de /admin-occ (dashboard, planning, flight-monitoring,
    // positions-map, review, reports, notifications, chat) quedaron
    // completamente portados y enrutados en las Tasks 6-12.
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <DashboardRoute /> },
      { path: 'planning', element: <PlanningRoute /> },
      { path: 'flight-monitoring', element: <FlightMonitoringRoute /> },
      { path: 'positions-map', element: <PositionsMapRoute /> },
      { path: 'review', element: <ReviewRoute /> },
      { path: 'reports', element: <ReportsRoute /> },
      { path: 'notifications', element: <NotificationsRoute /> },
      { path: 'chat', element: <ChatRoute /> },
      {
        path: '*',
        element: <ModulePlaceholder icon={AlertTriangleIcon} label="Módulo no encontrado" description="La ruta que buscas no existe dentro de Administrador / OCC." />,
      },
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
  {
    path: '*',
    element: <ModulePlaceholder icon={AlertTriangleIcon} label="Página no encontrada" description="La ruta que buscas no existe." />,
  },
]);

export default router;
