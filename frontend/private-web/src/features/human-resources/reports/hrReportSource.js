import { exportHumanResourcesReport, getHumanResourcesReport, listHumanResourcesReports } from
  '../../../services/humanResourcesVerifiedReportsService';
import { formatReportCell, KIND_LABELS } from './reportLabels';

/** The Gestión Humana reports the screen knows, with their columns in the order the exports write them. */
export const HR_REPORT_COLUMNS = Object.freeze({
  expirations: [['expiresOn', 'Vence', 'date'], ['agentName', 'Agente'], ['employeeNumber', 'Empleado'],
    ['kind', 'Clase'], ['code', 'Documento']],
  'account-movements': [['occurredAt', 'Fecha y hora local'], ['agentName', 'Agente'], ['employeeNumber', 'Empleado'],
    ['kind', 'Movimiento']],
  'staff-distribution': [['workDate', 'Fecha', 'date'], ['agentName', 'Agente'], ['employeeNumber', 'Empleado'],
    ['terminalCode', 'Terminal'], ['positionCode', 'Puesto'], ['startsAtLocal', 'Inicio'], ['endsAtLocal', 'Fin']],
  'qualification-coverage': [['equipmentCode', 'Equipo'], ['equipmentName', 'Nombre'],
    ['eligibleAgents', 'Elegibles', 'number'], ['qualifiedAgents', 'Habilitados', 'number'],
    ['withoutQualification', 'Sin habilitación vigente', 'number'], ['qualifiedShare', '% habilitados', 'percent']],
});

const DESCRIPTIONS = Object.freeze({
  expirations: 'Habilitaciones y permisos de los agentes de la estación que vencen en el período.',
  'account-movements': 'Altas, desactivaciones y reactivaciones de las cuentas de los agentes, en hora local. Solo '
    + 'cuenta los movimientos cuya auditoría identifica esta estación.',
  'staff-distribution': 'Turnos programados de cada agente por día, terminal y puesto, con su horario local.',
  'qualification-coverage': 'Por equipo que exige habilitación, a la fecha de corte: los agentes formados en él '
    + '(elegibles) y cuántos tienen la habilitación vigente.',
});

/** The screen's own catalog while the API has none (ADR-0048 adds it with a year of range). */
export const LOCAL_HR_CATALOG = Object.freeze({
  maxRangeDays: 30,
  reports: Object.keys(HR_REPORT_COLUMNS).map(key => ({ key, title: KIND_LABELS[key], description: DESCRIPTIONS[key],
    asOfDate: key === 'qualification-coverage', filters: [] })),
});

export const DOCUMENT_KIND_OPTIONS = Object.freeze([
  { value: 'Qualification', label: 'Habilitaciones' }, { value: 'Permit', label: 'Permisos' }]);
export const VALIDITY_OPTIONS = Object.freeze([{ value: 'Current', label: 'Vigentes' }, { value: 'Expired', label: 'Vencidas' }]);

/** A coverage row with what the export adds: those without a current qualification and their share. */
function coverageRow(row) {
  const eligible = Number(row.eligibleAgents) || 0;
  const qualified = Number(row.qualifiedAgents) || 0;
  return { ...row, withoutQualification: Math.max(0, eligible - qualified),
    qualifiedShare: eligible ? String(Math.round((qualified / eligible) * 1000) / 10) : '' };
}

/** A Gestión Humana page in the shape of useServerReport, its codes in Spanish (reportLabels). */
export function normalizeHrPage(kind, page, { permitNames = null } = {}) {
  const columns = HR_REPORT_COLUMNS[kind];
  const rows = kind === 'qualification-coverage' ? page.rows.map(coverageRow) : page.rows;
  const stationAgents = kind === 'qualification-coverage' ? page.rows.find(row => Number.isInteger(row.stationAgents))
    ?.stationAgents : undefined;
  return {
    key: kind, title: KIND_LABELS[kind], asOf: page.asOf, page: page.page, hasMore: page.hasMore, totalRows: null,
    columns: columns.map(([, label, type = 'text']) => ({ label, type })),
    rows: rows.map(row => columns.map(([field, , type]) => (type ? row[field] ?? '' : formatReportCell(kind, field, row,
      { permitNames })))),
    // An equipment counts the same agents as the next: «Elegibles» never add up across equipment.
    totals: null,
    summary: Number.isInteger(stationAgents) ? [{ label: 'Agentes activos de la estación', value: String(stationAgents),
      context: 'la base de «Elegibles» y «Habilitados» a la fecha de corte' }] : [],
    appliedFilters: [],
  };
}

/** The adapter of Gestión Humana › Reportes for useServerReport. */
export function createHrReportSource({ permitNames } = {}) {
  return {
    baseParams: ['stationId'],
    paramsFor: definition => (definition?.key === 'expirations' ? ['documentKind', 'validity'] : []),
    loadCatalog: async ({ signal } = {}) => {
      const catalog = await listHumanResourcesReports({ signal });
      if (!catalog) return LOCAL_HR_CATALOG;
      return { maxRangeDays: catalog.maxRangeDays, reports: catalog.reports
        .filter(report => Object.hasOwn(HR_REPORT_COLUMNS, report.key))
        .map(report => ({ key: report.key, title: report.title, description: report.description, asOfDate: report.asOfDate,
          filters: [] })) };
    },
    loadPage: async (kind, query, { signal } = {}) =>
      normalizeHrPage(kind, await getHumanResourcesReport(kind, query, { signal }), { permitNames }),
    exportReport: (kind, query, format) => exportHumanResourcesReport(kind, query, format),
    fileName: (kind, query, format) => `elevant-gh-${kind}-${query.from}-${query.to}.${format}`,
  };
}
