import { useEffect, useState } from 'react';
import Topbar from '../../dashboard/components/Topbar';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
import Sidebar from '../../shell/components/Sidebar';
import { usePreviewControls } from '../../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../../shell/useResponsiveSidebar';
import FinanceHomePage from '../home/FinanceHomePage';
import { useFinanceHomeData } from '../home/useFinanceHomeData';
import ApprovedServicesPage from '../approved-services/ApprovedServicesPage';
import PreinvoicesPage from '../preinvoices/PreinvoicesPage';
import ReconciliationPage from '../reconciliation/ReconciliationPage';
import TariffsPage from '../tariffs/TariffsPage';
import { FINANCE_MODULES, FINANCE_MODULE_IDS } from './modules';

const CURRENT_USER = { name: 'Usuario de Finanzas', role: 'Departamento de Finanzas' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function FinanceShell() {
  const [activeModuleId, setActiveModuleId] = useState(FINANCE_MODULE_IDS.HOME);
  const [retryToken, setRetryToken] = useState(0);
  const home = useFinanceHomeData(retryToken);
  const { theme, toggleTheme } = usePreviewControls();
  const sidebar = useResponsiveSidebar();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const activeModule = FINANCE_MODULES.find(module => module.id === activeModuleId) ?? FINANCE_MODULES[0];

  function handleSelectModule(id) {
    setActiveModuleId(id);
    sidebar.closeOverlay();
  }

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar modules={FINANCE_MODULES} activeModuleId={activeModuleId} onSelectModule={handleSelectModule} badgeCounts={{ [FINANCE_MODULE_IDS.PREINVOICES]: home.data?.kpis?.draftPreinvoices ?? 0, [FINANCE_MODULE_IDS.RECONCILIATION]: home.data?.kpis?.reconciliationDifferences ?? 0 }} user={CURRENT_USER} breakpoint={sidebar.breakpoint} railVisible={sidebar.railVisible} railExpanded={sidebar.railExpanded} overlayOpen={sidebar.overlayOpen} onToggle={sidebar.toggle} onCloseOverlay={sidebar.closeOverlay} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar station={stationSnapshot()} notificationsCount={0} theme={theme} onToggleTheme={toggleTheme} user={CURRENT_USER} onOpenMenu={sidebar.toggle} onOpenNotifications={() => {}} />
        <main key={activeModule.id} className="flex-1 overflow-y-auto p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6">
          {activeModule.id === FINANCE_MODULE_IDS.HOME ? <FinanceHomePage status={home.status} data={home.data} error={home.error} onRetry={() => setRetryToken(token => token + 1)} onNavigate={handleSelectModule} /> : activeModule.id === FINANCE_MODULE_IDS.APPROVED_SERVICES ? <ApprovedServicesPage /> : activeModule.id === FINANCE_MODULE_IDS.PREINVOICES ? <PreinvoicesPage /> : activeModule.id === FINANCE_MODULE_IDS.RECONCILIATION ? <ReconciliationPage /> : activeModule.id === FINANCE_MODULE_IDS.TARIFFS ? <TariffsPage /> : <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />}
        </main>
      </div>
    </div>
  );
}
