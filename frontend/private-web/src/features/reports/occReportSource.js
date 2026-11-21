import { getManualTurnaroundOptions } from '../../services/planningService';
import { loadOccCoverage } from '../../services/occCoverageService';
import { exportOccReport, getOccReport, listOccReports, occReportFileName } from '../../services/occReportsService';
import { normalizeServerPage } from './reportModel';

/** Every OCC report takes the station; the catalog adds each report's own filters (ADR-0048). */
const BASE_PARAMS = Object.freeze(['stationId']);

/** The adapter of OCC › Reportes for useServerReport, for the station of the OCC frame. */
export function createOccReportSource(stationCode) {
  return {
    baseParams: BASE_PARAMS,
    loadCatalog: ({ signal } = {}) => listOccReports({ signal }),
    loadPage: async (key, query, { signal } = {}) => normalizeServerPage(await getOccReport(key, query, { signal })),
    exportReport: (key, query, format) => exportOccReport(key, query, format),
    fileName: (key, query, format) => occReportFileName(key, query, format, stationCode),
  };
}

const byLabel = (left, right) => left.label.localeCompare(right.label, 'es');

/**
 * The options of a filter that does not list its own (airline, agent, terminal): read from the screens that already
 * know them, for the station's day. A list the account cannot read gives `null` and the screen leaves the filter out,
 * so there is never a control that cannot be used.
 */
export async function loadOccFilterOptions(kind, stationId, date, { signal } = {}) {
  try {
    if (kind === 'airline') {
      const options = await getManualTurnaroundOptions(stationId, date, { signal });
      const airlines = [...(options?.airlines ?? []), ...(options?.charterAirlines ?? [])];
      const unique = new Map(airlines.map(airline => [airline.id, {
        value: airline.id, label: airline.iataCode ? `${airline.name} (${airline.iataCode})` : airline.name }]));
      return [...unique.values()].sort(byLabel);
    }
    if (kind === 'agent' || kind === 'terminal') {
      const board = await loadOccCoverage(stationId, date, { signal });
      if (kind === 'terminal') return (board?.terminals ?? []).map(terminal => ({ value: terminal.terminalId,
        label: terminal.name && terminal.name !== terminal.code ? `${terminal.code} · ${terminal.name}` : terminal.code }))
        .sort(byLabel);
      return (board?.agents ?? []).map(agent => ({ value: agent.agentId, label: `${agent.name} (${agent.employeeNumber})` }))
        .sort(byLabel);
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
  return null;
}
