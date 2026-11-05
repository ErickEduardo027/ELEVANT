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
  PACKAGES: 'finance-packages',
  TREASURY: 'finance-treasury',
  STATEMENTS: 'finance-statements',
  SUPPLIERS: 'finance-suppliers',
  PAYABLES: 'finance-payables',
  EXPENSES: 'finance-expenses',
  FISCAL: 'finance-fiscal',
  TAXES: 'finance-taxes',
  CONTRACT_APPROVALS: 'finance-contract-approvals',
  APPROVED_SERVICES: 'finance-approved-services',
  CHARTERS: 'finance-charters',
  PREINVOICES: 'finance-preinvoices',
  RECONCILIATION: 'finance-reconciliation',
  TARIFF_BOOKS: 'finance-tariff-books',
  TARIFFS: 'finance-tariffs',
  CHARGES: 'finance-charges',
  EXCHANGE_RATES: 'finance-exchange-rates',
  BILLING_UNITS: 'finance-billing-units',
  REPORTS: 'finance-reports',
  USERS: 'finance-users',
};

export const FINANCE_MODULES = [
  { id: FINANCE_MODULE_IDS.HOME, permission: 'finance.home.read', label: 'Inicio', icon: HomeIcon, description: 'Resumen financiero y tareas pendientes.' },
  { id: FINANCE_MODULE_IDS.PACKAGES, permission: 'finance.packages.read', label: 'Paquetes', icon: TariffIcon, description: 'Coberturas, vigencias y bloques de excedentes.' },
  { id: FINANCE_MODULE_IDS.CONTRACT_APPROVALS, permission: 'finance.contract_approvals.read', label: 'Aprobación de contratos', icon: ShieldCheckIcon, description: 'Contratos enviados por Contratos frente a la tarifa base.' },
  { id: FINANCE_MODULE_IDS.APPROVED_SERVICES, permission: 'finance.approved_services.read', label: 'Servicios aprobados', icon: ApprovedServicesIcon, description: 'Consulta y filtrado de servicios aprobados por aerolínea o período.' },
  { id: FINANCE_MODULE_IDS.CHARTERS, permission: 'finance.charters.read', label: 'Charters sin contrato', icon: ApprovedServicesIcon, description: 'Vuelos sin contrato a tarifa base y confirmación del prepago.' },
  { id: FINANCE_MODULE_IDS.PREINVOICES, permission: 'finance.preinvoices.read', label: 'Pre-facturación', icon: PreInvoiceIcon, description: 'Prefacturas con sus servicios, cargos y ajustes.' },
  { id: FINANCE_MODULE_IDS.RECONCILIATION, permission: 'finance.reconciliation.read', label: 'Facturas', icon: ReconciliationIcon, description: 'Facturas no fiscales, saldos, pagos parciales y notas de crédito.' },
  {
    id: FINANCE_MODULE_IDS.TARIFF_BOOKS, label: 'Tarifarios', icon: TariffIcon, description: 'Tarifa base, cargos, tasas de cambio y unidades de cobro.',
    children: [
      { id: FINANCE_MODULE_IDS.TARIFFS, permission: 'finance.tariffs.read', label: 'Tarifario de servicios' },
      { id: FINANCE_MODULE_IDS.CHARGES, permission: 'finance.charges.read', label: 'Tarifario de cargos' },
      { id: FINANCE_MODULE_IDS.EXCHANGE_RATES, permission: 'finance.exchange_rates.read', label: 'Tasas de cambio' },
      { id: FINANCE_MODULE_IDS.BILLING_UNITS, permission: 'finance.billing_units.read', label: 'Unidades de cobro' },
    ],
  },
  { id: FINANCE_MODULE_IDS.TREASURY, permission: 'finance.receipts.read', label: 'Cobros y aplicaciones', icon: ReconciliationIcon, description: 'Cobros, anticipos, aplicaciones, reversos y devoluciones.' },
  { id: FINANCE_MODULE_IDS.STATEMENTS, permission: 'finance.statements.read', label: 'Estados de cuenta', icon: ReportIcon, description: 'Saldo y antigüedad a una fecha de corte.' },
  { id: FINANCE_MODULE_IDS.SUPPLIERS, permission: 'finance.suppliers.read', label: 'Proveedores', icon: UsersIcon, description: 'Directorio y condiciones de proveedores.' },
  { id: FINANCE_MODULE_IDS.PAYABLES, permission: 'finance.payables.read', label: 'Cuentas por pagar', icon: PreInvoiceIcon, description: 'Facturas de proveedores, aprobaciones y pagos.' },
  { id: FINANCE_MODULE_IDS.EXPENSES, permission: 'finance.expenses.read', label: 'Gastos de empleados', icon: PreInvoiceIcon, description: 'Reembolsos con aprobación del departamento y Finanzas.' },
  { id: FINANCE_MODULE_IDS.TAXES, permission: 'finance.taxes.read', label: 'Tratamientos tributarios', icon: TariffIcon, description: 'Configuración explícita y vigencias por concepto.' },
  { id: FINANCE_MODULE_IDS.FISCAL, permission: 'finance.fiscal.read', label: 'Documentos fiscales', icon: ShieldCheckIcon, description: 'Simulación, archivo privado y seguimiento.' },
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
