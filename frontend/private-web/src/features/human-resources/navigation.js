import {
  BarChartIcon,
  CalendarIcon,
  ChecklistIcon,
  IdCardIcon,
  LayoutGridIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '../shell/components/icons';

export const HUMAN_RESOURCES_BASE_PATH = '/gestion-humana';

export const HUMAN_RESOURCES_MODULE_IDS = {
  DASHBOARD: 'dashboard',
  EMPLOYEES: 'employees',
  USERS: 'users',
  CERTIFICATIONS: 'certifications',
  PERMITS: 'permits',
  SCHEDULES: 'schedules',
  ATTENDANCE: 'attendance',
  REPORTS: 'reports',
  AUDIT: 'audit',
  ACCESS_REQUESTS: 'access-requests',
  DEPARTMENT_USERS: 'department-users',
  SETTINGS: 'settings',
};

export const HUMAN_RESOURCES_NAVIGATION = [
  {
    id: HUMAN_RESOURCES_MODULE_IDS.DASHBOARD, permission: 'human_resources.dashboard.read',
    label: 'Dashboard',
    path: `${HUMAN_RESOURCES_BASE_PATH}/dashboard`,
    icon: LayoutGridIcon,
    description: 'Resumen general de la operación de Gestión Humana.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.EMPLOYEES, permission: 'human_resources.employees.read',
    label: 'Empleados',
    path: `${HUMAN_RESOURCES_BASE_PATH}/employees`,
    icon: IdCardIcon,
    description: 'Expedientes del personal; solo los empleados registrados reciben acceso.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.USERS, permission: 'human_resources.ramp_profiles.read',
    label: 'Agentes de rampa',
    path: `${HUMAN_RESOURCES_BASE_PATH}/users`,
    icon: UsersIcon,
    description: 'Perfil operativo de los empleados de rampa: estaciones, terminales y supervisor.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS, permission: 'human_resources.qualifications.read',
    label: 'Habilitaciones y certificaciones',
    path: `${HUMAN_RESOURCES_BASE_PATH}/certifications`,
    icon: ShieldCheckIcon,
    description: 'Habilitaciones, certificaciones y equipos autorizados.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.PERMITS, permission: 'human_resources.permits.read',
    label: 'Carnets y permisos aeroportuarios',
    path: `${HUMAN_RESOURCES_BASE_PATH}/permits`,
    icon: IdCardIcon,
    description: 'Carnet aeroportuario y licencias en rampa.',
  },
  {
    id: HUMAN_RESOURCES_MODULE_IDS.SCHEDULES, permission: 'human_resources.schedules.read',
    label: 'Horarios y disponibilidad',
    path: `${HUMAN_RESOURCES_BASE_PATH}/schedules`,
    icon: CalendarIcon,
    description: 'Turnos, disponibilidad y cobertura de personal.',
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
  {
    // ADR-0045: the permit types and the qualification equipment Gestión Humana maintains.
    id: HUMAN_RESOURCES_MODULE_IDS.SETTINGS, permission: 'human_resources.settings.read',
    label: 'Configuración',
    path: `${HUMAN_RESOURCES_BASE_PATH}/settings`,
    icon: SettingsIcon,
    description: 'Tipos de carnet y permiso y equipos de habilitación.',
  },
];

/**
 * The menu of Gestión Humana in the version 1 (ADR-0047), grouped by sections like Finanzas: Personal · Operación de
 * rampa · Seguimiento · Accesos, and Configuración on its own. It only orders the modules `allowedNavigation` already
 * permitted; it neither grants nor hides access. A section without a label puts its modules at the first level.
 */
export const HUMAN_RESOURCES_NAV_SECTIONS = Object.freeze([
  { id: 'section-staff', label: 'Personal', icon: IdCardIcon, description: 'Resumen y expedientes del personal.',
    items: [HUMAN_RESOURCES_MODULE_IDS.DASHBOARD, HUMAN_RESOURCES_MODULE_IDS.EMPLOYEES] },
  { id: 'section-ramp', label: 'Operación de rampa', icon: UsersIcon,
    description: 'Agentes de rampa, habilitaciones, carnets, horarios y asistencia.',
    items: [HUMAN_RESOURCES_MODULE_IDS.USERS, HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS, HUMAN_RESOURCES_MODULE_IDS.PERMITS,
      HUMAN_RESOURCES_MODULE_IDS.SCHEDULES, HUMAN_RESOURCES_MODULE_IDS.ATTENDANCE] },
  { id: 'section-tracking', label: 'Seguimiento', icon: BarChartIcon, description: 'Reportes y trazabilidad.',
    items: [HUMAN_RESOURCES_MODULE_IDS.REPORTS, HUMAN_RESOURCES_MODULE_IDS.AUDIT] },
  { id: 'section-access', label: 'Accesos', icon: ShieldCheckIcon, description: 'Validaciones de acceso y usuarios del departamento.',
    items: [HUMAN_RESOURCES_MODULE_IDS.ACCESS_REQUESTS, HUMAN_RESOURCES_MODULE_IDS.DEPARTMENT_USERS] },
  { id: 'section-settings', items: [HUMAN_RESOURCES_MODULE_IDS.SETTINGS] },
].map(section => Object.freeze({ ...section, items: Object.freeze(section.items) })));

/** The sidebar entries for the allowed modules: each section keeps its allowed modules and vanishes when none remain. */
export function humanResourcesNavigation(allowed) {
  return HUMAN_RESOURCES_NAV_SECTIONS.flatMap(({ items, ...section }) => {
    const children = items.map(id => allowed.find(item => item.id === id)).filter(Boolean);
    if (!section.label) return children;
    return children.length ? [{ ...section, children }] : [];
  });
}
