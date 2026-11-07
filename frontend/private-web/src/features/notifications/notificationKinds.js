// Vocabulario canónico de los avisos operativos (`OperationalNotificationResponse.kind`).
// Lo comparten la página de notificaciones y el dashboard OCC.
const KIND_LABELS = {
  es: {
    operation_submitted: 'Operación entregada para revisión',
    operation_approved: 'OCC aprobó la operación',
    operation_returned: 'OCC devolvió la operación',
    agent_message: 'Nuevo mensaje del agente',
    occ_message: 'Nuevo mensaje de OCC',
    operation_assigned: 'Te asignaron una operación',
    assignment_released: 'Se liberó tu asignación',
    operation_started: 'El agente inició la operación',
    incident_reported: 'Incidencia reportada en rampa',
    deviation_reported: 'Desviación reportada en rampa',
    flight_changed: 'Cambió el vuelo (posición u horario)',
    // Phase 2, block D: Gestión Humana took the agent off the operation (baja, traslado o ausencia, 2-N06, 2-N08), or
    // a document of the assigned agent no longer covers its date (2-N25). Only ADMIN_OCC receives them.
    agent_released: 'Gestión Humana liberó al agente de la operación: reasígnela',
    agent_document_not_current: 'El agente asignado no tiene un documento vigente para la operación',
    // Phase 3, block A (3-A): the provider cancelled or diverted a flight OCC imported. OCC decides; nothing is
    // cancelled by the feed.
    flight_cancelled_by_provider: 'El proveedor informa que el vuelo fue cancelado: revise la planificación',
    flight_diverted_by_provider: 'El proveedor informa que el vuelo fue desviado: revise la planificación',
    fallback: 'Evento operativo',
  },
  en: {
    operation_submitted: 'Operation submitted for review',
    operation_approved: 'OCC approved the operation',
    operation_returned: 'OCC returned the operation',
    agent_message: 'New message from the agent',
    occ_message: 'New message from OCC',
    operation_assigned: 'An operation was assigned to you',
    assignment_released: 'Your assignment was released',
    operation_started: 'The agent started the operation',
    incident_reported: 'Incident reported on the ramp',
    deviation_reported: 'Deviation reported on the ramp',
    flight_changed: 'The flight changed (stand or time)',
    agent_released: 'Human Resources released the agent from the operation: reassign it',
    agent_document_not_current: 'The assigned agent lacks a current document for the operation',
    flight_cancelled_by_provider: 'The provider reports the flight was cancelled: review the planning',
    flight_diverted_by_provider: 'The provider reports the flight was diverted: review the planning',
    fallback: 'Operational event',
  },
};

const MESSAGE_KINDS = new Set(['agent_message', 'occ_message']);
// Deviations from the normal process interrupt OCC on screen (ADR-0029): the radio is congested.
const ALERT_KINDS = new Set(['incident_reported', 'deviation_reported']);

export function isAlertNotification(kind) {
  return ALERT_KINDS.has(kind);
}

export function notificationKindLabel(kind, language = 'es') {
  const labels = KIND_LABELS[language] ?? KIND_LABELS.es;
  return labels[kind] ?? labels.fallback;
}

export function isMessageNotification(kind) {
  return MESSAGE_KINDS.has(kind);
}

// What OCC does about it is assign, cancel or divert the flight: these notices open the planning board.
const PLANNING_KINDS = new Set(['agent_released', 'agent_document_not_current', 'flight_cancelled_by_provider',
  'flight_diverted_by_provider']);

export function notificationTargetPath(notification) {
  if (PLANNING_KINDS.has(notification.kind)) return '/admin-occ/planning';
  const target = isMessageNotification(notification.kind) ? 'chat' : 'review';
  return `/admin-occ/${target}?operationId=${notification.operationId}`;
}
