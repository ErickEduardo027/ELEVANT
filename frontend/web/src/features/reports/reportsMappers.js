import { classifyGroundTimeStatus } from '../../services/reportsService';

export const REPORT_TABS = [
  { id: 'closure', label: 'Cierre operacional' },
  { id: 'reconciliation', label: 'Conciliación de servicios' },
  { id: 'groundTime', label: 'Tiempo en tierra' },
  { id: 'summary', label: 'Resumen operativo' },
];

export const DATE_PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Rango personalizado' },
];

// PUJ / Atlantic Standard Time — mismo criterio que reviewMappers.js/reportsService.js.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function stationDateKey(date) {
  return new Date(date.getTime() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function startOfWeekDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const isoWeekday = utcDate.getUTCDay() === 0 ? 7 : utcDate.getUTCDay();
  return addDaysToDateKey(dateKey, -(isoWeekday - 1));
}

function startOfMonthDateKey(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

export function resolveDateRange(preset, customFrom, customTo) {
  const today = stationDateKey(new Date());
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = addDaysToDateKey(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: startOfWeekDateKey(today), to: today };
    case 'month':
      return { from: startOfMonthDateKey(today), to: today };
    case 'custom':
    default:
      return { from: customFrom || today, to: customTo || today };
  }
}

const SHORT_MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export function formatDateKey(dateKey) {
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[month - 1]} ${year}`;
}

export function formatDateKeyShort(dateKey) {
  if (!dateKey) return '';
  const [, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[month - 1]}`;
}

export function formatPeriodLabel(from, to) {
  if (!from || !to) return '';
  return from === to ? formatDateKey(from) : `${formatDateKey(from)} — ${formatDateKey(to)}`;
}

export function formatLeadTime(minutes) {
  if (minutes == null) return 'Sin registro';
  return `${minutes} min`;
}

export function formatSignedMinutes(diffMinutes) {
  if (diffMinutes === 0) return '0 min';
  return `${diffMinutes > 0 ? '+' : ''}${diffMinutes} min`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function getReportFilterOptions(records) {
  return {
    airlines: uniqueSorted(records.map(record => record.flight.airline)),
    agents: uniqueSorted(records.map(record => record.agent?.name)),
    terminals: uniqueSorted(records.map(record => record.terminal)),
    positions: uniqueSorted(records.map(record => record.position?.final)),
  };
}

export function computeSummaryKpis(records) {
  if (records.length === 0) {
    return { flightsHandled: 0, servicesExecuted: 0, incidentOperations: 0, avgGroundTimeMinutes: 0, slaCompliancePct: 0 };
  }

  const servicesExecuted = records.reduce(
    (sum, record) => sum + record.services.reduce((serviceSum, service) => serviceSum + service.executedQty, 0),
    0
  );
  const incidentOperations = records.filter(record => record.incidents > 0).length;
  const totalGroundTime = records.reduce((sum, record) => sum + record.groundTime.actualMinutes, 0);
  const withinSlaCount = records.filter(
    record => classifyGroundTimeStatus(record.groundTime.contractedMinutes, record.groundTime.actualMinutes) === 'within_sla'
  ).length;

  return {
    flightsHandled: records.length,
    servicesExecuted,
    incidentOperations,
    avgGroundTimeMinutes: Math.round(totalGroundTime / records.length),
    slaCompliancePct: Math.round((withinSlaCount / records.length) * 100),
  };
}

export function buildFlightsByPeriodChart(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.date, (counts.get(record.date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([dateA], [dateB]) => (dateA < dateB ? -1 : dateA > dateB ? 1 : 0))
    .map(([date, count]) => ({ label: formatDateKeyShort(date), value: count }));
}

export function buildFlightStatusDistribution(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.flightStatus, (counts.get(record.flightStatus) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

export function buildServicesByTypeChart(records) {
  const counts = new Map();
  for (const record of records) {
    for (const service of record.services) {
      counts.set(service.name, (counts.get(service.name) ?? 0) + service.executedQty);
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([label, value]) => ({ label, value }));
}

export function buildAgentWorkloadChart(records) {
  const counts = new Map();
  for (const record of records) {
    const agentName = record.agent?.name ?? 'Sin asignar';
    counts.set(agentName, (counts.get(agentName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([label, value]) => ({ label, value }));
}

export function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
