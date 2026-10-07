import { useEffect, useState } from 'react';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
import ShellFrame from '../../shell/ShellFrame';
import { usePreviewControls } from '../../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../../shell/useResponsiveSidebar';
import FinanceHomePage from '../home/FinanceHomePage';
import { useFinanceHomeData } from '../home/useFinanceHomeData';
import ApprovedServicesPage from '../approved-services/ApprovedServicesPage';
import PreinvoicesPage from '../preinvoices/PreinvoicesPage';
import ReconciliationPage from '../reconciliation/ReconciliationPage';
import TariffsPage from '../tariffs/TariffsPage';
import FinanceReportsPage from '../reports/FinanceReportsPage';
import { FINANCE_MODULES, FINANCE_MODULE_IDS } from './modules';

const CURRENT_USER = { name: 'Usuario de Finanzas', role: 'Departamento de Finanzas' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function FinanceShell({ user = CURRENT_USER, onLogout }) {
  const [activeModuleId, setActiveModuleId] = useState(FINANCE_MODULE_IDS.HOME);
  const home = useFinanceHomeData(activeModuleId === FINANCE_MODULE_IDS.HOME);
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
    <ShellFrame
      mainKey={activeModule.id}
      sidebarProps={{ modules: FINANCE_MODULES, activeModuleId, onSelectModule: handleSelectModule, badgeCounts: {}, user, onLogout, breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible, railExpanded: sidebar.railExpanded, overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle, onCloseOverlay: sidebar.closeOverlay }}
      topbarProps={{ station: stationSnapshot(), notificationsEnabled: false, theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout }}
    >
          {activeModule.id === FINANCE_MODULE_IDS.HOME ? <FinanceHomePage status={home.status} data={home.data} stations={home.stations} stationId={home.stationId} onStationChange={home.setStationId} onRetry={home.refresh} onNavigate={handleSelectModule} /> : activeModule.id === FINANCE_MODULE_IDS.APPROVED_SERVICES ? <ApprovedServicesPage initialStationId={home.stationId} /> : activeModule.id === FINANCE_MODULE_IDS.PREINVOICES ? <PreinvoicesPage initialStationId={home.stationId} /> : activeModule.id === FINANCE_MODULE_IDS.RECONCILIATION ? <ReconciliationPage initialStationId={home.stationId} /> : activeModule.id === FINANCE_MODULE_IDS.TARIFFS ? <TariffsPage initialStationId={home.stationId} /> : activeModule.id === FINANCE_MODULE_IDS.REPORTS ? <FinanceReportsPage initialStationId={home.stationId} /> : <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />}
    </ShellFrame>
  );
}
