import { cloneElement, useState } from 'react';
import { createBrowserRouter, Navigate, useNavigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import PasswordChangePage from '../features/auth/PasswordChangePage';
import { PasswordChangeRequiredError } from '../features/auth/authService';
import { useAuth } from '../features/auth/AuthContext';
import { ROLE_KEYS, ROUTE_PATHS, getRoleHomePath } from '../features/auth/roleRouting';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import HumanResourcesDashboardPage from '../features/human-resources/dashboard/DashboardPage';
import RampProfilesPanel from '../features/human-resources/users/RampProfilesPanel';
import CertificationsPage from '../features/human-resources/certifications/CertificationsPage';
import CurrentQualificationsPage from '../features/human-resources/certifications/CurrentQualificationsPage';
import PermitsPage from '../features/human-resources/permits/PermitsPage';
import SchedulesPage from '../features/human-resources/schedules/SchedulesPage';
import HumanResourcesReportsPage from '../features/human-resources/reports/ReportsRoute';
import AuditRoute from '../features/human-resources/audit/AuditRoute';
import HumanResourcesNotificationsRoute from '../features/human-resources/notifications/NotificationsRoute';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_BASE_PATH, HUMAN_RESOURCES_MODULE_IDS } from '../features/human-resources/navigation';
import { HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO } from '../config/hrDemoMode';
import AdminOccLayout from '../features/admin-occ/AdminOccLayout';
import { AdminOccPreviewProvider } from '../features/admin-occ/AdminOccPreviewContext';
import { ADMIN_OCC_BASE_PATH } from '../features/admin-occ/navigation';
import DashboardRoute from '../features/dashboard/DashboardRoute';
import PlanningRoute from '../features/planning/PlanningRoute';
import FlightMonitoringRoute from '../features/flight-monitoring/FlightMonitoringRoute';
import PositionsMapRoute from '../features/positions-map/PositionsMapRoute';
import ReviewRoute from '../features/review/CanonicalReviewRoute';
import ReportsRoute from '../features/reports/CanonicalReportsRoute';
import NotificationsRoute from '../features/notifications/CanonicalNotificationsRoute';
import ChatRoute from '../features/chat/CanonicalChatRoute';
import ContractsShell from '../features/contracts/shell/ContractsShell';
import FinanceShell from '../features/finance/shell/FinanceShell';
import GovernanceShell from '../features/governance/GovernanceShell';
import CustomWorkspace from '../features/governance/CustomWorkspace';
import { AlertTriangleIcon } from '../features/shell/components/icons';

function LoginRoute() {
  const navigate = useNavigate();
  const { session, login, changePassword } = useAuth();
  const [activationEmail, setActivationEmail] = useState(null);
  const [notice, setNotice] = useState('');
  if (session) return <Navigate to={getRoleHomePath(session.role)} replace />;
  if (activationEmail) return <PasswordChangePage
    email={activationEmail}
    onCancel={() => setActivationEmail(null)}
    onSubmit={async credentials => {
      await changePassword(credentials);
      setActivationEmail(null);
      setNotice('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
    }}
  />;
  return <LoginPage notice={notice} onSubmit={async credentials => {
    try {
      navigate((await login(credentials)).homePath, { replace: true });
    } catch (error) {
      if (error instanceof PasswordChangeRequiredError) {
        setActivationEmail(credentials.email.trim());
        return;
      }
      throw error;
    }
  }} />;
}

function ProtectedRole({ role, children }) {
  const { session, logout } = useAuth();
  if (!session) return <Navigate to={ROUTE_PATHS.LOGIN} replace />;
  if (role === ROLE_KEYS.CUSTOM ? !session.role.startsWith('CUSTOM_') : session.role !== role) return <Navigate to={getRoleHomePath(session.role)} replace />;
  return cloneElement(children, { user: { name: session.name, role: session.roleLabel }, onLogout: logout });
}

function AdminProtectedLayout() {
  const { session, logout } = useAuth();
  if (!session) return <Navigate to={ROUTE_PATHS.LOGIN} replace />;
  if (session.role !== ROLE_KEYS.ADMIN_OCC) return <Navigate to={getRoleHomePath(session.role)} replace />;
  return <AdminOccPreviewProvider><AdminOccLayout user={{ name: session.name, role: session.roleLabel }} onLogout={logout} /></AdminOccPreviewProvider>;
}

export function createHumanResourcesChildren(
  dashboardReadOnlyDemo = HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO,
) {
  const routes = HUMAN_RESOURCES_NAVIGATION.map(item => ({
    path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
    element: item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD
      ? <HumanResourcesDashboardPage dashboardReadOnlyDemo={dashboardReadOnlyDemo} />
      : item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? <RampProfilesPanel />
        : item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS
          ? dashboardReadOnlyDemo ? <CurrentQualificationsPage /> : <CertificationsPage />
          : item.id === HUMAN_RESOURCES_MODULE_IDS.PERMITS ? <PermitsPage />
            : item.id === HUMAN_RESOURCES_MODULE_IDS.SCHEDULES ? <SchedulesPage />
              : item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS ? <HumanResourcesReportsPage />
                : item.id === HUMAN_RESOURCES_MODULE_IDS.AUDIT ? <AuditRoute />
                  : item.id === HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS ? <HumanResourcesNotificationsRoute />
                    : <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />,
  }));

  if (!dashboardReadOnlyDemo) return routes;

  return [
    routes.find(route => route.path === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD),
    routes.find(route => route.path === HUMAN_RESOURCES_MODULE_IDS.USERS),
    routes.find(route => route.path === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS),
    {
      path: '*',
      element: <Navigate to={`${HUMAN_RESOURCES_BASE_PATH}/dashboard`} replace />,
    },
  ];
}

const humanResourcesChildren = createHumanResourcesChildren();

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
  { path: ROUTE_PATHS.SUPERADMIN, element: <ProtectedRole role={ROLE_KEYS.SUPERADMIN}><GovernanceShell /></ProtectedRole> },
  { path: ROUTE_PATHS.CUSTOM, element: <ProtectedRole role={ROLE_KEYS.CUSTOM}><CustomWorkspace /></ProtectedRole> },
  { path: '*', element: <ModulePlaceholder icon={AlertTriangleIcon} label="Página no encontrada" description="La ruta que buscas no existe." /> },
]);

export default router;
