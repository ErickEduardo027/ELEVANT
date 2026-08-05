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

const CURRENT_USER = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

function fallbackStation() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function AppShell() {
  const [activeModuleId, setActiveModuleId] = useState(MODULE_IDS.DASHBOARD);
  const [retryToken, setRetryToken] = useState(0);

  const { status, data, error } = useDashboardData('PUJ', retryToken);
  const { theme, toggleTheme, forceState, setForceState } = usePreviewControls();
  const sidebar = useResponsiveSidebar();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const activeModule = MODULES.find(module => module.id === activeModuleId) ?? MODULES[0];

  function handleSelectModule(id) {
    setActiveModuleId(id);
    sidebar.closeOverlay();
  }

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar
        modules={MODULES}
        activeModuleId={activeModuleId}
        onSelectModule={handleSelectModule}
        badgeCounts={{ [MODULE_IDS.APPROVALS]: data?.kpis?.approvalsPending ?? 0 }}
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
          notificationsCount={data?.alerts?.length ?? 0}
          theme={theme}
          onToggleTheme={toggleTheme}
          user={CURRENT_USER}
          onOpenMenu={sidebar.toggle}
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
