export const TIMELINE_STEPS = [
  { key: 'blocksOn', label: 'Blocks On' },
  { key: 'doorsOpen', label: 'Apertura de puertas' },
  { key: 'firstBag', label: 'Primer equipaje' },
  { key: 'loadingStart', label: 'Inicio de carga' },
  { key: 'boardingStart', label: 'Inicio de pasajeros' },
  { key: 'firstPax', label: 'Primer pasajero' },
  { key: 'loadingEnd', label: 'Fin de carga' },
  { key: 'lastBag', label: 'Último equipaje' },
  { key: 'lastPax', label: 'Último pasajero' },
  { key: 'doorsClose', label: 'Cierre de puertas' },
  { key: 'blocksOff', label: 'Blocks Off' },
];

const PLANNING_VS_EXECUTION_FIELDS = [
  { key: 'position', label: 'Posición' },
  { key: 'startTime', label: 'Hora inicio' },
  { key: 'agents', label: 'Agentes' },
  { key: 'teams', label: 'Equipos' },
  { key: 'services', label: 'Servicios' },
  { key: 'duration', label: 'Duración' },
  { key: 'supervisor', label: 'Supervisor' },
];

export const TONE_LABEL = {
  match: 'Coincide',
  attention: 'Atención',
  critical: 'Discrepancia crítica',
};

export const TONE_BADGE_CLASS = {
  match: 'bg-status-success/10 text-status-success',
  attention: 'bg-status-warning/10 text-status-warning',
  critical: 'bg-status-danger/10 text-status-danger',
};

function formatTime(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatClockTime(isoString) {
  return formatTime(isoString) ?? 'Sin registro';
}

export function formatOperationDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('es-DO', { month: 'short' }).replace('.', '').toUpperCase();
  return `${day} ${month} ${date.getFullYear()}`;
}

export function formatDuration(minutes) {
  if (minutes == null) return 'Sin registro';
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining}min` : `${remaining} min`;
}

export function formatWaitingTime(submittedAtIso, nowIso) {
  if (!submittedAtIso) return 'Sin registro';
  const diffMinutes = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(submittedAtIso).getTime()) / 60000));
  return formatDuration(diffMinutes);
}

function diffMinutesBetween(plannedIso, actualIso) {
  return Math.round((new Date(actualIso).getTime() - new Date(plannedIso).getTime()) / 60000);
}

function compareTimeField(planned, actual) {
  const diff = diffMinutesBetween(planned, actual);
  const absDiff = Math.abs(diff);
  const tone = absDiff === 0 ? 'match' : absDiff <= 10 ? 'attention' : 'critical';
  const executedLabel = diff === 0 ? formatTime(actual) : `${formatTime(actual)} (${diff > 0 ? '+' : ''}${diff} min)`;
  return { plannedLabel: formatTime(planned), executedLabel, tone };
}

function compareCountField(planned, actual, { criticalOnAnyDiff = false } = {}) {
  const diff = actual - planned;
  const tone = diff === 0 ? 'match' : criticalOnAnyDiff ? 'critical' : 'attention';
  return { plannedLabel: String(planned), executedLabel: diff === 0 ? String(actual) : `${actual} (${diff > 0 ? '+' : ''}${diff})`, tone };
}

function compareServicesField(planned = [], actual = []) {
  const missing = planned.filter(service => !actual.includes(service));
  const extra = actual.filter(service => !planned.includes(service));
  const tone = missing.length > 0 ? 'critical' : extra.length > 0 ? 'attention' : 'match';
  return { plannedLabel: planned.join(', ') || 'Ninguno', executedLabel: actual.join(', ') || 'Ninguno', tone };
}

function compareStringField(planned, actual, { onMismatch = 'critical' } = {}) {
  const tone = planned === actual ? 'match' : onMismatch;
  return { plannedLabel: planned ?? 'Sin registro', executedLabel: actual ?? 'Sin registro', tone };
}

export function buildPlanningVsExecutionRows(operation) {
  const { planned, actual } = operation;
  return PLANNING_VS_EXECUTION_FIELDS.map(field => {
    let comparison;
    switch (field.key) {
      case 'position':
        comparison = compareStringField(planned.position, actual.position, { onMismatch: 'critical' });
        break;
      case 'startTime':
        comparison = compareTimeField(planned.startTime, actual.startTime);
        break;
      case 'agents':
        comparison = compareCountField(planned.agents, actual.agents, { criticalOnAnyDiff: true });
        break;
      case 'teams':
        comparison = compareCountField(planned.teams, actual.teams);
        break;
      case 'services':
        comparison = compareServicesField(planned.services, actual.services);
        break;
      case 'duration':
        comparison = compareCountField(planned.duration, actual.duration, { criticalOnAnyDiff: false });
        comparison.plannedLabel = formatDuration(planned.duration);
        comparison.executedLabel =
          actual.duration === planned.duration ? formatDuration(actual.duration) : `${formatDuration(actual.duration)} (${actual.duration - planned.duration > 0 ? '+' : ''}${actual.duration - planned.duration} min)`;
        break;
      case 'supervisor':
        comparison = compareStringField(planned.supervisor, actual.supervisor, { onMismatch: 'attention' });
        break;
      default:
        comparison = { plannedLabel: '', executedLabel: '', tone: 'match' };
    }
    return { key: field.key, label: field.label, ...comparison, resultLabel: TONE_LABEL[comparison.tone] };
  });
}

export function buildReconciliationRows(operation) {
  return (operation.reconciliation ?? []).map(item => {
    const diff = item.executed - item.contracted;
    const tone = diff === 0 ? 'match' : Math.abs(diff) >= 2 ? 'critical' : 'attention';
    return {
      concept: item.concept,
      unit: item.unit,
      contracted: item.contracted,
      executed: item.executed,
      diff,
      tone,
      resultLabel: TONE_LABEL[tone],
      note: item.note ?? '',
    };
  });
}

export function hasCriticalDiscrepancy(operation) {
  const planningRows = buildPlanningVsExecutionRows(operation);
  if (planningRows.some(row => row.tone === 'critical')) return true;
  const reconciliationRows = buildReconciliationRows(operation);
  if (reconciliationRows.some(row => row.tone === 'critical')) return true;
  return (operation.incidents ?? []).some(incident => incident.severity === 'critical' && incident.status === 'open');
}

export function hasMissingSignature(operation) {
  return (operation.signatures ?? []).some(signature => signature.status !== 'signed');
}

export function hasVisibleIncidents(operation) {
  return (operation.incidents ?? []).length > 0;
}

export function canQuickApprove(operation) {
  return operation.status === 'PENDING_REVIEW' && !hasCriticalDiscrepancy(operation);
}

const TAB_STATUS = {
  pending: 'PENDING_REVIEW',
  inReview: 'IN_REVIEW',
  approved: 'APPROVED',
  returned: 'RETURNED',
  resubmitted: 'RESUBMITTED',
};

export const REVIEW_TABS = [
  { id: 'pending', label: 'Pendientes', status: TAB_STATUS.pending },
  { id: 'inReview', label: 'En revisión', status: TAB_STATUS.inReview },
  { id: 'approved', label: 'Aprobadas', status: TAB_STATUS.approved },
  { id: 'returned', label: 'Devueltas', status: TAB_STATUS.returned },
  { id: 'resubmitted', label: 'Reenviadas', status: TAB_STATUS.resubmitted },
];

// PUJ / Atlantic Standard Time — matches the "-04:00" offset used throughout the review mocks
// (see reviewService.js). Comparing via toISOString()'s raw UTC date would misclassify "today"
// for several hours around UTC midnight, which falls at 20:00 station time — squarely inside
// the OCC's evening shift. Deriving the station's own calendar date keeps this correct
// regardless of the viewing device's own timezone.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function stationDateKey(date) {
  return new Date(date.getTime() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function isToday(isoString) {
  if (!isoString) return false;
  return stationDateKey(new Date(isoString)) === stationDateKey(new Date());
}

export function computeKpis(operations) {
  return {
    pending: operations.filter(operation => operation.status === 'PENDING_REVIEW').length,
    inReview: operations.filter(operation => operation.status === 'IN_REVIEW').length,
    approvedToday: operations.filter(operation => operation.status === 'APPROVED' && isToday(operation.approvedAt)).length,
    returned: operations.filter(operation => operation.status === 'RETURNED').length,
  };
}

export function computeTabCounts(operations) {
  return REVIEW_TABS.reduce((counts, tab) => {
    counts[tab.id] = operations.filter(operation => operation.status === tab.status).length;
    return counts;
  }, {});
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function getOrderReference(operation) {
  return operation.orderReference ?? `WO-${operation.id.replace('REV-', '')}`;
}

export function extractDateFromIso(isoString) {
  if (!isoString) return '';
  const match = isoString.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export function getFilterOptions(operations) {
  return {
    airlines: uniqueSorted(operations.map(operation => operation.flight.airline)),
    agents: uniqueSorted(operations.map(operation => operation.agent?.name)),
    supervisors: uniqueSorted(operations.map(operation => operation.supervisor?.name)),
    positions: uniqueSorted(operations.map(operation => operation.position)),
    serviceTypes: uniqueSorted(operations.flatMap(operation => (operation.services ?? []).map(service => service.name))),
  };
}
