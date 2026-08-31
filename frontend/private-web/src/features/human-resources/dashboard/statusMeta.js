import {
  CheckCircleIcon,
  ShieldCheckIcon,
  IdCardIcon,
  UserMinusIcon,
  CalendarIcon,
} from '../../shell/components/icons';

// Réplica del patrón statusMeta.js de feat/adminocc (tabla de significado
// color/label por dominio), adaptado al vocabulario de Gestión Humana:
// vigente/próximo a vencer/vencido, en vez de estados de vuelo.
export const EXPIRATION_STATUS_META = {
  current: { label: 'Vigente', tone: 'success' },
  expiringSoon: { label: 'Próximo a vencer', tone: 'warning' },
  expired: { label: 'Vencido', tone: 'danger' },
};

export function getExpirationStatusKey(daysRemaining) {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 30) return 'expiringSoon';
  return 'current';
}

export const ACTIVITY_TYPE_META = {
  account_activated: { icon: CheckCircleIcon, tone: 'success' },
  certification_registered: { icon: ShieldCheckIcon, tone: 'info' },
  permit_updated: { icon: IdCardIcon, tone: 'info' },
  account_disabled: { icon: UserMinusIcon, tone: 'danger' },
  shift_changed: { icon: CalendarIcon, tone: 'info' },
  certification_renewed: { icon: ShieldCheckIcon, tone: 'success' },
};

export function getActivityMeta(type) {
  return ACTIVITY_TYPE_META[type] ?? { icon: CheckCircleIcon, tone: 'info' };
}
