// Réplica del patrón statusMeta.js ya usado en Habilitaciones/Carnets
// (tabla de significado color/label por dominio), adaptado al vocabulario
// de "Horarios y disponibilidad". Se mantiene una copia local por dominio
// (no un import cruzado entre features) siguiendo la convención ya
// establecida en este proyecto.

export const TERMINAL_OPTIONS = [
  { value: 'A', label: 'Terminal A' },
  { value: 'B', label: 'Terminal B' },
];

// Clases de acento por terminal para la grilla del calendario — un borde de
// color en vez de un relleno agresivo, para que el turno siga siendo
// legible en modo oscuro y no compita visualmente con el estado de
// cobertura (skill.md: "diferenciar visualmente Terminal A/B").
export const TERMINAL_ACCENT_META = {
  A: { borderClassName: 'border-l-accent-600', label: 'Terminal A' },
  B: { borderClassName: 'border-l-signal-500', label: 'Terminal B' },
};

// Umbral de "próxima a vencer" para habilitaciones referenciadas desde una
// posición (mismo criterio que Habilitaciones y Carnets — regla FRONTEND,
// no definitiva).
export const QUALIFICATION_EXPIRATION_THRESHOLD_DAYS = 30;

export function getQualificationStatusKey(daysRemaining, thresholdDays = QUALIFICATION_EXPIRATION_THRESHOLD_DAYS) {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= thresholdDays) return 'expiringSoon';
  return 'current';
}

// Estado de cobertura por posición/terminal/bloque (skill.md §"COBERTURA
// POR POSICIÓN": "completa, parcial/en riesgo o crítica"). `critical` se
// reserva para cero agentes asignados sobre un requisito real — el resto de
// déficits son `at_risk`, siguiendo el mismo criterio de "sin colores
// agresivos innecesarios" que Habilitaciones.
export const COVERAGE_STATUS_META = {
  complete: { label: 'Completa', tone: 'success' },
  at_risk: { label: 'En riesgo', tone: 'warning' },
  critical: { label: 'Crítica', tone: 'danger' },
};

export function getCoverageStatusKey(assignedCount, requiredCount) {
  if (requiredCount <= 0) return 'complete';
  if (assignedCount <= 0) return 'critical';
  if (assignedCount < requiredCount) return 'at_risk';
  return 'complete';
}

export const AVAILABILITY_REQUEST_STATUS_META = {
  pending: { label: 'Pendiente', tone: 'warning' },
  approved: { label: 'Aprobada', tone: 'success' },
  rejected: { label: 'Rechazada', tone: 'danger' },
};

export const AVAILABILITY_REQUEST_TYPE_META = {
  day_off: { label: 'Día libre' },
  shift_change: { label: 'Cambio de turno' },
  restriction: { label: 'Restricción de horario' },
};
