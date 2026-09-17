const STATUS_META = {
  confirmed: { label: 'Confirmada', color: 'info' },
  scheduled: { label: 'Programada', color: 'info' },
  planned: { label: 'Planificada', color: 'info' },
  inprogress: { label: 'En operación', color: 'active' },
  active: { label: 'En operación', color: 'active' },
  completed: { label: 'Completada', color: 'success' },
  closed: { label: 'Cerrada', color: 'success' },
  delayed: { label: 'Retrasada', color: 'warning' },
  cancelled: { label: 'Cancelada', color: 'danger' },
};

function normalizedStatus(status) {
  return String(status ?? '').replace(/[\s_-]+/g, '').toLowerCase();
}

function humanizeStatus(status) {
  const value = String(status ?? '').trim();
  if (!value) return 'Sin estado';
  return value
    .replace(/([a-záéíóúñ])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
}

export function getPlanningStatusMeta(status) {
  return STATUS_META[normalizedStatus(status)] ?? {
    label: humanizeStatus(status),
    color: 'info',
  };
}
