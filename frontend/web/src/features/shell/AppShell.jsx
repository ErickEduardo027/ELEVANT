import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ModulePlaceholder from './components/ModulePlaceholder';
import { MODULES, MODULE_IDS } from './modules';
import { useResponsiveSidebar } from './useResponsiveSidebar';
import Topbar from '../dashboard/components/Topbar';
import DevPreviewPanel from '../dashboard/components/DevPreviewPanel';
import DashboardPage from '../dashboard/DashboardPage';
import { useDashboardData } from '../dashboard/useDashboardData';
import { usePreviewControls } from '../dashboard/usePreviewControls';
import PlanningPage from '../planning/PlanningPage';
import { usePlanningData } from '../planning/usePlanningData';
import FlightMonitoringPage from '../flight-monitoring/FlightMonitoringPage';
import { useFlightMonitoringData } from '../flight-monitoring/useFlightMonitoringData';
import ReviewPage from '../review/ReviewPage';
import { useReviewData } from '../review/useReviewData';
import ReportsPage from '../reports/ReportsPage';
import NotificationsPage from '../notifications/NotificationsPage';
import { useNotificationsData } from '../notifications/useNotificationsData';

const CURRENT_USER = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

function fallbackStation() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function AppShell() {
  const [activeModuleId, setActiveModuleId] = useState(MODULE_IDS.DASHBOARD);
  const [retryToken, setRetryToken] = useState(0);

  const { status, data, error } = useDashboardData('PUJ', retryToken);
  const [planningRetryToken, setPlanningRetryToken] = useState(0);
  const planning = usePlanningData('PUJ', undefined, planningRetryToken);
  const { theme, toggleTheme, forceState, setForceState } = usePreviewControls();
  const [monitoringRetryToken, setMonitoringRetryToken] = useState(0);
  const monitoring = useFlightMonitoringData(
    'PUJ',
    monitoringRetryToken,
    forceState === 'monitoringDisconnected'
  );
  const [reviewRetryToken, setReviewRetryToken] = useState(0);
  const review = useReviewData('PUJ', reviewRetryToken);
  const [notificationsRetryToken, setNotificationsRetryToken] = useState(0);
  const notifications = useNotificationsData('PUJ', notificationsRetryToken);
  const [focusResource, setFocusResource] = useState(null);
  const sidebar = useResponsiveSidebar();

  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  useEffect(() => {
    if (notifications.status !== 'success') return;
    setUnreadNotificationsCount(notifications.data?.notifications?.filter(item => !item.read).length ?? 0);
  }, [notifications.status, notifications.data]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const activeModule = MODULES.find(module => module.id === activeModuleId) ?? MODULES[0];

  function handleSelectModule(id) {
    setActiveModuleId(id);
    setFocusResource(null);
    sidebar.closeOverlay();
  }

  function handleNavigateFromNotification(moduleId, resourceId) {
    setActiveModuleId(moduleId);
    setFocusResource(
      moduleId === MODULE_IDS.FLIGHT_MONITORING
        ? { flightId: resourceId }
        : moduleId === MODULE_IDS.APPROVALS
          ? { operationId: resourceId }
          : null
    );
    sidebar.closeOverlay();
  }

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar
        modules={MODULES}
        activeModuleId={activeModuleId}
        onSelectModule={handleSelectModule}
        badgeCounts={{
          [MODULE_IDS.APPROVALS]: data?.kpis?.approvalsPending ?? 0,
          [MODULE_IDS.NOTIFICATIONS]: unreadNotificationsCount,
        }}
        user={CURRENT_USER}
        breakpoint={sidebar.breakpoint}
        railVisible={sidebar.railVisible}
        railExpanded={sidebar.railExpanded}
        overlayOpen={sidebar.overlayOpen}
        onToggle={sidebar.toggle}
        onCloseOverlay={sidebar.closeOverlay}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          station={data?.station ?? fallbackStation()}
          notificationsCount={unreadNotificationsCount}
          theme={theme}
          onToggleTheme={toggleTheme}
          user={CURRENT_USER}
          onOpenMenu={sidebar.toggle}
          onOpenNotifications={() => handleSelectModule(MODULE_IDS.NOTIFICATIONS)}
        />

        <main key={activeModule.id} className="flex-1 overflow-y-auto p-6 [animation:elevant-fade-in_180ms_ease-out]">
          {activeModule.id === MODULE_IDS.DASHBOARD ? (
            <DashboardPage
              status={status}
              data={data}
              error={error}
              onRetry={() => setRetryToken(token => token + 1)}
              forceState={forceState}
            />
          ) : activeModule.id === MODULE_IDS.PLANNING ? (
            <PlanningPage
              status={planning.status}
              data={planning.data}
              error={planning.error}
              onRetry={() => setPlanningRetryToken(token => token + 1)}
              forceState={forceState}
            />
          ) : activeModule.id === MODULE_IDS.FLIGHT_MONITORING ? (
            <FlightMonitoringPage
              status={monitoring.status}
              data={monitoring.data}
              error={monitoring.error}
              connection={monitoring.connection}
              lastUpdatedAt={monitoring.lastUpdatedAt}
              onRetry={() => setMonitoringRetryToken(token => token + 1)}
              forceState={forceState}
              theme={theme}
              focusFlightId={focusResource?.flightId}
            />
          ) : activeModule.id === MODULE_IDS.APPROVALS ? (
            <ReviewPage
              status={review.status}
              data={review.data}
              error={review.error}
              onRetry={() => setReviewRetryToken(token => token + 1)}
              onApprove={review.approveOperation}
              onReturn={review.returnOperation}
              onBulkApprove={review.bulkApprove}
              onBulkReturn={review.bulkReturn}
              forceState={forceState}
              focusOperationId={focusResource?.operationId}
            />
          ) : activeModule.id === MODULE_IDS.REPORTS ? (
            <ReportsPage forceState={forceState} />
          ) : activeModule.id === MODULE_IDS.NOTIFICATIONS ? (
            <NotificationsPage
              status={notifications.status}
              data={notifications.data}
              error={notifications.error}
              onRetry={() => setNotificationsRetryToken(token => token + 1)}
              onMarkAsRead={notifications.markAsRead}
              onMarkAsUnread={notifications.markAsUnread}
              onMarkManyAsRead={notifications.markManyAsRead}
              onMarkManyAsUnread={notifications.markManyAsUnread}
              onMarkAllAsRead={notifications.markAllAsRead}
              onNavigateToResource={handleNavigateFromNotification}
              forceState={forceState}
            />
          ) : (
            <ModulePlaceholder
              icon={activeModule.icon}
              label={activeModule.label}
              description={activeModule.description}
            />
          )}
        </main>
      </div>

      <DevPreviewPanel theme={theme} forceState={forceState} onToggleTheme={toggleTheme} onSetForceState={setForceState} />
    </div>
  );
}
