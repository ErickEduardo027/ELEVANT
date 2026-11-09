import {
  HomeIcon,
  PayablesIcon,
  PreInvoiceIcon,
  ReportIcon,
  SettingsIcon,
} from '../components/icons';
import { UsersIcon } from '../../shell/components/icons';

export const FINANCE_MODULE_IDS = {
  HOME: 'finance-home',
  INVOICING: 'finance-invoicing',
  TO_INVOICE: 'finance-to-invoice',
  RECONCILIATION: 'finance-reconciliation',
  CHARTERS: 'finance-charters',
  PAYABLES_GROUP: 'finance-payables-group',
  PAYABLES: 'finance-payables',
  SUPPLIERS: 'finance-suppliers',
  EXPENSES: 'finance-expenses',
  REPORTS: 'finance-reports',
  CONFIGURATION: 'finance-configuration',
  TARIFFS: 'finance-tariffs',
  CHARGES: 'finance-charges',
  PACKAGES: 'finance-packages',
  CLOSE_RULES: 'finance-close-rules',
  CONTRACT_APPROVALS: 'finance-contract-approvals',
  EXCHANGE_RATES: 'finance-exchange-rates',
  BILLING_UNITS: 'finance-billing-units',
  USERS: 'finance-users',
};

/**
 * The menu of the simplified Finance (4-A, ADR-0035 block 3): Inicio · Facturación · Cuentas por pagar · Reportes ·
 * Configuración · Usuarios. «Cobros» and «Estados de cuenta» are tabs of «Facturas»; preinvoices, approved
 * services, tax treatments and fiscal documents were retired with their permissions and endpoints.
 */
export const FINANCE_MODULES = [
  { id: FINANCE_MODULE_IDS.HOME, permission: 'finance.home.read', label: 'Inicio', icon: HomeIcon, description: 'Indicadores de facturación, cobros y pendientes.' },
  {
    id: FINANCE_MODULE_IDS.INVOICING, label: 'Facturación', icon: PreInvoiceIcon, description: 'Operaciones por facturar, facturas e-CF simuladas con sus cobros y charters.',
    children: [
      { id: FINANCE_MODULE_IDS.TO_INVOICE, permission: 'finance.invoicing.read', label: 'Por facturar' },
      { id: FINANCE_MODULE_IDS.RECONCILIATION, permission: 'finance.reconciliation.read', label: 'Facturas' },
      { id: FINANCE_MODULE_IDS.CHARTERS, permission: 'finance.charters.read', label: 'Charters' },
    ],
  },
  {
    id: FINANCE_MODULE_IDS.PAYABLES_GROUP, label: 'Cuentas por pagar', icon: PayablesIcon, description: 'Facturas de proveedores, proveedores y gastos de empleados.',
    children: [
      { id: FINANCE_MODULE_IDS.PAYABLES, permission: 'finance.payables.read', label: 'Facturas de proveedores' },
      { id: FINANCE_MODULE_IDS.SUPPLIERS, permission: 'finance.suppliers.read', label: 'Proveedores' },
      { id: FINANCE_MODULE_IDS.EXPENSES, permission: 'finance.expenses.read', label: 'Gastos de empleados' },
    ],
  },
  { id: FINANCE_MODULE_IDS.REPORTS, permission: 'finance.reports.read', label: 'Reportes', icon: ReportIcon, description: 'Ingresos, cuentas por cobrar, cobranza, cuentas por pagar, recargos y ventas.' },
  {
    id: FINANCE_MODULE_IDS.CONFIGURATION, label: 'Configuración', icon: SettingsIcon, description: 'Tarifarios, paquetes, reglas de cierre, aprobación de contratos, tasas de cambio y unidades de cobro.',
    children: [
      { id: FINANCE_MODULE_IDS.TARIFFS, permission: 'finance.tariffs.read', label: 'Tarifario de servicios' },
      { id: FINANCE_MODULE_IDS.CHARGES, permission: 'finance.charges.read', label: 'Tarifario de cargos' },
      { id: FINANCE_MODULE_IDS.PACKAGES, permission: 'finance.packages.read', label: 'Paquetes' },
      { id: FINANCE_MODULE_IDS.CLOSE_RULES, permission: 'finance.close_rules.read', label: 'Reglas de cierre' },
      { id: FINANCE_MODULE_IDS.CONTRACT_APPROVALS, permission: 'finance.contract_approvals.read', label: 'Aprobación de contratos' },
      { id: FINANCE_MODULE_IDS.EXCHANGE_RATES, permission: 'finance.exchange_rates.read', label: 'Tasas de cambio' },
      { id: FINANCE_MODULE_IDS.BILLING_UNITS, permission: 'finance.billing_units.read', label: 'Unidades de cobro' },
    ],
  },
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
