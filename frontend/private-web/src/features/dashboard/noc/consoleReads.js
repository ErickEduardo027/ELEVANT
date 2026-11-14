import { OCC_COALESCE_MS, OCC_SAFETY_POLL_MS } from '../../admin-occ/live/occCadence';

// The console's own reads and their cadence (contratos 2.7), one table for useConsoleData.js and the request budget
// (admin-occ/live/occRequestPlan.js, checked by occRequestBudget.test.js). Each one re-reads on its own 60 s poll only,
// never on `occ_planning`: a tablet tap refreshes the map flights alone. The one exception is the review queue, which
// the alerts panel re-reads on `occ_review` (at most once every 3 s). The notices are the shell's single read for the
// frame (useOccShell().notices), and the flights and the sky are the map's (maps/useMapSituation.js:
// MAP_SITUATION_READS), so none of them is read here.
//
// `key` names the read in its errors, `read` is the operation of the shared client it sends, and `permission` the
// department permission without which useOccResource sends nothing (contratos 2.7).

const read = fields => Object.freeze({ ...fields, resources: Object.freeze([...fields.resources]),
  pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS });

export const CONSOLE_READS = Object.freeze({
  // The station's day as the server decides it: its turnarounds with their resources.
  planning: read({ key: 'console.planning', read: 'getOccPlanningSnapshot', permission: 'operations.planning.read',
    resources: [] }),
  // The positions board of the station's day: who is on each stand and who covers it.
  positions: read({ key: 'console.positions', read: 'getOccPositions', permission: 'operations.positions_map.read',
    resources: [] }),
  // The operations handed off to OCC: «Por revisar».
  reviewQueue: read({ key: 'console.reviewQueue', read: 'getOccReviewQueue', permission: 'operations.review.read',
    resources: ['occ_review'] }),
  // The assigned agents who cannot operate on the planning's day (2-N25); it waits for that day.
  readiness: read({ key: 'console.readiness', read: 'getOccAssignmentReadiness', permission: 'operations.planning.read',
    resources: [] }),
});
