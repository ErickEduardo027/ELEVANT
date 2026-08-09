import {
  LayoutGridIcon,
  UsersIcon,
  ShieldCheckIcon,
  IdCardIcon,
  CalendarIcon,
  BarChartIcon,
  ChecklistIcon,
  BellIcon,
} from '../shell/components/icons';
import {
  CERTIFICATIONS_STATUS_MOCK,
  PERMITS_STATUS_MOCK,
  NOTIFICATIONS_STATUS_MOCK,
} from './mockData';

export const HUMAN_RESOURCES_BASE_PATH = '/human-resources';

function expiryBadge({ expired, expiringSoon }) {
  if (expired > 0) return { count: expired, tone: 'critical' };
  if (expiringSoon > 0) return { count: expiringSoon, tone: 'warning' };
  return null;
}

export const HUMAN_RESOURCES_MODULE_IDS = {
  DASHBOARD: 'dashboard',
  USERS: 'users',
  CERTIFICATIONS: 'certifications',
  PERMITS: 'permits',
  SCHEDULES: 'schedules',
  REPORTS: 'reports',
  AUDIT: 'audit',
  NOTIFICATIONS: 'notifications',
};

export const HUMAN_RESOURCES_NAVIGATION = [
  {
    id: HUMAN_RESOURCES_MODULE_IDS.DASHBOARD,
    label: 'Dashboard',
    path: `${HUMAN_RESOURCES_BASE_PATH}/dashboard`,
    icon: LayoutGridIcon,
    description: 'Resumen general de la operación de Gestión Humana.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.USERS,
    label: 'Gestión de usuarios y cuentas',
    path: `${HUMAN_RESOURCES_BASE_PATH}/users`,
    icon: UsersIcon,
    description: 'Creación, edición, activación/desactivación de cuentas y asignación de roles y permisos.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS,
    label: 'Habilitaciones y certificaciones',
    path: `${HUMAN_RESOURCES_BASE_PATH}/certifications`,
    icon: ShieldCheckIcon,
    description: 'Habilitaciones, certificaciones y equipos autorizados: vigentes, próximos a vencer y vencidos.',
    badge: expiryBadge(CERTIFICATIONS_STATUS_MOCK),
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.PERMITS,
    label: 'Carnets y permisos aeroportuarios',
    path: `${HUMAN_RESOURCES_BASE_PATH}/permits`,
    icon: IdCardIcon,
    description: 'Carnet aeroportuario y licencia de conducir en rampa: fechas de emisión, vencimiento y alertas.',
    badge: expiryBadge(PERMITS_STATUS_MOCK),
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.SCHEDULES,
    label: 'Horarios y disponibilidad',
    path: `${HUMAN_RESOURCES_BASE_PATH}/schedules`,
    icon: CalendarIcon,
    description: 'Turnos, disponibilidad, asignación por terminal y cobertura de personal.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.REPORTS,
    label: 'Reportes',
    path: `${HUMAN_RESOURCES_BASE_PATH}/reports`,
    icon: BarChartIcon,
    description: 'Vencimientos, altas/bajas, personal por terminal y por turno, cobertura de habilitaciones.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.AUDIT,
    label: 'Trazabilidad / Auditoría',
    path: `${HUMAN_RESOURCES_BASE_PATH}/audit`,
    icon: ChecklistIcon,
    description: 'Acciones críticas: activación/desactivación de cuentas, cambios de roles y modificaciones.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS,
    label: 'Notificaciones',
    path: `${HUMAN_RESOURCES_BASE_PATH}/notifications`,
    icon: BellIcon,
    description: 'Historial de alertas y avisos del sistema.',
    badge: { count: NOTIFICATIONS_STATUS_MOCK.unreadCount, tone: 'default' },
  },
];
