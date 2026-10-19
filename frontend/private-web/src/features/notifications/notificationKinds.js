// Vocabulario canónico de los avisos operativos (`OperationalNotificationResponse.kind`).
// Lo comparten la página de notificaciones y el dashboard OCC.
const KIND_LABELS = {
  es: {
    operation_submitted: 'Operación entregada para revisión',
    operation_approved: 'OCC aprobó la operación',
    operation_returned: 'OCC devolvió la operación',
    agent_message: 'Nuevo mensaje del agente',
    occ_message: 'Nuevo mensaje de OCC',
    fallback: 'Evento operativo',
  },
  en: {
    operation_submitted: 'Operation submitted for review',
    operation_approved: 'OCC approved the operation',
    operation_returned: 'OCC returned the operation',
    agent_message: 'New message from the agent',
    occ_message: 'New message from OCC',
    fallback: 'Operational event',
  },
};

const MESSAGE_KINDS = new Set(['agent_message', 'occ_message']);

export function notificationKindLabel(kind, language = 'es') {
  const labels = KIND_LABELS[language] ?? KIND_LABELS.es;
  return labels[kind] ?? labels.fallback;
}

export function isMessageNotification(kind) {
  return MESSAGE_KINDS.has(kind);
}

export function notificationTargetPath(notification) {
  const target = isMessageNotification(notification.kind) ? 'chat' : 'review';
  return `/admin-occ/${target}?operationId=${notification.operationId}`;
}
