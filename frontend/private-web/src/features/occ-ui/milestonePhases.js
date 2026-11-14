// The milestones of a turnaround grouped by the four phases of AVIAM's flight report (ADR-0031), for
// OccMilestoneStrip. Pure. The recorded milestones are the `milestones` field of each flight of getOccMapFlights
// (contratos 1.3), `[{ code, actualAt }]`; the catalogue and its order come from the shared client, so a phase always
// counts against the milestones the tablet can record (6, 13, 4 and 2: 25 in all).
import { FLIGHT_REPORT_MILESTONES, FLIGHT_REPORT_PHASES, isFlightReportMilestoneCode } from '@elevant/api-client';
import { milestoneLabel } from '../operations/operationLabels';
import { occUiMessages } from './occUiMessages';
import { toInstantMs } from './occTime';

/**
 * The four phases in the order of the flight report: `[{ id, label, done, total, milestones }]`, each milestone
 * `{ code, label, actualAt }` in the catalogue's order, with `actualAt` null while it is pending. A milestone counts as
 * recorded once, at its first valid time; codes the catalogue does not know are ignored. Labels are in `language`.
 */
export function buildMilestonePhases(milestones, language = 'es') {
  const recorded = new Map();
  for (const item of Array.isArray(milestones) ? milestones : []) {
    if (!isFlightReportMilestoneCode(item?.code) || recorded.has(item.code)) continue;
    if (Number.isFinite(toInstantMs(item.actualAt))) recorded.set(item.code, item.actualAt);
  }
  const phaseLabels = occUiMessages[language]?.milestones?.phases ?? occUiMessages.es.milestones.phases;
  return FLIGHT_REPORT_PHASES.map(phase => {
    const list = FLIGHT_REPORT_MILESTONES.filter(milestone => milestone.phase === phase.id).map(milestone => ({
      code: milestone.code,
      label: milestoneLabel(milestone.code, language),
      actualAt: recorded.get(milestone.code) ?? null,
    }));
    return {
      id: phase.id,
      label: phaseLabels[phase.id] ?? phase.label,
      done: list.filter(milestone => milestone.actualAt !== null).length,
      total: list.length,
      milestones: list,
    };
  });
}
