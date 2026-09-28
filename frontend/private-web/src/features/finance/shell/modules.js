import {
  ApprovedServicesIcon,
  HomeIcon,
  PreInvoiceIcon,
  ReconciliationIcon,
  ReportIcon,
  TariffIcon,
} from '../components/icons';
import { MessageCircleIcon } from '../../shell/components/icons';

export const FINANCE_MODULE_IDS = {
  HOME: 'finance-home',
  APPROVED_SERVICES: 'finance-approved-services',
  PREINVOICES: 'finance-preinvoices',
  RECONCILIATION: 'finance-reconciliation',
  TARIFFS: 'finance-tariffs',
  REPORTS: 'finance-reports',
  CHAT: 'finance-chat',
};

export const FINANCE_MODULES = [
  { id: FINANCE_MODULE_IDS.HOME, label: 'Inicio', icon: HomeIcon, description: 'Resumen financiero y tareas pendientes.' },
  { id: FINANCE_MODULE_IDS.APPROVED_SERVICES, label: 'Servicios aprobados', icon: ApprovedServicesIcon, description: 'Consulta y filtrado de servicios aprobados por aerolínea o período.' },
  { id: FINANCE_MODULE_IDS.PREINVOICES, label: 'Pre-facturación', icon: PreInvoiceIcon, description: 'Consulta de prefacturas guardadas por estación.' },
  { id: FINANCE_MODULE_IDS.RECONCILIATION, label: 'Conciliación', icon: ReconciliationIcon, description: 'Conciliación de servicios registrados, facturados y cobros.' },
  { id: FINANCE_MODULE_IDS.TARIFFS, label: 'Tarifas', icon: TariffIcon, description: 'Consulta y modificación autorizada de tarifas contractuales.' },
  { id: FINANCE_MODULE_IDS.REPORTS, label: 'Reportes', icon: ReportIcon, description: 'Estados de prefacturas por aerolínea y moneda.' },
  { id: FINANCE_MODULE_IDS.CHAT, label: 'Comunicaciones', icon: MessageCircleIcon, description: 'Coordinación persistente con los demás departamentos.' },
];
