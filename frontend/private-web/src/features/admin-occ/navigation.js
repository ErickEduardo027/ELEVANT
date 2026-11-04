import {
  LayoutGridIcon,
  CalendarIcon,
  RadarIcon,
  MapPinIcon,
  ShieldCheckIcon,
  FileTextIcon,
  BarChartIcon,
  BellIcon,
  MessageCircleIcon,
  UsersIcon,
} from '../shell/components/icons';

export const ADMIN_OCC_BASE_PATH = '/admin-occ';

export const ADMIN_OCC_MODULE_IDS = {
  DASHBOARD: 'dashboard',
  PLANNING: 'planning',
  COVERAGE: 'coverage',
  READY_CONTRACTS: 'contracts',
  FLIGHT_MONITORING: 'flight-monitoring',
  POSITIONS_MAP: 'positions-map',
  APPROVALS: 'approvals',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  CHAT: 'chat',
  DEPARTMENT_USERS: 'users',
  EXPENSES: 'expenses',
};

export const ADMIN_OCC_NAVIGATION = [
  { id: ADMIN_OCC_MODULE_IDS.EXPENSES, label: 'Mis gastos', path: `${ADMIN_OCC_BASE_PATH}/expenses`, icon: BarChartIcon, description: 'Gastos propios y revisiones del departamento.' },
  { id: ADMIN_OCC_MODULE_IDS.DASHBOARD, permission: 'operations.dashboard.read', label: 'Dashboard', path: `${ADMIN_OCC_BASE_PATH}/dashboard`, icon: LayoutGridIcon, description: 'Vista general en tiempo real de vuelos, servicios, agentes y aprobaciones del día.' },
  { id: ADMIN_OCC_MODULE_IDS.PLANNING, permission: 'operations.planning.read', label: 'Planificación operativa', path: `${ADMIN_OCC_BASE_PATH}/planning`, icon: CalendarIcon, description: 'Consulta de itinerarios y asignación de agentes y posiciones para las operaciones del día.' },
  { id: ADMIN_OCC_MODULE_IDS.COVERAGE, permission: 'operations.coverage.read', label: 'Cobertura de posiciones', path: `${ADMIN_OCC_BASE_PATH}/coverage`, icon: UsersIcon, description: 'Qué agente cubre cada posición durante su turno, con las reglas de asignación y las posiciones combinadas.' },
  { id: ADMIN_OCC_MODULE_IDS.READY_CONTRACTS, permission: 'operations.planning.read', label: 'Contratos listos', path: `${ADMIN_OCC_BASE_PATH}/contracts`, icon: FileTextIcon, description: 'Aerolíneas con contrato activo, firmado y aprobado por Finanzas que OCC puede planificar.' },
  { id: ADMIN_OCC_MODULE_IDS.FLIGHT_MONITORING, permission: 'operations.flight_monitoring.read', label: 'Monitoreo de vuelos', path: `${ADMIN_OCC_BASE_PATH}/flight-monitoring`, icon: RadarIcon, description: 'Mapa interactivo en vivo con el estado de cada vuelo en tránsito hacia o desde la estación.' },
  { id: ADMIN_OCC_MODULE_IDS.POSITIONS_MAP, permission: 'operations.positions_map.read', label: 'Mapa de posiciones', path: `${ADMIN_OCC_BASE_PATH}/positions-map`, icon: MapPinIcon, description: 'Mapa georreferenciado completo de las posiciones de Terminal A, Terminal B y el área FBO.' },
  { id: ADMIN_OCC_MODULE_IDS.APPROVALS, permission: 'operations.review.read', label: 'Revisión', path: `${ADMIN_OCC_BASE_PATH}/review`, icon: ShieldCheckIcon, description: 'Centro de control para validar operaciones de ground handling antes de enviarlas a Finanzas.' },
  { id: ADMIN_OCC_MODULE_IDS.REPORTS, permission: 'operations.reports.read', label: 'Reportes', path: `${ADMIN_OCC_BASE_PATH}/reports`, icon: BarChartIcon, description: 'Cierre operacional del día, indicadores clave y búsqueda histórica de operaciones.' },
  { id: ADMIN_OCC_MODULE_IDS.NOTIFICATIONS, permission: 'operations.notifications.read', label: 'Notificaciones', path: `${ADMIN_OCC_BASE_PATH}/notifications`, icon: BellIcon, description: 'Historial completo de alertas y avisos del sistema, más allá del resumen del Dashboard.' },
  { id: ADMIN_OCC_MODULE_IDS.CHAT, permission: 'operations.chat.read', label: 'Chat interno', path: `${ADMIN_OCC_BASE_PATH}/chat`, icon: MessageCircleIcon, description: 'Comunicación directa con los agentes de rampa, organizada por vuelo.' },
  { id: ADMIN_OCC_MODULE_IDS.DEPARTMENT_USERS, administratorsOnly: true, label: 'Usuarios del departamento', path: `${ADMIN_OCC_BASE_PATH}/users`, icon: UsersIcon, description: 'Usuarios, agentes de rampa, plantillas y solicitudes de alta del Centro de Operaciones.' },
];

// Agrupación visual del riel OCC. Solo ordena los módulos ya permitidos por
// `allowedNavigation`; no concede ni oculta acceso.
export const OCC_NAV_SECTIONS = [
  { id: 'monitoring', items: [ADMIN_OCC_MODULE_IDS.DASHBOARD, ADMIN_OCC_MODULE_IDS.FLIGHT_MONITORING, ADMIN_OCC_MODULE_IDS.POSITIONS_MAP] },
  { id: 'operations', items: [ADMIN_OCC_MODULE_IDS.PLANNING, ADMIN_OCC_MODULE_IDS.COVERAGE, ADMIN_OCC_MODULE_IDS.READY_CONTRACTS, ADMIN_OCC_MODULE_IDS.APPROVALS, ADMIN_OCC_MODULE_IDS.REPORTS, ADMIN_OCC_MODULE_IDS.EXPENSES] },
  { id: 'communication', items: [ADMIN_OCC_MODULE_IDS.NOTIFICATIONS, ADMIN_OCC_MODULE_IDS.CHAT] },
  { id: 'administration', items: [ADMIN_OCC_MODULE_IDS.DEPARTMENT_USERS] },
];
