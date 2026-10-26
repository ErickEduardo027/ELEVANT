import { useCallback, useEffect, useMemo, useState } from 'react';
import ShellFrame from '../../shell/ShellFrame';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
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
import { getServiceClosures } from '../../../services/commercialGovernanceApi';
import { allowedNavigation, useDepartmentAccess } from '../../access/DepartmentAccessContext';
import NoModulesNotice from '../../access/NoModulesNotice';
import DepartmentUsersPage from '../../department-users/DepartmentUsersPage';
import DepartmentExpensesPage from '../../finance/payables/DepartmentExpensesPage';
import { DEPARTMENTS } from '../../../services/departmentGovernanceService';

const CURRENT_USER = { name: 'Usuario de Contratos', role: 'Departamento de Contratos' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

export default function ContractsShell({ user = CURRENT_USER, onLogout }) {
  const { access } = useDepartmentAccess();
  const modules = useMemo(() => allowedNavigation(CONTRACT_MODULES, access), [access]);
  const can = code => access?.can(code) ?? false;
  const [activeModuleId, setActiveModuleId] = useState(CONTRACT_MODULE_IDS.HOME);
  const [retryToken, setRetryToken] = useState(0);
  const [pendingClosures, setPendingClosures] = useState(0);
  const home = useContractsHomeData(retryToken);
  const pendingReal = home.data?.kpis?.pendingRequests ?? 0;
  const revalidateHome = useCallback(() => setRetryToken(token => token + 1), []);
  useCommercialRevalidation(revalidateHome);
  const revalidateClosures = useCallback(async () => {
    try { setPendingClosures((await getServiceClosures('Pending', 1)).pendingCount); }
    catch { /* The inbox will retry on focus, feed or polling. */ }
  }, []);
  useEffect(() => { void revalidateClosures(); }, [revalidateClosures]);
  useCommercialRevalidation(revalidateClosures);
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
      if (resources.includes('service_closures')) void revalidateClosures();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [revalidateHome, revalidateClosures]);

  const activeModule = modules.find(module => module.id === activeModuleId) ?? modules[0];

  function handleSelectModule(id) {
    setActiveModuleId(id);
    sidebar.closeOverlay();
  }

  return (
    <ShellFrame
      mainKey={activeModule?.id ?? 'none'}
      sidebarProps={{
        modules,
        activeModuleId: activeModule?.id,
        onSelectModule: handleSelectModule,
        badgeCounts: { [CONTRACT_MODULE_IDS.REQUESTS]: pendingReal, [CONTRACT_MODULE_IDS.CATALOG]: pendingClosures },
        user,
        onLogout,
        breakpoint: sidebar.breakpoint,
        railVisible: sidebar.railVisible,
        railExpanded: sidebar.railExpanded,
        overlayOpen: sidebar.overlayOpen,
        onToggle: sidebar.toggle,
        onCloseOverlay: sidebar.closeOverlay,
      }}
      topbarProps={{ station: stationSnapshot(), notificationsEnabled: false, theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout }}
    >
          {!activeModule ? (
            <NoModulesNotice />
          ) : activeModule.id === CONTRACT_MODULE_IDS.HOME ? (
            <ContractsHomePage status={home.status} data={home.data} error={home.error} onRetry={revalidateHome} onNavigate={handleSelectModule} />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CONTRACTS ? (
            <ManagedAgreementsPage mode="contracts" />
          ) : activeModule.id === CONTRACT_MODULE_IDS.DRAFTS ? (
            <ManagedDraftsPage canEdit={can('contracts.drafts.edit')} canActivate={can('contracts.drafts.activate')} />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REQUESTS ? (
            <CommercialIntakePage canVerify={can('contracts.requests.verify')} canApprove={can('contracts.requests.approve')} canReject={can('contracts.requests.reject')} />
          ) : activeModule.id === CONTRACT_MODULE_IDS.CATALOG ? (
            <CommercialCatalogPage canCreate={can('contracts.catalog.create')} canEdit={can('contracts.catalog.edit')} canRetire={can('contracts.catalog.retire')} canSeeClosures={can('contracts.service_closures.read')} />
          ) : activeModule.id === CONTRACT_MODULE_IDS.SERVICES ? (
            <ManagedAgreementsPage mode="services" />
          ) : activeModule.id === CONTRACT_MODULE_IDS.REPORTS ? (
            <ManagedAgreementsPage mode="reports" />
          ) : activeModule.id === CONTRACT_MODULE_IDS.EXPENSES ? (
            <DepartmentExpensesPage />
          ) : activeModule.id === CONTRACT_MODULE_IDS.USERS ? (
            <DepartmentUsersPage department={DEPARTMENTS.CONTRACTS} />
          ) : (
            <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />
          )}
    </ShellFrame>
  );
}
