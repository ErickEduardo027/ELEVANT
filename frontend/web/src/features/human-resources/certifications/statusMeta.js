import { ShieldCheckIcon, ChecklistIcon, RefreshCwIcon } from '../../shell/components/icons';

// Réplica del patrón statusMeta.js ya usado en Dashboard/Usuarios de Gestión
// Humana (tabla de significado color/label por dominio), adaptado al
// vocabulario de habilitaciones: vigente/próxima a vencer/vencida.
//
// La ventana de "próxima a vencer" es una regla FRONTEND, no definitiva
// (skill.md: "la API podrá proporcionar posteriormente el estado oficial").
// Se aísla aquí para que mappers.js y el servicio de cobertura la compartan
// sin duplicar el umbral.
export const QUALIFICATION_EXPIRATION_THRESHOLD_DAYS = 30;

export const QUALIFICATION_STATUS_META = {
  current: { label: 'Vigente', tone: 'success' },
  expiringSoon: { label: 'Próxima a vencer', tone: 'warning' },
  expired: { label: 'Vencida', tone: 'danger' },
};

export const QUALIFICATION_STATUS_OPTIONS = Object.entries(QUALIFICATION_STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export function getQualificationStatusKey(daysRemaining, thresholdDays = QUALIFICATION_EXPIRATION_THRESHOLD_DAYS) {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= thresholdDays) return 'expiringSoon';
  return 'current';
}

// Estado general por agente (skill.md §"VISTA POR AGENTE"): se deriva de los
// conteos de sus habilitaciones, nunca de un campo almacenado.
export const AGENT_OVERALL_STATUS_META = {
  current: { label: 'Vigente', tone: 'success' },
  attention: { label: 'Atención', tone: 'warning' },
  action_required: { label: 'Requiere acción', tone: 'danger' },
};

export function getAgentOverallStatusKey({ expiredCount, expiringSoonCount }) {
  if (expiredCount > 0) return 'action_required';
  if (expiringSoonCount > 0) return 'attention';
  return 'current';
}

export const TERMINAL_OPTIONS = [
  { value: 'A', label: 'Terminal A' },
  { value: 'B', label: 'Terminal B' },
];

export const HISTORY_EVENT_META = {
  created: { label: 'Habilitación creada', icon: ShieldCheckIcon, tone: 'info' },
  training_completed: { label: 'Entrenamiento completado', icon: ChecklistIcon, tone: 'info' },
  renewed: { label: 'Renovación registrada', icon: RefreshCwIcon, tone: 'success' },
  revalidated: { label: 'Revalidación', icon: RefreshCwIcon, tone: 'success' },
};

export function getHistoryEventMeta(eventType) {
  return HISTORY_EVENT_META[eventType] ?? { label: eventType, icon: ChecklistIcon, tone: 'info' };
}

// Valor por defecto del formulario de registro (skill.md §4): configurable,
// no un texto rígido dentro del componente.
export const DEFAULT_CERTIFYING_ENTITY = 'ALC';

// Un equipo con este número de agentes habilitados o menos se marca como
// "Cobertura limitada" en la vista Por tipo de equipo (skill.md: "sin
// utilizar colores agresivos innecesariamente"). Se mantiene deliberadamente
// bajo para que el badge señale un riesgo real de cobertura (p. ej. un único
// agente habilitado) y no se vuelva la norma en catálogos con pocos agentes.
export const LIMITED_COVERAGE_AGENT_THRESHOLD = 1;
