import {
  LayoutGridIcon,
  CalendarIcon,
  RadarIcon,
  MapPinIcon,
  ShieldCheckIcon,
  BarChartIcon,
  BellIcon,
  MessageCircleIcon,
} from '../shell/components/icons';

export const ADMIN_OCC_BASE_PATH = '/admin-occ';

export const ADMIN_OCC_MODULE_IDS = {
  DASHBOARD: 'dashboard',
  PLANNING: 'planning',
  FLIGHT_MONITORING: 'flight-monitoring',
  POSITIONS_MAP: 'positions-map',
  APPROVALS: 'approvals',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  CHAT: 'chat',
};

export const ADMIN_OCC_NAVIGATION = [
  { id: ADMIN_OCC_MODULE_IDS.DASHBOARD, label: 'Dashboard', path: `${ADMIN_OCC_BASE_PATH}/dashboard`, icon: LayoutGridIcon, description: 'Vista general en tiempo real de vuelos, servicios, agentes y aprobaciones del día.' },
  { id: ADMIN_OCC_MODULE_IDS.PLANNING, label: 'Planificación operativa', path: `${ADMIN_OCC_BASE_PATH}/planning`, icon: CalendarIcon, description: 'Consulta de itinerarios y asignación de agentes y posiciones para las operaciones del día.' },
  { id: ADMIN_OCC_MODULE_IDS.FLIGHT_MONITORING, label: 'Monitoreo de vuelos', path: `${ADMIN_OCC_BASE_PATH}/flight-monitoring`, icon: RadarIcon, description: 'Mapa interactivo en vivo con el estado de cada vuelo en tránsito hacia o desde la estación.' },
  { id: ADMIN_OCC_MODULE_IDS.POSITIONS_MAP, label: 'Mapa de posiciones', path: `${ADMIN_OCC_BASE_PATH}/positions-map`, icon: MapPinIcon, description: 'Mapa georreferenciado completo de las posiciones de Terminal A, Terminal B y el área FBO.' },
  { id: ADMIN_OCC_MODULE_IDS.APPROVALS, label: 'Revisión', path: `${ADMIN_OCC_BASE_PATH}/review`, icon: ShieldCheckIcon, description: 'Centro de control para validar operaciones de ground handling antes de enviarlas a Finanzas.' },
  { id: ADMIN_OCC_MODULE_IDS.REPORTS, label: 'Reportes', path: `${ADMIN_OCC_BASE_PATH}/reports`, icon: BarChartIcon, description: 'Cierre operacional del día, indicadores clave y búsqueda histórica de operaciones.' },
  { id: ADMIN_OCC_MODULE_IDS.NOTIFICATIONS, label: 'Notificaciones', path: `${ADMIN_OCC_BASE_PATH}/notifications`, icon: BellIcon, description: 'Historial completo de alertas y avisos del sistema, más allá del resumen del Dashboard.' },
  { id: ADMIN_OCC_MODULE_IDS.CHAT, label: 'Chat interno', path: `${ADMIN_OCC_BASE_PATH}/chat`, icon: MessageCircleIcon, description: 'Comunicación directa con los agentes de rampa, organizada por vuelo.' },
];
