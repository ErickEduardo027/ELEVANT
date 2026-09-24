export const STATUS_COLORS = {
  info: '#145DC4',
  active: '#F2661E',
  success: '#1E9E6B',
  warning: '#D9A441',
  danger: '#C4453C',
};

export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },
  actualRecorded: { label: 'Hora real registrada', color: 'success' },
  boarding: { label: 'Abordando', color: 'active' },
  taxiing: { label: 'Rodaje', color: 'active' },
  leftGate: { label: 'Salió de puerta', color: 'active' },
  enRoute: { label: 'En ruta', color: 'active' },
  approaching: { label: 'Aproximando', color: 'active' },
  landed: { label: 'Aterrizado', color: 'success' },
  taxiingToGate: { label: 'Rodaje a puerta', color: 'active' },
  arrived: { label: 'En posición', color: 'success' },
  gateArrival: { label: 'Llegó a la puerta', color: 'success' },
  enRouteOnTime: { label: 'En ruta / A tiempo', color: 'active' },
  delayed: { label: 'Retrasado', color: 'warning' },
  diverted: { label: 'Desviado', color: 'danger' },
  cancelled: { label: 'Cancelado', color: 'danger' },
  unknown: { label: 'Desconocido', color: 'info' },
};

export const SERVICE_STATUS_META = {
  pending: { label: 'Pendiente', color: 'warning' },
  assigned: { label: 'Asignado', color: 'info' },
  inProgress: { label: 'En ejecución', color: 'active' },
  pendingReview: { label: 'Pendiente de revisión', color: 'warning' },
};

export const REVIEW_STATUS_META = {
  PENDING_REVIEW: { label: 'Pendiente de revisión', color: 'warning' },
  IN_REVIEW: { label: 'En revisión', color: 'info' },
  APPROVED: { label: 'Aprobado', color: 'success' },
  RETURNED: { label: 'Devuelto con correcciones', color: 'danger' },
  RESUBMITTED: { label: 'Reenviado', color: 'info' },
};

export const CLOSURE_SEVERITY_META = {
  normal: { label: 'Margen suficiente', color: 'success' },
  warning: { label: 'Margen ajustado', color: 'warning' },
  critical: { label: 'Situación crítica', color: 'danger' },
};

export const GROUND_TIME_STATUS_META = {
  within_sla: { label: 'Dentro del SLA', color: 'success' },
  near_limit: { label: 'Cerca del límite', color: 'warning' },
  exceeded: { label: 'Excedido', color: 'danger' },
};

export const RECONCILIATION_STATUS_META = {
  conforme: { label: 'Conforme', color: 'success' },
  diferencia: { label: 'Diferencia', color: 'warning' },
  no_ejecutado: { label: 'No ejecutado', color: 'danger' },
};

export const NOTIFICATION_SEVERITY_META = {
  info: { label: 'Informativa', color: 'info' },
  warning: { label: 'Atención', color: 'warning' },
  critical: { label: 'Crítica', color: 'danger' },
  success: { label: 'Positiva', color: 'success' },
};

export const CHAT_CONVERSATION_STATUS_META = {
  active: { label: 'En curso', color: 'active' },
  pending: { label: 'Pendiente', color: 'warning' },
  closed: { label: 'Cerrada', color: 'success' },
};

export const POSITION_STATUS_META = {
  planned: { label: 'Planificada', color: 'info' },
  unverified: { label: 'Sin ocupación verificada', color: 'warning' },
  available: { label: 'Libre', color: 'success' },
  occupied: { label: 'Ocupada', color: 'info' },
  disabled: { label: 'Inhabilitada', color: 'danger' },
  releasing: { label: 'Próxima a liberarse', color: 'warning' },
};

const STATUS_TABLES_BY_DOMAIN = {
  flight: FLIGHT_STATUS_META,
  service: SERVICE_STATUS_META,
  review: REVIEW_STATUS_META,
  closure: CLOSURE_SEVERITY_META,
  groundTime: GROUND_TIME_STATUS_META,
  reconciliation: RECONCILIATION_STATUS_META,
  notification: NOTIFICATION_SEVERITY_META,
  chat: CHAT_CONVERSATION_STATUS_META,
  position: POSITION_STATUS_META,
};

export function getStatusMeta(domain, status) {
  const table = STATUS_TABLES_BY_DOMAIN[domain] ?? SERVICE_STATUS_META;
  return table[status] ?? { label: status, color: 'info' };
}
