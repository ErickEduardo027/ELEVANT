import {
  ApprovedServicesIcon,
  HomeIcon,
  PreInvoiceIcon,
  ReconciliationIcon,
  ReportIcon,
  TariffIcon,
} from '../components/icons';
import { UsersIcon } from '../../shell/components/icons';

export const FINANCE_MODULE_IDS = {
  HOME: 'finance-home',
  APPROVED_SERVICES: 'finance-approved-services',
  PREINVOICES: 'finance-preinvoices',
  RECONCILIATION: 'finance-reconciliation',
  TARIFFS: 'finance-tariffs',
  REPORTS: 'finance-reports',
  USERS: 'finance-users',
};

export const FINANCE_MODULES = [
  { id: FINANCE_MODULE_IDS.HOME, permission: 'finance.home.read', label: 'Inicio', icon: HomeIcon, description: 'Resumen financiero y tareas pendientes.' },
  { id: FINANCE_MODULE_IDS.APPROVED_SERVICES, permission: 'finance.approved_services.read', label: 'Servicios aprobados', icon: ApprovedServicesIcon, description: 'Consulta y filtrado de servicios aprobados por aerolínea o período.' },
  { id: FINANCE_MODULE_IDS.PREINVOICES, permission: 'finance.preinvoices.read', label: 'Pre-facturación', icon: PreInvoiceIcon, description: 'Consulta de prefacturas guardadas por estación.' },
  { id: FINANCE_MODULE_IDS.RECONCILIATION, permission: 'finance.reconciliation.read', label: 'Seguimiento', icon: ReconciliationIcon, description: 'Prefacturas aceptadas, facturas no fiscales y pagos manuales registrados.' },
  { id: FINANCE_MODULE_IDS.TARIFFS, permission: 'finance.tariffs.read', label: 'Tarifas', icon: TariffIcon, description: 'Consulta de tarifas contractuales publicadas por estación autorizada.' },
  { id: FINANCE_MODULE_IDS.REPORTS, permission: 'finance.reports.read', label: 'Reportes', icon: ReportIcon, description: 'Estados de prefacturas por aerolínea y moneda.' },
  { id: FINANCE_MODULE_IDS.USERS, administratorsOnly: true, label: 'Usuarios del departamento', icon: UsersIcon, description: 'Usuarios, plantillas y solicitudes de alta de Finanzas.' },
];
