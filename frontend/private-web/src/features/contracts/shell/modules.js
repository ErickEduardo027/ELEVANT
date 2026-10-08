import { HomeIcon, ContractIcon, RequestIcon, ServiceIcon } from '../components/icons';
import { BarChartIcon, UsersIcon } from '../../shell/components/icons';

export const CONTRACT_MODULE_IDS = {
  HOME: 'contracts-home',
  CONTRACTS: 'contracts-list',
  DRAFTS: 'contracts-drafts',
  REQUESTS: 'contracts-requests',
  SERVICES: 'contracts-services',
  CATALOG: 'contracts-catalog',
  REPORTS: 'contracts-reports',
  USERS: 'contracts-users',
};

export const CONTRACT_MODULES = [
  {
    id: CONTRACT_MODULE_IDS.HOME, permission: 'contracts.home.read',
    label: 'Inicio',
    icon: HomeIcon,
    description: 'Resumen de contratos, vigencias y solicitudes recibidas.',
  },
  {
    id: CONTRACT_MODULE_IDS.CONTRACTS, permission: 'contracts.agreements.read',
    label: 'Contratos',
    icon: ContractIcon,
    description: 'Registro, consulta y actualización de contratos por aerolínea.',
  },
  {
    id: CONTRACT_MODULE_IDS.DRAFTS, permission: 'contracts.drafts.read',
    label: 'Borradores',
    icon: ContractIcon,
    description: 'Revisión y activación de versiones contractuales.',
  },
  {
    id: CONTRACT_MODULE_IDS.REQUESTS, permission: 'contracts.requests.read',
    label: 'Solicitudes',
    icon: RequestIcon,
    description: 'Evaluación de solicitudes de servicios adicionales y afiliaciones.',
  },
  {
    id: CONTRACT_MODULE_IDS.CATALOG, permission: 'contracts.catalog.read',
    label: 'Servicios',
    icon: ServiceIcon,
    description: 'Catálogo público de servicios de rampa, fotos y videos.',
  },
  {
    id: CONTRACT_MODULE_IDS.SERVICES, permission: 'contracts.agreements.read',
    label: 'Servicios pactados',
    icon: ServiceIcon,
    description: 'Consulta de servicios, tarifas, vigencias y condiciones contractuales.',
  },
  {
    id: CONTRACT_MODULE_IDS.REPORTS, permission: 'contracts.reports.read',
    label: 'Reportes',
    icon: BarChartIcon,
    description: 'Indicadores y consultas contractuales autorizadas.',
  },
  {
    id: CONTRACT_MODULE_IDS.USERS,
    administratorsOnly: true,
    label: 'Usuarios del departamento',
    icon: UsersIcon,
    description: 'Usuarios, plantillas y solicitudes de alta de Contratos.',
  },
];
