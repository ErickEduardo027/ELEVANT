import { RAMP_POSITIONS } from './positionsData';

// Internal planning references, not coordinates verified by IDAC. The AIP is
// linked for reconciliation only; its coordinates are not copied here.
export const AIP_PARKING_CHART_URL = 'https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_03-24.pdf';
export const AIP_AMENDMENT_URL = 'https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_3-26/AMDT_AIRAC_03-26.pdf';
export const RETIRED_DASHBOARD_POSITIONS = RAMP_POSITIONS.filter(position => position.id === 'B33');
export const DASHBOARD_POSITIONS = RAMP_POSITIONS.filter(position => position.id !== 'B33');

// Match the planning code exactly. Similar AIP labels must never be inferred.
export function unlocatedStandAssignments(turnarounds = [], positions = DASHBOARD_POSITIONS) {
  const locatedIds = new Set(positions.map(position => position.id));
  const byCode = new Map();
  for (const turnaround of turnarounds) {
    const code = turnaround.stand?.code?.trim().toUpperCase();
    if (!code || locatedIds.has(code)) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(turnaround);
  }
  return [...byCode].map(([code, assignments]) => ({ code, assignments }));
}
