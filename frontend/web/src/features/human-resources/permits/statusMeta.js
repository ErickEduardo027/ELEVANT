import { IdCardIcon, CarIcon, RefreshCwIcon } from '../../shell/components/icons';

// Réplica del patrón statusMeta.js de Habilitaciones y certificaciones,
// adaptado al vocabulario de carnets y permisos: vigente/próximo a
// vencer/vencido. Se mantiene una copia local por dominio (no un import
// cruzado entre features) siguiendo la convención ya establecida en este
// proyecto.
//
// La ventana de "próximo a vencer" es una regla FRONTEND, no definitiva
// (skill.md: preparado para que la API provea el estado oficial más
// adelante). Se aísla aquí para que mappers.js la use sin duplicar el
// umbral.
export const PERMIT_EXPIRATION_THRESHOLD_DAYS = 30;

export const PERMIT_STATUS_META = {
  current: { label: 'Vigente', tone: 'success' },
  expiringSoon: { label: 'Próximo a vencer', tone: 'warning' },
  expired: { label: 'Vencido', tone: 'danger' },
};

export const PERMIT_STATUS_OPTIONS = Object.entries(PERMIT_STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export function getPermitStatusKey(daysRemaining, thresholdDays = PERMIT_EXPIRATION_THRESHOLD_DAYS) {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= thresholdDays) return 'expiringSoon';
  return 'current';
}

// Los dos únicos documentos administrados por este módulo (skill.md
// §OBJETIVO): no hay un catálogo variable como el de tipos de equipo en
// Habilitaciones.
export const PERMIT_DOCUMENT_TYPE_META = {
  carnet: { label: 'Carnet aeroportuario', icon: IdCardIcon },
  licencia: { label: 'Licencia de conducir en rampa', icon: CarIcon },
};

export const PERMIT_DOCUMENT_OPTIONS = [
  { value: 'carnet', label: PERMIT_DOCUMENT_TYPE_META.carnet.label },
  { value: 'licencia', label: PERMIT_DOCUMENT_TYPE_META.licencia.label },
];

// Estado general por agente (mismo criterio que AGENT_OVERALL_STATUS_META
// de Habilitaciones): se deriva de ambos documentos, nunca de un campo
// almacenado. Un carnet vencido pesa igual que cualquier otro documento
// vencido a nivel de estado general — el mayor peso visual que exige el
// skill (bloquea el acceso a rampa) se resuelve en la tabla, no aquí.
export const AGENT_PERMIT_STATUS_META = {
  current: { label: 'Vigente', tone: 'success' },
  attention: { label: 'Atención', tone: 'warning' },
  action_required: { label: 'Requiere acción', tone: 'danger' },
};

export function getAgentPermitStatusKey({ expiredCount, expiringSoonCount }) {
  if (expiredCount > 0) return 'action_required';
  if (expiringSoonCount > 0) return 'attention';
  return 'current';
}

export const TERMINAL_OPTIONS = [
  { value: 'A', label: 'Terminal A' },
  { value: 'B', label: 'Terminal B' },
];

export const HISTORY_EVENT_META = {
  issued: { label: 'Documento emitido', icon: IdCardIcon, tone: 'info' },
  renewed: { label: 'Renovación registrada', icon: RefreshCwIcon, tone: 'success' },
  revalidated: { label: 'Revalidación', icon: RefreshCwIcon, tone: 'success' },
};

export function getHistoryEventMeta(eventType) {
  return HISTORY_EVENT_META[eventType] ?? { label: eventType, icon: RefreshCwIcon, tone: 'info' };
}
