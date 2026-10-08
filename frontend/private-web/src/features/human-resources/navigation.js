import {
  BarChartIcon,
  BellIcon,
  CalendarIcon,
  ChecklistIcon,
  IdCardIcon,
  LayoutGridIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '../shell/components/icons';
import {
  CERTIFICATIONS_STATUS_MOCK,
  NOTIFICATIONS_STATUS_MOCK,
  PERMITS_STATUS_MOCK,
  SCHEDULES_STATUS_MOCK,
} from './mockData';

export const HUMAN_RESOURCES_BASE_PATH = '/gestion-humana';

export const HUMAN_RESOURCES_MODULE_IDS = {
  DASHBOARD: 'dashboard',
  USERS: 'users',
  CERTIFICATIONS: 'certifications',
  PERMITS: 'permits',
  SCHEDULES: 'schedules',
  ATTENDANCE: 'attendance',
  REPORTS: 'reports',
  AUDIT: 'audit',
  NOTIFICATIONS: 'notifications',
  ACCESS_REQUESTS: 'access-requests',
  DEPARTMENT_USERS: 'department-users',
};

function badgeFromStatus(status) {
  if (status.expired > 0) return { count: status.expired, tone: 'critical' };
  if (status.expiringSoon > 0) return { count: status.expiringSoon, tone: 'warning' };
  return null;
}

export const HUMAN_RESOURCES_NAVIGATION = [
  {
    id: HUMAN_RESOURCES_MODULE_IDS.DASHBOARD, permission: 'human_resources.dashboard.read',
    label: 'Dashboard',
    path: `${HUMAN_RESOURCES_BASE_PATH}/dashboard`,
    icon: LayoutGridIcon,
    description: 'Resumen general de la operación de Gestión Humana.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.USERS, permission: 'human_resources.ramp_profiles.read',
    label: 'Agentes de rampa',
    path: `${HUMAN_RESOURCES_BASE_PATH}/users`,
    icon: UsersIcon,
    description: 'Perfiles operativos y estaciones; las cuentas se vinculan en Superadministración.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS, permission: 'human_resources.qualifications.read',
    label: 'Habilitaciones y certificaciones',
    path: `${HUMAN_RESOURCES_BASE_PATH}/certifications`,
    icon: ShieldCheckIcon,
    description: 'Habilitaciones, certificaciones y equipos autorizados.',
    badge: badgeFromStatus(CERTIFICATIONS_STATUS_MOCK),
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.PERMITS, permission: 'human_resources.permits.read',
    label: 'Carnets y permisos aeroportuarios',
    path: `${HUMAN_RESOURCES_BASE_PATH}/permits`,
    icon: IdCardIcon,
    description: 'Carnet aeroportuario y licencias en rampa.',
    badge: badgeFromStatus(PERMITS_STATUS_MOCK),
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.SCHEDULES, permission: 'human_resources.schedules.read',
    label: 'Horarios y disponibilidad',
    path: `${HUMAN_RESOURCES_BASE_PATH}/schedules`,
    icon: CalendarIcon,
    description: 'Turnos, disponibilidad y cobertura de personal.',
    badge: SCHEDULES_STATUS_MOCK.coverageAlerts > 0 ? { count: SCHEDULES_STATUS_MOCK.coverageAlerts, tone: 'warning' } : null,
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.ATTENDANCE, permission: 'human_resources.attendance.read',
    label: 'Revisión de asistencia',
    path: `${HUMAN_RESOURCES_BASE_PATH}/attendance`,
    icon: ChecklistIcon,
    description: 'Contraste de horas observadas por OCC y agentes de rampa.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.REPORTS, permission: 'human_resources.reports.read',
    label: 'Reportes',
    path: `${HUMAN_RESOURCES_BASE_PATH}/reports`,
    icon: BarChartIcon,
    description: 'Vencimientos, altas/bajas y cobertura por turno.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.AUDIT, permission: 'human_resources.audit.read',
    label: 'Trazabilidad / Auditoría',
    path: `${HUMAN_RESOURCES_BASE_PATH}/audit`,
    icon: ChecklistIcon,
    description: 'Acciones críticas y cambios de acceso.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS, permission: 'human_resources.notifications.read',
    label: 'Notificaciones',
    path: `${HUMAN_RESOURCES_BASE_PATH}/notifications`,
    icon: BellIcon,
    description: 'Historial de alertas y avisos del sistema.',
    badge: { count: NOTIFICATIONS_STATUS_MOCK.unreadCount, tone: 'default' },
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.ACCESS_REQUESTS,
    permission: 'human_resources.access_requests.read',
    label: 'Validaciones de acceso',
    path: `${HUMAN_RESOURCES_BASE_PATH}/access-requests`,
    icon: ShieldCheckIcon,
    description: 'Altas de usuarios solicitadas por los administradores de cada departamento.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.DEPARTMENT_USERS,
    administratorsOnly: true,
    label: 'Usuarios del departamento',
    path: `${HUMAN_RESOURCES_BASE_PATH}/department-users`,
    icon: UsersIcon,
    description: 'Usuarios, plantillas y solicitudes de alta de Gestión Humana.',
  },
];
