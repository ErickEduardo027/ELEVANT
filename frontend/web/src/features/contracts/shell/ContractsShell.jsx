import { useEffect, useState } from 'react';
import Sidebar from '../../shell/components/Sidebar';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
import Topbar from '../../dashboard/components/Topbar';
import { usePreviewControls } from '../../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../../shell/useResponsiveSidebar';
import ContractsHomePage from '../home/ContractsHomePage';
import { useContractsHomeData } from '../home/useContractsHomeData';
import ContractsPage from '../contracts/ContractsPage';
import ContractRequestsPage from '../requests/ContractRequestsPage';
import ContractServicesPage from '../services/ContractServicesPage';
import ContractReportsPage from '../reports/ContractReportsPage';
import ContractCommunicationsPage from '../communications/ContractCommunicationsPage';
import { CONTRACT_MODULES, CONTRACT_MODULE_IDS } from './modules';
import useNotificationBadge from '../../notifications/useNotificationBadge';

const CURRENT_USER = { name: 'Usuario de Contratos', role: 'Departamento de Contratos' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function ContractsShell({ user = CURRENT_USER, onLogout }) {
  const [activeModuleId, setActiveModuleId] = useState(CONTRACT_MODULE_IDS.HOME);
  const [retryToken, setRetryToken] = useState(0);
  const home = useContractsHomeData(retryToken);
  const { theme, toggleTheme } = usePreviewControls();
  const sidebar = useResponsiveSidebar();
  const notifications = useNotificationBadge();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const activeModule = CONTRACT_MODULES.find(module => module.id === activeModuleId) ?? CONTRACT_MODULES[0];

  function handleSelectModule(id) {
    setActiveModuleId(id);
    sidebar.closeOverlay();
  }

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar
        modules={CONTRACT_MODULES}
        activeModuleId={activeModuleId}
        onSelectModule={handleSelectModule}
        badgeCounts={{ [CONTRACT_MODULE_IDS.REQUESTS]: home.data?.kpis?.pendingRequests ?? 0 }}
        user={user}
        onLogout={onLogout}
        breakpoint={sidebar.breakpoint}
        railVisible={sidebar.railVisible}
        railExpanded={sidebar.railExpanded}
        overlayOpen={sidebar.overlayOpen}
        onToggle={sidebar.toggle}
        onCloseOverlay={sidebar.closeOverlay}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar station={stationSnapshot()} notificationsCount={notifications.count} notificationCenter={notifications} theme={theme} onToggleTheme={toggleTheme} user={user} onOpenMenu={sidebar.toggle} onOpenNotifications={notifications.refresh} onLogout={onLogout} />
        <main key={activeModule.id} className="min-w-0 flex-1 overflow-y-auto p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6">
          {activeModule.id === CONTRACT_MODULE_IDS.HOME ? (
            <ContractsHomePage status={home.status} data={home.data} error={home.error} onRetry={() => setRetryToken(token => token + 1)} onNavigate={handleSelectModule} />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CONTRACTS ? (
            <ContractsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REQUESTS ? (
            <ContractRequestsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.SERVICES ? (
            <ContractServicesPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REPORTS ? (
            <ContractReportsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CHAT ? (
            <ContractCommunicationsPage />
          ) : (
            <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />
          )}
        </main>
      </div>
    </div>
  );
}
