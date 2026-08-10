import { HomeIcon, ContractIcon, RequestIcon, ServiceIcon } from '../components/icons';
import { BarChartIcon, MessageCircleIcon } from '../../shell/components/icons';

export const CONTRACT_MODULE_IDS = {
  HOME: 'contracts-home',
  CONTRACTS: 'contracts-list',
  REQUESTS: 'contracts-requests',
  SERVICES: 'contracts-services',
  REPORTS: 'contracts-reports',
  CHAT: 'contracts-chat',
};

export const CONTRACT_MODULES = [
  {
    id: CONTRACT_MODULE_IDS.HOME,
    label: 'Inicio',
    icon: HomeIcon,
    description: 'Resumen de contratos, vigencias y solicitudes recibidas.',
  },
  {
    id: CONTRACT_MODULE_IDS.CONTRACTS,
    label: 'Contratos',
    icon: ContractIcon,
    description: 'Registro, consulta y actualización de contratos por aerolínea.',
  },
  {
    id: CONTRACT_MODULE_IDS.REQUESTS,
    label: 'Solicitudes',
    icon: RequestIcon,
    description: 'Evaluación de solicitudes de servicios adicionales y afiliaciones.',
  },
  {
    id: CONTRACT_MODULE_IDS.SERVICES,
    label: 'Servicios pactados',
    icon: ServiceIcon,
    description: 'Consulta de servicios, tarifas, vigencias y condiciones contractuales.',
  },
  {
    id: CONTRACT_MODULE_IDS.REPORTS,
    label: 'Reportes',
    icon: BarChartIcon,
    description: 'Indicadores y consultas contractuales autorizadas.',
  },
  {
    id: CONTRACT_MODULE_IDS.CHAT,
    label: 'Comunicaciones',
    icon: MessageCircleIcon,
    description: 'Mensajes vinculados con servicios y solicitudes.',
  },
];
