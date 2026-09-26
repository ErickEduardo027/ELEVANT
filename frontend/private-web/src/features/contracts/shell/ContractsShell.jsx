import { useEffect, useState } from 'react';
import Sidebar from '../../shell/components/Sidebar';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
import Topbar from '../../dashboard/components/Topbar';
import { usePreviewControls } from '../../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../../shell/useResponsiveSidebar';
import ContractsHomePage from '../home/ContractsHomePage';
import { useContractsHomeData } from '../home/useContractsHomeData';
import ContractsPage from '../contracts/ContractsPage';
import CommercialIntakePage from '../requests/CommercialIntakePage';
import ContractServicesPage from '../services/ContractServicesPage';
import CommercialCatalogPage from '../catalog/CommercialCatalogPage';
import ManagedDraftsPage from '../drafts/ManagedDraftsPage';
import ContractReportsPage from '../reports/ContractReportsPage';
import DepartmentChatPage from '../../internal-chat/DepartmentChatPage';
import { CONTRACT_MODULES, CONTRACT_MODULE_IDS } from './modules';
import { getCommercialRequests } from '../../../services/commercialGovernanceApi';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';

const CURRENT_USER = { name: 'Usuario de Contratos', role: 'Departamento de Contratos' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function ContractsShell({ user = CURRENT_USER, onLogout }) {
  const [activeModuleId, setActiveModuleId] = useState(CONTRACT_MODULE_IDS.HOME);
  const [retryToken, setRetryToken] = useState(0);
  const [pendingReal, setPendingReal] = useState(0);
  const home = useContractsHomeData(retryToken);
  const { theme, toggleTheme } = usePreviewControls();
  const sidebar = useResponsiveSidebar();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return undefined;
    let mounted = true;
    const load = () => getCommercialRequests().then(requests => {
      if (mounted) setPendingReal(requests.filter(request => ['Pending', 'InReview'].includes(request.status)).length);
    }).catch(() => {});
    void load();
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('commercial_requests')) {
        void load();
        setRetryToken(token => token + 1);
      }
    });
    void observer.start();
    return () => { mounted = false; void observer.stop(); };
  }, []);

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
        badgeCounts={{ [CONTRACT_MODULE_IDS.REQUESTS]: pendingReal }}
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
        <Topbar station={stationSnapshot()} notificationsEnabled={false} theme={theme} onToggleTheme={toggleTheme} user={user} onOpenMenu={sidebar.toggle} onLogout={onLogout} />
        <main key={activeModule.id} className="min-w-0 flex-1 overflow-y-auto p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6">
          {activeModule.id === CONTRACT_MODULE_IDS.HOME ? (
            <><div className="mx-auto mb-4 flex max-w-[1440px] items-center justify-between rounded-xl border border-accent-600/20 bg-accent-600/5 p-4 text-sm"><span><strong>{pendingReal}</strong> solicitudes comerciales pendientes de revisión.</span><button type="button" onClick={() => handleSelectModule(CONTRACT_MODULE_IDS.REQUESTS)} className="font-semibold text-accent-600">Abrir bandeja →</button></div><ContractsHomePage status={home.status} data={home.data} error={home.error} onRetry={() => setRetryToken(token => token + 1)} onNavigate={handleSelectModule} /></>
          ) : activeModule.id === CONTRACT_MODULE_IDS.CONTRACTS ? (
            <ContractsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.DRAFTS ? (
            <ManagedDraftsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REQUESTS ? (
            <CommercialIntakePage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CATALOG ? (
            <CommercialCatalogPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.SERVICES ? (
            <ContractServicesPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REPORTS ? (
            <ContractReportsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CHAT ? (
            <DepartmentChatPage />
          ) : (
            <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />
          )}
        </main>
      </div>
    </div>
  );
}
