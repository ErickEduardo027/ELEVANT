import { useEffect, useMemo, useState } from 'react';
import ModulePlaceholder from '../../shell/components/ModulePlaceholder';
import ShellFrame from '../../shell/ShellFrame';
import { useDepartmentNotificationCenter } from '../../notifications/DepartmentNotificationCenter';
import { usePreviewControls } from '../../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../../shell/useResponsiveSidebar';
import FinanceHomePage from '../home/FinanceHomePage';
import { useFinanceHomeData } from '../home/useFinanceHomeData';
import ApprovedServicesPage from '../approved-services/ApprovedServicesPage';
import PreinvoicesPage from '../preinvoices/PreinvoicesPage';
import InvoicesPage from '../invoices/InvoicesPage';
import ServiceTariffsPage from '../tariffs/ServiceTariffsPage';
import ChargesPage from '../charges/ChargesPage';
import ExchangeRatesPage from '../exchange-rates/ExchangeRatesPage';
import ContractApprovalsPage from '../contract-approvals/ContractApprovalsPage';
import ChartersPage from '../charters/ChartersPage';
import FinanceReportsPage from '../reports/FinanceReportsPage';
import BillingUnitsPage from '../billing-units/BillingUnitsPage';
import PackagesPage from '../packages/PackagesPage';
import TreasuryPage from '../treasury/TreasuryPage';
import StatementPage from '../treasury/StatementPage';
import SuppliersPage from '../payables/SuppliersPage';
import PayablesPage from '../payables/PayablesPage';
import ExpensesPage from '../payables/ExpensesPage';
import FiscalDocumentsPage from '../fiscal/FiscalDocumentsPage';
import TaxPoliciesPage from '../taxes/TaxPoliciesPage';
import { FINANCE_MODULE_IDS, financeNavigation, selectableModules } from './modules';
import { allowedNavigation, useDepartmentAccess } from '../../access/DepartmentAccessContext';
import NoModulesNotice from '../../access/NoModulesNotice';
import DepartmentUsersPage from '../../department-users/DepartmentUsersPage';
import { DEPARTMENTS } from '../../../services/departmentGovernanceService';

const CURRENT_USER = { name: 'Usuario de Finanzas', role: 'Departamento de Finanzas' };

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

/**
 * `observeNotifications` turns on the bell, toasts and drawer; tests switch it on explicitly
 * instead of the shell guessing the environment.
 */
export default function FinanceShell({ user = CURRENT_USER, onLogout, observeNotifications = process.env.NODE_ENV !== 'test' }) {
  const { access } = useDepartmentAccess();
  const navigation = useMemo(() => financeNavigation(item => allowedNavigation([item], access).length > 0), [access]);
  const modules = useMemo(() => selectableModules(navigation), [navigation]);
  const [activeModuleId, setActiveModuleId] = useState(FINANCE_MODULE_IDS.HOME);
  const activeModule = modules.find(module => module.id === activeModuleId) ?? modules[0];
  const home = useFinanceHomeData(activeModule?.id === FINANCE_MODULE_IDS.HOME);
  const { theme, toggleTheme } = usePreviewControls();
  const sidebar = useResponsiveSidebar();
  const notificationCenter = useDepartmentNotificationCenter({
    enabled: observeNotifications && Boolean(access?.can('finance.notifications.read')),
    onOpen: target => target.moduleId && handleSelectModule(target.moduleId),
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);


  function handleSelectModule(id) {
    setActiveModuleId(id);
    sidebar.closeOverlay();
  }

  const stationProps = { initialStationId: home.stationId };
  const pages = {
    [FINANCE_MODULE_IDS.USERS]: <DepartmentUsersPage department={DEPARTMENTS.FINANCE} />,
    [FINANCE_MODULE_IDS.HOME]: <FinanceHomePage status={home.status} data={home.data} stations={home.stations} stationId={home.stationId} onStationChange={home.setStationId} onRetry={home.refresh} onNavigate={handleSelectModule} />,
    [FINANCE_MODULE_IDS.APPROVED_SERVICES]: <ApprovedServicesPage {...stationProps} />,
    [FINANCE_MODULE_IDS.PREINVOICES]: <PreinvoicesPage {...stationProps} />,
    [FINANCE_MODULE_IDS.RECONCILIATION]: <InvoicesPage {...stationProps} />,
    [FINANCE_MODULE_IDS.TARIFFS]: <ServiceTariffsPage {...stationProps} />,
    [FINANCE_MODULE_IDS.PACKAGES]: <PackagesPage />,
    [FINANCE_MODULE_IDS.CHARGES]: <ChargesPage />,
    [FINANCE_MODULE_IDS.EXCHANGE_RATES]: <ExchangeRatesPage />,
    [FINANCE_MODULE_IDS.BILLING_UNITS]: <BillingUnitsPage canCreate={Boolean(access?.can('finance.billing_units.create'))} canUpdate={Boolean(access?.can('finance.billing_units.update'))} />,
    [FINANCE_MODULE_IDS.CONTRACT_APPROVALS]: <ContractApprovalsPage />,
    [FINANCE_MODULE_IDS.CHARTERS]: <ChartersPage />,
    [FINANCE_MODULE_IDS.TREASURY]: <TreasuryPage {...stationProps} />,
    [FINANCE_MODULE_IDS.STATEMENTS]: <StatementPage {...stationProps} />,
    [FINANCE_MODULE_IDS.SUPPLIERS]: <SuppliersPage />,
    [FINANCE_MODULE_IDS.PAYABLES]: <PayablesPage />,
    [FINANCE_MODULE_IDS.EXPENSES]: <ExpensesPage />,
    [FINANCE_MODULE_IDS.TAXES]: <TaxPoliciesPage />,
    [FINANCE_MODULE_IDS.FISCAL]: <FiscalDocumentsPage {...stationProps} />,
    [FINANCE_MODULE_IDS.REPORTS]: <FinanceReportsPage {...stationProps} />,
  };

  return (
    <ShellFrame
      mainKey={activeModule?.id ?? 'none'}
      sidebarProps={{ modules: navigation, activeModuleId: activeModule?.id, onSelectModule: handleSelectModule, badgeCounts: {}, user, onLogout, breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible, railExpanded: sidebar.railExpanded, overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle, onCloseOverlay: sidebar.closeOverlay }}
      topbarProps={{ station: stationSnapshot(), notificationsEnabled: notificationCenter.ui !== null, notificationsCount: notificationCenter.count, onOpenNotifications: notificationCenter.openPanel, theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout }}
    >
      {!activeModule ? <NoModulesNotice /> : pages[activeModule.id] ?? <ModulePlaceholder icon={activeModule.icon} label={activeModule.label} description={activeModule.description} />}
      {notificationCenter.ui}
    </ShellFrame>
  );
}
