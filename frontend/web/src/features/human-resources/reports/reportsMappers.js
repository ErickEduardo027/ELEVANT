import { TONE_HEX } from '../../../components/toneColors';

export const REPORT_TABS = [
  { id: 'expirations', label: 'Vencimientos' },
  { id: 'accountMovements', label: 'Altas y bajas' },
  { id: 'staffDistribution', label: 'Personal por terminal y turno' },
  { id: 'qualificationCoverage', label: 'Cobertura de habilitaciones' },
];

export const DATE_PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Rango personalizado' },
];

// PUJ / Atlantic Standard Time — mismo criterio que reportsMappers.js de
// Admin/OCC y que el resto de mocks del proyecto.
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

export function formatEventDateTime(isoString) {
  return new Date(isoString).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const DOCUMENT_KIND_OPTIONS = [
  { value: 'certification', label: 'Habilitación' },
  { value: 'permit', label: 'Carnet / Licencia' },
];

export const EXPIRATION_STATUS_OPTIONS = [
  { value: 'current', label: 'Vigente' },
  { value: 'expiringSoon', label: 'Próxima a vencer' },
  { value: 'expired', label: 'Vencida' },
];

export const TERMINAL_OPTIONS = [
  { value: 'A', label: 'Terminal A' },
  { value: 'B', label: 'Terminal B' },
];

export const SHIFT_BLOCK_OPTIONS = [
  { value: 'morning', label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'night', label: 'Madrugada' },
];

// Incluye FBO aunque los turnos mock (Horarios) todavía no lo modelan — el
// brief pide explícitamente "Terminal A, Terminal B y FBO" como categorías
// del gráfico; queda en 0 hasta que exista un turno con ese terminal, igual
// que el segmento "unassigned" de StaffDistributionChart en el Dashboard.
const STAFF_TERMINAL_SEGMENTS_META = [
  { key: 'A', label: 'Terminal A', color: TONE_HEX.info },
  { key: 'B', label: 'Terminal B', color: TONE_HEX.active },
  { key: 'FBO', label: 'FBO / Aviación local', color: TONE_HEX.success },
];

export function buildStaffTerminalSegments(rows) {
  return STAFF_TERMINAL_SEGMENTS_META.map(meta => ({
    ...meta,
    value: rows.filter(row => row.terminal === meta.key).length,
  }));
}

export function buildStaffShiftItems(rows) {
  return SHIFT_BLOCK_OPTIONS.map(option => ({
    key: option.value,
    label: option.label,
    value: rows.filter(row => row.block === option.value).length,
  }));
}

export function buildMovementTrend(rows, kind) {
  const counts = new Map();
  for (const row of rows) {
    if (row.movementKind !== kind) continue;
    const dateKey = row.occurredAt.slice(0, 10);
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ label: formatDateKeyShort(date), value: count }));
}

function coverageTone(coveragePercent) {
  if (coveragePercent == null) return 'neutral';
  if (coveragePercent >= 80) return 'success';
  if (coveragePercent >= 60) return 'warning';
  return 'danger';
}

export function buildCoverageSummary(coverage) {
  const total = coverage.length;
  const active = coverage.filter(item => item.coveragePercent != null && item.coveragePercent >= 80).length;
  const warning = coverage.filter(item => item.coveragePercent != null && item.coveragePercent >= 60 && item.coveragePercent < 80).length;
  const critical = coverage.filter(item => item.coveragePercent != null && item.coveragePercent < 60).length;
  const averageCoverage =
    total === 0
      ? 0
      : Math.round(
          coverage.reduce((sum, item) => sum + (item.coveragePercent ?? 0), 0) / total
        );

  return { total, active, warning, critical, averageCoverage };
}

export function mapCoverageRow(item) {
  return {
    ...item,
    coverageTone: coverageTone(item.coveragePercent),
    needCount: item.totalAgents,
    activeCount: item.activeCount,
    warningCount: item.expiringSoonCount,
    expiredCount: item.expiredCount,
  };
}

export function buildCoverageChartData(coverage) {
  return coverage
    .map(item => ({
      label: item.equipmentName,
      value: item.coveragePercent ?? 0,
    }))
    .sort((a, b) => b.value - a.value);
}
