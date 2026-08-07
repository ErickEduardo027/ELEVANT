export const STATUS_COLORS = {
  info: '#145DC4',
  active: '#F2661E',
  success: '#1E9E6B',
  warning: '#D9A441',
  danger: '#C4453C',
};

export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },
  boarding: { label: 'Abordando', color: 'active' },
  taxiing: { label: 'Rodaje', color: 'active' },
  leftGate: { label: 'Salió de puerta', color: 'active' },
  enRoute: { label: 'En ruta', color: 'active' },
  approaching: { label: 'Aproximando', color: 'active' },
  landed: { label: 'Aterrizado', color: 'success' },
  taxiingToGate: { label: 'Rodaje a puerta', color: 'active' },
  arrived: { label: 'En posición', color: 'success' },
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

export function getStatusMeta(domain, status) {
  const table = domain === 'flight' ? FLIGHT_STATUS_META : SERVICE_STATUS_META;
  return table[status] ?? { label: status, color: 'info' };
}
