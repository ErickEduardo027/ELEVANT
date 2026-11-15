import { buildMilestonePhases } from '../../occ-ui/milestonePhases';

// The milestone strip of the console's «Inspector» (contratos 2.5, design D22): the milestones the agent recorded on the
// tablet for the selected flight's operation, from the `milestones` field of the map flights (contratos 1.3: no
// separate read; every tap already announces occ_planning, which re-reads the flights). Pure.

const NO_FLIGHTS = Object.freeze([]);
const NO_PHASES = Object.freeze([]);

/**
 * The strip of `flight` (a map flight) for occ-ui/OccMilestoneStrip.jsx: `{ status, phases }`. Both legs of its visit
 * (the flights of `flights` with its visitKey) carry the milestones of one operation, so they are joined and each one
 * counts once, at its first time (occ-ui/milestonePhases.js). Without an operation yet (no leg of the visit has one)
 * the status is `empty` and there are no phases: the strip says when its milestones appear. Labels are in `language`.
 */
export function inspectorMilestones(flight, flights = NO_FLIGHTS, language = 'es') {
  if (flight === null || typeof flight !== 'object') return Object.freeze({ status: 'empty', phases: NO_PHASES });
  const visitKey = flight.visitKey ?? null;
  const others = visitKey === null || !Array.isArray(flights) ? NO_FLIGHTS
    : flights.filter(other => other !== null && typeof other === 'object' && other !== flight
      && other.visitKey === visitKey && other.flightKey !== flight.flightKey);
  const legs = [flight, ...others];
  const operationId = legs.map(leg => leg.turnaround?.operationId).find(Boolean) ?? null;
  if (operationId === null) return Object.freeze({ status: 'empty', phases: NO_PHASES });
  const milestones = legs.flatMap(leg => (Array.isArray(leg.milestones) ? leg.milestones : []));
  return Object.freeze({ status: 'ready', phases: Object.freeze(buildMilestonePhases(milestones, language)) });
}
