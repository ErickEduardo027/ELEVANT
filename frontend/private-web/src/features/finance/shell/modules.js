import {
  ApprovedServicesIcon,
  HomeIcon,
  PreInvoiceIcon,
  ReconciliationIcon,
  ReportIcon,
  TariffIcon,
} from '../components/icons';
import { ShieldCheckIcon, UsersIcon } from '../../shell/components/icons';

export const FINANCE_MODULE_IDS = {
  HOME: 'finance-home',
  CONTRACT_APPROVALS: 'finance-contract-approvals',
  APPROVED_SERVICES: 'finance-approved-services',
  PREINVOICES: 'finance-preinvoices',
  RECONCILIATION: 'finance-reconciliation',
  TARIFF_BOOKS: 'finance-tariff-books',
  TARIFFS: 'finance-tariffs',
  CHARGES: 'finance-charges',
  EXCHANGE_RATES: 'finance-exchange-rates',
  REPORTS: 'finance-reports',
  USERS: 'finance-users',
};

export const FINANCE_MODULES = [
  { id: FINANCE_MODULE_IDS.HOME, permission: 'finance.home.read', label: 'Inicio', icon: HomeIcon, description: 'Resumen financiero y tareas pendientes.' },
  { id: FINANCE_MODULE_IDS.CONTRACT_APPROVALS, permission: 'finance.contract_approvals.read', label: 'Aprobación de contratos', icon: ShieldCheckIcon, description: 'Contratos enviados por Contratos frente a la tarifa base.' },
  { id: FINANCE_MODULE_IDS.APPROVED_SERVICES, permission: 'finance.approved_services.read', label: 'Servicios aprobados', icon: ApprovedServicesIcon, description: 'Consulta y filtrado de servicios aprobados por aerolínea o período.' },
  { id: FINANCE_MODULE_IDS.PREINVOICES, permission: 'finance.preinvoices.read', label: 'Pre-facturación', icon: PreInvoiceIcon, description: 'Prefacturas con sus servicios, cargos y ajustes.' },
  { id: FINANCE_MODULE_IDS.RECONCILIATION, permission: 'finance.reconciliation.read', label: 'Facturas y cobros', icon: ReconciliationIcon, description: 'Facturas no fiscales, saldos, pagos parciales y notas de crédito.' },
  {
    id: FINANCE_MODULE_IDS.TARIFF_BOOKS, label: 'Tarifarios', icon: TariffIcon, description: 'Tarifa base, cargos y tasas de cambio.',
    children: [
      { id: FINANCE_MODULE_IDS.TARIFFS, permission: 'finance.tariffs.read', label: 'Tarifario de servicios' },
      { id: FINANCE_MODULE_IDS.CHARGES, permission: 'finance.charges.read', label: 'Tarifario de cargos' },
      { id: FINANCE_MODULE_IDS.EXCHANGE_RATES, permission: 'finance.exchange_rates.read', label: 'Tasas de cambio' },
    ],
  },
  { id: FINANCE_MODULE_IDS.REPORTS, permission: 'finance.reports.read', label: 'Reportes', icon: ReportIcon, description: 'Ingresos, cobranza, antigüedad, cargos, disputas y tarifas.' },
  { id: FINANCE_MODULE_IDS.USERS, administratorsOnly: true, label: 'Usuarios del departamento', icon: UsersIcon, description: 'Usuarios, plantillas y solicitudes de alta de Finanzas.' },
];

/** Navigation the account may open: groups keep only their permitted sub-items and vanish when none remain. */
export function financeNavigation(allowed) {
  return FINANCE_MODULES.map(module => (module.children
    ? { ...module, children: module.children.filter(child => allowed(child)) }
    : module))
    .filter(module => (module.children ? module.children.length > 0 : allowed(module)));
}

/** Every selectable module, groups flattened into their sub-items. */
export function selectableModules(navigation) {
  return navigation.flatMap(module => (module.children
    ? module.children.map(child => ({ ...child, icon: module.icon, description: module.description }))
    : [module]));
}
