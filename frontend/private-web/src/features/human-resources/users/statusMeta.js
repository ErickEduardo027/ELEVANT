import { CheckCircleIcon, ShieldCheckIcon, UsersIcon, UserMinusIcon, MailIcon, KeyIcon } from '../../shell/components/icons';

// Tabla de significado color/label para el dominio "cuentas", replicando el
// patrón statusMeta.js ya usado en el Dashboard de Gestión Humana y en
// feat/adminocc: un único lugar que traduce vocabulario de negocio a tono
// visual, para que StatusBadge/Badge permanezcan agnósticos al dominio.
export const ACCOUNT_STATUS_META = {
  active: { label: 'Activa', tone: 'success' },
  pending_activation: { label: 'Pendiente de activación', tone: 'warning' },
  invitation_sent: { label: 'Invitación enviada', tone: 'info' },
  disabled: { label: 'Deshabilitada', tone: 'neutral' },
  blocked: { label: 'Bloqueada', tone: 'danger' },
};

export const ACCOUNT_STATUS_OPTIONS = Object.entries(ACCOUNT_STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export const USER_TYPE_META = {
  admin_occ: { label: 'Administrador/OCC', portal: 'back_office' },
  contracts: { label: 'Contratos', portal: 'back_office' },
  finance: { label: 'Finanzas', portal: 'back_office' },
  human_resources: { label: 'Gestión Humana', portal: 'back_office' },
  ramp_agent: { label: 'Agente de Rampa', portal: 'ramp_mobile_app' },
  airline_client: { label: 'Cliente / Aerolínea', portal: 'airline_portal' },
};

export const USER_TYPE_OPTIONS = Object.entries(USER_TYPE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export const PORTAL_META = {
  back_office: { label: 'Back-office' },
  ramp_mobile_app: { label: 'Aplicación móvil de Agente' },
  airline_portal: { label: 'Portal de Aerolínea' },
};

export const PORTAL_OPTIONS = Object.entries(PORTAL_META).map(([value, meta]) => ({ value, label: meta.label }));

export const BACK_OFFICE_USER_TYPES = ['admin_occ', 'contracts', 'finance', 'human_resources'];

// Vocabulario de permisos representativo (ver skill.md §12: "no implementar
// una matriz definitiva de permisos si el backend no lo soporta"). El rol
// seleccionado determina qué permisos de esta lista se muestran como
// heredados; la matriz real vendrá del RBAC del backend.
export const PERMISSION_LABELS = ['Consultar', 'Crear', 'Editar', 'Aprobar', 'Exportar', 'Administrar'];

export const HISTORY_ACTION_META = {
  account_created: { label: 'Cuenta creada', icon: UsersIcon, tone: 'info' },
  invitation_sent: { label: 'Invitación enviada', icon: MailIcon, tone: 'info' },
  account_activated: { label: 'Cuenta activada', icon: CheckCircleIcon, tone: 'success' },
  role_changed: { label: 'Rol modificado', icon: ShieldCheckIcon, tone: 'info' },
  portal_changed: { label: 'Portal modificado', icon: ShieldCheckIcon, tone: 'info' },
  account_disabled: { label: 'Cuenta desactivada', icon: UserMinusIcon, tone: 'neutral' },
  account_reactivated: { label: 'Cuenta reactivada', icon: CheckCircleIcon, tone: 'success' },
  access_reset: { label: 'Acceso restablecido', icon: KeyIcon, tone: 'info' },
};

export function getHistoryActionMeta(action) {
  return HISTORY_ACTION_META[action] ?? { label: action, icon: UsersIcon, tone: 'info' };
}
