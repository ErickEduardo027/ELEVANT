import { LayoutGridIcon, CalendarIcon, RadarIcon, BarChartIcon, MessageCircleIcon } from './components/icons';
import { MapPinIcon, ChecklistIcon, BellIcon, ShieldCheckIcon } from '../dashboard/components/icons';

export const MODULE_IDS = {
  DASHBOARD: 'dashboard',
  PLANNING: 'planning',
  FLIGHT_MONITORING: 'flight-monitoring',
  POSITIONS_MAP: 'positions-map',
  APPROVALS: 'approvals',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  CHAT: 'chat',
};

export const MODULES = [
  {
    id: MODULE_IDS.DASHBOARD,
    label: 'Dashboard',
    icon: LayoutGridIcon,
    description: 'Vista general en tiempo real de vuelos, servicios, agentes y aprobaciones del día.',
  },
  {
    id: MODULE_IDS.PLANNING,
    label: 'Planificación operativa',
    icon: CalendarIcon,
    description: 'Consulta de itinerarios y asignación de agentes y posiciones para las operaciones del día.',
  },
  {
    id: MODULE_IDS.FLIGHT_MONITORING,
    label: 'Monitoreo de vuelos',
    icon: RadarIcon,
    description: 'Mapa interactivo en vivo con el estado de cada vuelo en tránsito hacia o desde la estación.',
  },
  {
    id: MODULE_IDS.POSITIONS_MAP,
    label: 'Mapa de posiciones',
    icon: MapPinIcon,
    description: 'Mapa georreferenciado completo de las posiciones de Terminal A, Terminal B y el área FBO.',
  },
  {
    id: MODULE_IDS.APPROVALS,
    label: 'Revisión',
    icon: ShieldCheckIcon,
    description: 'Centro de control para validar operaciones de ground handling antes de enviarlas a Finanzas.',
  },
  {
    id: MODULE_IDS.REPORTS,
    label: 'Reportes',
    icon: BarChartIcon,
    description: 'Cierre operacional del día, indicadores clave y búsqueda histórica de operaciones.',
  },
  {
    id: MODULE_IDS.NOTIFICATIONS,
    label: 'Notificaciones',
    icon: BellIcon,
    description: 'Historial completo de alertas y avisos del sistema, más allá del resumen del Dashboard.',
  },
  {
    id: MODULE_IDS.CHAT,
    label: 'Chat interno',
    icon: MessageCircleIcon,
    description: 'Comunicación directa con los agentes de rampa, organizada por vuelo.',
  },
];
