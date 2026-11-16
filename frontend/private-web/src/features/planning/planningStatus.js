const STATUS_META = {
  confirmed: { label: 'Confirmada', labelEn: 'Confirmed', color: 'info' },
  scheduled: { label: 'Programada', labelEn: 'Scheduled', color: 'info' },
  planned: { label: 'Planificada', labelEn: 'Planned', color: 'info' },
  inprogress: { label: 'En operación', labelEn: 'In operation', color: 'active' },
  active: { label: 'En operación', labelEn: 'In operation', color: 'active' },
  completed: { label: 'Completada', labelEn: 'Completed', color: 'success' },
  closed: { label: 'Cerrada', labelEn: 'Closed', color: 'success' },
  delayed: { label: 'Retrasada', labelEn: 'Delayed', color: 'warning' },
  cancelled: { label: 'Cancelada', labelEn: 'Cancelled', color: 'danger' },
  diverted: { label: 'Desviada', labelEn: 'Diverted', color: 'warning' },
};

function normalizedStatus(status) {
  return String(status ?? '').replace(/[\s_-]+/g, '').toLowerCase();
}

function humanizeStatus(status, language) {
  const value = String(status ?? '').trim();
  if (!value) return language === 'en' ? 'No status' : 'Sin estado';
  return value
    .replace(/([a-záéíóúñ])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
}

export function getPlanningStatusMeta(status, language = 'es') {
  const meta = STATUS_META[normalizedStatus(status)];
  if (!meta) return { label: humanizeStatus(status, language), color: 'info' };
  return { label: language === 'en' ? meta.labelEn : meta.label, color: meta.color };
}
