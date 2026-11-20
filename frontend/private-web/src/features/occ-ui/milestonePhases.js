// The milestones of a turnaround grouped by the four phases of AVIAM's flight report (ADR-0031), for
// OccMilestoneStrip. Pure. The recorded milestones are the `milestones` field of each flight of getOccMapFlights
// (contratos 1.3), `[{ code, actualAt }]`; the catalogue and its order come from the shared client, so a phase always
// counts against the milestones the tablet can record (6, 13, 4 and 2: 25 in all). milestoneSequenceNotes reads those
// phases for OCC's review: a push-back recorded out of sequence (N2).
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

// The phases between the block-on and the push-back, in the order of the flight report.
const PHASES_BEFORE_PUSHBACK = new Set(['on_stand', 'departure']);

/**
 * What OCC's review should check in the order of the milestones (N2). The push-back releases the stand and ends the
 * ground time (ADR-0041, decision 23), and ELEVANT only refuses a block-on after it (3-N25), so a push-back recorded too
 * early still reaches the review. Pure, over the phases of buildMilestonePhases; nothing without a recorded push-back.
 * The notes, in the order of the flight:
 * - `{ kind: 'noBlockOn' }`: the block-on is not recorded;
 * - `{ kind: 'emptyPhase', phase, label }`: «En posición» or «Salida» has no milestone, `label` in the phases' language;
 * - `{ kind: 'afterPushback', count }`: milestones whose time is later than the push-back's.
 */
export function milestoneSequenceNotes(phases) {
  const list = Array.isArray(phases) ? phases : [];
  const milestones = list.flatMap(phase => (Array.isArray(phase?.milestones) ? phase.milestones : []));
  const pushedBackAt = toInstantMs(milestones.find(milestone => milestone.code === 'PUSHBACK')?.actualAt);
  if (!Number.isFinite(pushedBackAt)) return [];
  const notes = [];
  if (!milestones.some(milestone => milestone.code === 'BLOCK_ON' && milestone.actualAt !== null)) {
    notes.push({ kind: 'noBlockOn' });
  }
  for (const phase of list) {
    if (PHASES_BEFORE_PUSHBACK.has(phase?.id) && phase.done === 0) {
      notes.push({ kind: 'emptyPhase', phase: phase.id, label: phase.label });
    }
  }
  const after = milestones.filter(milestone => milestone.code !== 'PUSHBACK' &&
    toInstantMs(milestone.actualAt) > pushedBackAt).length;
  if (after > 0) notes.push({ kind: 'afterPushback', count: after });
  return notes;
}
