import { useCallback, useEffect, useState } from 'react';
import Sidebar from '../../shell/components/Sidebar';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
import Topbar from '../../dashboard/components/Topbar';
import { usePreviewControls } from '../../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../../shell/useResponsiveSidebar';
import ContractsHomePage from '../home/ContractsHomePage';
import { useContractsHomeData } from '../home/useContractsHomeData';
import ManagedAgreementsPage from '../agreements/ManagedAgreementsPage';
import CommercialIntakePage from '../requests/CommercialIntakePage';
import CommercialCatalogPage from '../catalog/CommercialCatalogPage';
import ManagedDraftsPage from '../drafts/ManagedDraftsPage';
import { CONTRACT_MODULES, CONTRACT_MODULE_IDS } from './modules';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';

const CURRENT_USER = { name: 'Usuario de Contratos', role: 'Departamento de Contratos' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function ContractsShell({ user = CURRENT_USER, onLogout }) {
  const [activeModuleId, setActiveModuleId] = useState(CONTRACT_MODULE_IDS.HOME);
  const [retryToken, setRetryToken] = useState(0);
  const home = useContractsHomeData(retryToken);
  const pendingReal = home.data?.kpis?.pendingRequests ?? 0;
  const revalidateHome = useCallback(() => setRetryToken(token => token + 1), []);
  useCommercialRevalidation(revalidateHome);
  const { theme, toggleTheme } = usePreviewControls();
  const sidebar = useResponsiveSidebar();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => ['commercial_requests',
        'contract_draft_comments', 'airline_contracts'].includes(resource))) {
        revalidateHome();
      }
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [revalidateHome]);

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
            <ContractsHomePage status={home.status} data={home.data} error={home.error} onRetry={revalidateHome} onNavigate={handleSelectModule} />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CONTRACTS ? (
            <ManagedAgreementsPage mode="contracts" />
          ) : activeModule.id === CONTRACT_MODULE_IDS.DRAFTS ? (
            <ManagedDraftsPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REQUESTS ? (
            <CommercialIntakePage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CATALOG ? (
            <CommercialCatalogPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.SERVICES ? (
            <ManagedAgreementsPage mode="services" />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REPORTS ? (
            <ManagedAgreementsPage mode="reports" />
          ) : (
            <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />
          )}
        </main>
      </div>
    </div>
  );
}
