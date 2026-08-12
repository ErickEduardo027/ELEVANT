import { cloneElement } from 'react';
import { createBrowserRouter, Navigate, useNavigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import { useAuth } from '../features/auth/AuthContext';
import { ROLE_KEYS, ROUTE_PATHS, getRoleHomePath } from '../features/auth/roleRouting';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import HumanResourcesDashboardPage from '../features/human-resources/dashboard/DashboardPage';
import UsersPage from '../features/human-resources/users/UsersPage';
import CertificationsPage from '../features/human-resources/certifications/CertificationsPage';
import PermitsPage from '../features/human-resources/permits/PermitsPage';
import SchedulesPage from '../features/human-resources/schedules/SchedulesPage';
import HumanResourcesReportsPage from '../features/human-resources/reports/ReportsRoute';
import AuditRoute from '../features/human-resources/audit/AuditRoute';
import HumanResourcesNotificationsRoute from '../features/human-resources/notifications/NotificationsRoute';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH, HUMAN_RESOURCES_MODULE_IDS } from '../features/human-resources/navigation';
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
import ContractsShell from '../features/contracts/shell/ContractsShell';
import FinanceShell from '../features/finance/shell/FinanceShell';
import { AlertTriangleIcon } from '../features/shell/components/icons';

function LoginRoute() {
  const navigate = useNavigate();
  const { session, login } = useAuth();
  if (session) return <Navigate to={getRoleHomePath(session.role)} replace />;
  return <LoginPage onSubmit={async credentials => navigate((await login(credentials)).homePath, { replace: true })} />;
}

function ProtectedRole({ role, children }) {
  const { session, logout } = useAuth();
  if (!session) return <Navigate to={ROUTE_PATHS.LOGIN} replace />;
  if (session.role !== role) return <Navigate to={getRoleHomePath(session.role)} replace />;
  return cloneElement(children, { user: { name: session.name, role: session.roleLabel }, onLogout: logout });
}

function AdminProtectedLayout() {
  const { session, logout } = useAuth();
  if (!session) return <Navigate to={ROUTE_PATHS.LOGIN} replace />;
  if (session.role !== ROLE_KEYS.ADMIN_OCC) return <Navigate to={getRoleHomePath(session.role)} replace />;
  return <AdminOccPreviewProvider><AdminOccLayout user={{ name: session.name, role: session.roleLabel }} onLogout={logout} /></AdminOccPreviewProvider>;
}

const humanResourcesChildren = HUMAN_RESOURCES_NAVIGATION.map(item => ({
  path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
  element: item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ? <HumanResourcesDashboardPage />
    : item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? <UsersPage />
      : item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS ? <CertificationsPage />
        : item.id === HUMAN_RESOURCES_MODULE_IDS.PERMITS ? <PermitsPage />
          : item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ? <SchedulesPage />
            : item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS ? <HumanResourcesReportsPage />
              : item.id === HUMAN_RESOURCES_MODULE_IDS.AUDIT ? <AuditRoute />
                : item.id === HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS ? <HumanResourcesNotificationsRoute />
                  : <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />,
}));

const router = createBrowserRouter([
  { path: '/', element: <Navigate to={ROUTE_PATHS.LOGIN} replace /> },
  { path: ROUTE_PATHS.LOGIN, element: <LoginRoute /> },
  { path: '/select-role', element: <Navigate to={ROUTE_PATHS.LOGIN} replace /> },
  {
    path: HUMAN_RESOURCES_BASE_PATH,
    element: <ProtectedRole role={ROLE_KEYS.GESTION_HUMANA}><HumanResourcesLayout /></ProtectedRole>,
    children: [{ index: true, element: <Navigate to="dashboard" replace /> }, ...humanResourcesChildren],
  },
  {
    path: ADMIN_OCC_BASE_PATH,
    element: <AdminProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <DashboardRoute /> }, { path: 'planning', element: <PlanningRoute /> },
      { path: 'flight-monitoring', element: <FlightMonitoringRoute /> }, { path: 'positions-map', element: <PositionsMapRoute /> },
      { path: 'review', element: <ReviewRoute /> }, { path: 'reports', element: <ReportsRoute /> },
      { path: 'notifications', element: <NotificationsRoute /> }, { path: 'chat', element: <ChatRoute /> },
    ],
  },
  { path: ROUTE_PATHS.CONTRATOS, element: <ProtectedRole role={ROLE_KEYS.CONTRATOS}><ContractsShell /></ProtectedRole> },
  { path: ROUTE_PATHS.FINANZAS, element: <ProtectedRole role={ROLE_KEYS.FINANZAS}><FinanceShell /></ProtectedRole> },
  { path: '*', element: <ModulePlaceholder icon={AlertTriangleIcon} label="Página no encontrada" description="La ruta que buscas no existe." /> },
]);

export default router;
