import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { runwayEnd } from '../airport/runwayInUse';
import { buildArrivalTrajectory, buildDepartureTrajectory, sampleTrajectory } from '../kinematics/estimator';
import { perfFor } from '../kinematics/perfProfiles';
import { createAirPicture, createMapFlights, TRAFFIC_NOON } from '../testing/trafficFixtures';

// Two lab scenes of CN-29, CN-30 and CN-31, on invented data (no provider, no real flight):
// - «airfield-3d-replay»: a real flight's whole visit as the air picture would bring it, one fix every 3 s (the
//   server's airfield read): CM893 (Copa, B738) on final for 08, its landing, its taxi to A6, parked, the push-back of
//   CM894, its taxi-out and its take-off. The fixes are sampled from the map's own kinematics at fixed instants, so every
//   run reads the same; the map draws them as live fixes (handoff.js), never as an estimate. The phases' instants are
//   exported for the visual suite (map-lab.follow3d.spec.mjs).
// - «approach-live-offplan»: the report of CN-29: AA465 (A321) at 3 800 ft and 261 kt north-west of Higüey, live, with
//   its trail from the north-west, chosen, among a crowd of aircraft on the ground at the terminals (their tags).

const NOON_MS = parseInstant(TRAFFIC_NOON);
const FEET_PER_METRE = 3.28084;
const KNOTS_PER_MS = 1.943844;
const FPM_PER_MS = 196.8504;
const FIX_EVERY_MS = 3_000;
const STAND = 'A6';
const PERF = perfFor({ typeIcao: 'B738' });
const iso = ms => new Date(ms).toISOString();
const round6 = value => Math.round(value * 1e6) / 1e6;
const id = number => `5c900000-0000-4000-8000-${String(number).padStart(12, '0')}`;

const PTY = Object.freeze({ iataCode: 'PTY', icaoCode: 'MPTO', name: 'Tocumen International', latitude: 9.0714,
  longitude: -79.3835 });
const MIA = Object.freeze({ iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International', latitude: 25.7932,
  longitude: -80.2906 });
const COPA = Object.freeze({ id: id(1), name: 'Copa Airlines', iataCode: 'CM', icaoCode: 'CMP' });
const AMERICAN = Object.freeze({ id: id(2), name: 'American Airlines', iataCode: 'AA', icaoCode: 'AAL' });

/** The instants of the replayed visit, in seconds from the lab's noon. */
export const REPLAY_TIMES = Object.freeze({
  touchdownS: 150,
  onBlockS: 150 + 330,
  offBlockS: 150 + 330 + 180,
});

const standOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code);
const END_08 = runwayEnd(MDPC_LAYOUT, '08');

// The visit as the map's kinematics fly it: the arrival from Panama to A6, landing at the touchdown and on blocks at
// the on-block, and the departure from A6 at the off-block towards Panama.
const ARRIVAL = buildArrivalTrajectory({
  times: { scheduledAtMs: NOON_MS + REPLAY_TIMES.onBlockS * 1_000, estimatedAtMs: null,
    actualAtMs: NOON_MS + REPLAY_TIMES.touchdownS * 1_000, actualKind: 'Runway',
    blockOnAtMs: NOON_MS + REPLAY_TIMES.onBlockS * 1_000, pushbackAtMs: null },
  origin: [PTY.longitude, PTY.latitude], layout: MDPC_LAYOUT, runwayEnd: END_08, stand: standOf(STAND), perf: PERF,
  imported: true,
});
const DEPARTURE = buildDepartureTrajectory({
  times: { offBlockMs: NOON_MS + REPLAY_TIMES.offBlockS * 1_000, takeoffMs: null },
  destination: [PTY.longitude, PTY.latitude], layout: MDPC_LAYOUT, runwayEnd: END_08, stand: standOf(STAND), perf: PERF,
});

const takeoffLeg = DEPARTURE?.legs.find(leg => leg.phase === 'takeoff') ?? null;

/** The phases of the replay and the instant (ms) each one is photographed at by the visual suite. */
export const REPLAY_PHASES = Object.freeze({
  approach: NOON_MS + 60_000,
  touchdown: NOON_MS + (REPLAY_TIMES.touchdownS + 3) * 1_000,
  taxiIn: NOON_MS + (REPLAY_TIMES.touchdownS + 150) * 1_000,
  parked: NOON_MS + (REPLAY_TIMES.onBlockS + 60) * 1_000,
  pushback: NOON_MS + (REPLAY_TIMES.offBlockS + 25) * 1_000,
  taxiOut: NOON_MS + (REPLAY_TIMES.offBlockS + 160) * 1_000,
  takeoff: takeoffLeg ? Math.round(takeoffLeg.t0Ms + 0.85 * (takeoffLeg.t1Ms - takeoffLeg.t0Ms)) : NOON_MS,
  climb: takeoffLeg ? takeoffLeg.t1Ms + 25_000 : NOON_MS,
});

// Where the visit is at `tMs`: the arrival until its on-block, parked on A6 until the off-block, then the departure.
function truthAt(tMs) {
  if (tMs < NOON_MS + REPLAY_TIMES.offBlockS * 1_000) return ARRIVAL ? sampleTrajectory(ARRIVAL, tMs) : null;
  return DEPARTURE ? sampleTrajectory(DEPARTURE, tMs) : null;
}

/** The fix of the replayed aircraft reported at `fixAtMs` (a multiple of 3 s), as the air picture brings it. */
export function replayFixAt(fixAtMs) {
  const truth = truthAt(fixAtMs);
  if (!truth) return null;
  const departing = fixAtMs >= NOON_MS + REPLAY_TIMES.offBlockS * 1_000;
  return {
    hex: 'f0c093', callsign: departing ? 'CMP894' : 'CMP893', registration: 'ZZ-CM893', typeIcaoCode: 'B738',
    category: 'A3', latitude: round6(truth.lat), longitude: round6(truth.lon),
    altitudeFeet: truth.onGround ? null : Math.round(truth.altM * FEET_PER_METRE),
    onGround: truth.onGround === true, groundSpeedKnots: Math.round((truth.gsMs ?? 0) * KNOTS_PER_MS),
    trackDegrees: Number.isFinite(truth.trackDeg) ? Math.round(truth.trackDeg * 10) / 10 : null,
    verticalRateFeetPerMinute: truth.onGround ? null : Math.round((truth.vrateMs ?? 0) * FPM_PER_MS),
    squawk: departing ? '2215' : '3417', positionAt: iso(fixAtMs),
    matchedFlightKey: departing ? REPLAY_KEYS.departure : REPLAY_KEYS.arrival, matchedBy: 'Callsign', trail: [],
  };
}

/** The flight keys of the replayed visit and the id the map draws its aircraft as at `tMs`. */
export const REPLAY_KEYS = Object.freeze({ arrival: `p:${id(893)}`, departure: `p:${id(894)}` });
export const replayAircraftId = tMs => `f:${tMs >= NOON_MS + REPLAY_TIMES.offBlockS * 1_000
  ? REPLAY_KEYS.departure : REPLAY_KEYS.arrival}`;

// The map flights of the visit read at `readAtMs`: the arrival's phase and milestones as the tablet and the provider
// would have them by then.
function replayFlights(readAtMs) {
  const base = createMapFlights();
  const template = base.flights[0];
  const after = seconds => readAtMs >= NOON_MS + seconds * 1_000;
  const milestones = [
    ...(after(REPLAY_TIMES.onBlockS)
      ? [{ code: 'BLOCK_ON', actualAt: iso(NOON_MS + REPLAY_TIMES.onBlockS * 1_000) }] : []),
    ...(after(REPLAY_TIMES.onBlockS + 40)
      ? [{ code: 'STAIRS_JETBRIDGE', actualAt: iso(NOON_MS + (REPLAY_TIMES.onBlockS + 40) * 1_000) }] : []),
    ...(after(REPLAY_TIMES.offBlockS - 30)
      ? [{ code: 'PAX_DOOR_CLOSED', actualAt: iso(NOON_MS + (REPLAY_TIMES.offBlockS - 30) * 1_000) }] : []),
    ...(after(REPLAY_TIMES.offBlockS) ? [{ code: 'PUSHBACK', actualAt: iso(NOON_MS + REPLAY_TIMES.offBlockS * 1_000) }] : []),
  ];
  let phase = 'approaching';
  if (after(REPLAY_TIMES.touchdownS)) phase = 'landed';
  if (after(REPLAY_TIMES.onBlockS)) phase = 'arrived';
  const stand = { id: id(600), code: STAND, terminalCode: standOf(STAND).terminal };
  const turnaround = { id: id(700), operationCode: 'CM893-1113', status: 'InProgress', operationId: id(701),
    operationStatus: 'InProgress' };
  const aircraft = { registration: 'ZZ-CM893', typeIcaoCode: 'B738', model: '737-800', sizeCategory: 'Narrowbody' };
  const arrival = {
    ...template, flightKey: REPLAY_KEYS.arrival, visitKey: REPLAY_KEYS.arrival, proposalId: id(893), legId: id(8930),
    turnaroundId: turnaround.id, direction: 'Arrival', flightNumber: 'CM893', callsign: 'CMP893', airline: COPA,
    counterpart: PTY, scheduledAt: iso(NOON_MS + (REPLAY_TIMES.onBlockS - 120) * 1_000),
    estimatedAt: iso(NOON_MS + REPLAY_TIMES.onBlockS * 1_000),
    actualAt: after(REPLAY_TIMES.touchdownS) ? iso(NOON_MS + REPLAY_TIMES.touchdownS * 1_000) : null,
    actualKind: after(REPLAY_TIMES.touchdownS) ? 'Runway' : null, phase, providerStatus: null, aircraft,
    imported: true, turnaround, stand, milestones, isDemo: false, demo: null,
  };
  const departed = after(REPLAY_TIMES.offBlockS + 300);
  const departure = {
    ...arrival, flightKey: REPLAY_KEYS.departure, proposalId: id(894), legId: id(8940), direction: 'Departure',
    flightNumber: 'CM894', callsign: 'CMP894', scheduledAt: iso(NOON_MS + REPLAY_TIMES.offBlockS * 1_000),
    estimatedAt: null, actualAt: null, actualKind: null, phase: departed ? 'departed' : 'scheduled',
  };
  return { ...base, serverTime: iso(readAtMs), flights: [arrival, departure] };
}

/** The air picture of the replay answered at `readAtMs`: its last fix (1 s before) and the 8 fixes before it. */
function replayPicture(readAtMs) {
  const live = createAirPicture();
  const lastFixAt = Math.floor((readAtMs - 1_000) / FIX_EVERY_MS) * FIX_EVERY_MS;
  const fix = replayFixAt(lastFixAt);
  const trail = [];
  for (let at = lastFixAt - 8 * FIX_EVERY_MS; at < lastFixAt; at += FIX_EVERY_MS) {
    const point = replayFixAt(at);
    if (point) trail.push({ at: point.positionAt, latitude: point.latitude, longitude: point.longitude,
      altitudeFeet: point.altitudeFeet, onGround: point.onGround });
  }
  return {
    ...live, serverTime: iso(readAtMs), observedAt: iso(lastFixAt), ageSeconds: Math.round((readAtMs - lastFixAt) / 1_000),
    aircraft: fix ? [{ ...fix, trail }] : [],
  };
}

/** The replay scenario as the read answered at `readAtMs` brings it (lab/trafficScenes.js: feedScenarioAt). */
export function replayScenarioAt(readAtMs) {
  return { at: iso(readAtMs), picture: replayPicture(readAtMs), flights: replayFlights(readAtMs), tracks: {},
    replay: true, feed: REPLAY_FEED, phases: REPLAY_PHASES };
}

/** The replay is read every 3 s, half a second late, as the server's airfield read answers (CN-31). */
export const REPLAY_FEED = Object.freeze({ periodMs: 3_000, lateMs: 500, offsetsMs: Object.freeze([0]) });

// The report of CN-29 (AA465) and the crowd at the terminals.
export const OFFPLAN_KEY = `p:${id(465)}`;
const HIGUEY_NW = Object.freeze([-68.8, 18.7]);
const CROWD = Object.freeze([
  ['f0c001', 'ACA1410', 'B789', 'B22'], ['f0c002', 'AAL333', 'B738', 'B23'], ['f0c003', 'DAL1882', 'A321', 'B24'],
  ['f0c004', 'JBU2737', 'A320', 'B25'], ['f0c005', 'UAL1567', 'B39M', 'B26'], ['f0c006', 'SWG514', 'B38M', 'B27'],
  ['f0c007', 'TSC968', 'A321', 'A3'], ['f0c008', 'WJA2712', 'B38M', 'A4'], ['f0c009', 'AFR3532', 'B77W', 'A5'],
  ['f0c00a', 'NKS903', 'A20N', 'A7'],
]);

export function offPlanScenario() {
  const live = createAirPicture();
  const at = NOON_MS - 2_000;
  const trail = Array.from({ length: 8 }, (_, index) => {
    const point = destinationPoint(HIGUEY_NW, 300, (8 - index) * 3_600);
    return { at: iso(at - (8 - index) * 27_000), latitude: round6(point[1]), longitude: round6(point[0]),
      altitudeFeet: 3_800 + (8 - index) * 350, onGround: false };
  });
  const aa465 = {
    hex: 'f0c046', callsign: 'AAL465', registration: 'ZZ-AA465', typeIcaoCode: 'A321', category: 'A3',
    latitude: HIGUEY_NW[1], longitude: HIGUEY_NW[0], altitudeFeet: 3_800, onGround: false, groundSpeedKnots: 261,
    trackDegrees: 120, verticalRateFeetPerMinute: -900, squawk: '2531', positionAt: iso(at),
    matchedFlightKey: OFFPLAN_KEY, matchedBy: 'Callsign', trail,
  };
  const crowd = CROWD.map(([hex, callsign, type, code]) => {
    const stand = standOf(code) ?? standOf('A2');
    return { hex, callsign, registration: null, typeIcaoCode: type, category: 'A3', latitude: stand.center[1],
      longitude: stand.center[0], altitudeFeet: null, onGround: true, groundSpeedKnots: 0, trackDegrees: stand.headingTrue,
      verticalRateFeetPerMinute: null, squawk: null, positionAt: iso(at), matchedFlightKey: null, matchedBy: null, trail: [] };
  });
  const base = createMapFlights();
  const template = base.flights[0];
  const row = {
    ...template, flightKey: OFFPLAN_KEY, visitKey: OFFPLAN_KEY, proposalId: id(465), legId: id(4650),
    turnaroundId: id(4651), direction: 'Arrival', flightNumber: 'AA465', callsign: 'AAL465', airline: AMERICAN,
    counterpart: MIA, scheduledAt: iso(NOON_MS + 14 * 60_000), estimatedAt: iso(NOON_MS + 12 * 60_000), phase: 'approaching',
    providerStatus: 'Approaching', aircraft: { registration: 'ZZ-AA465', typeIcaoCode: 'A321', model: 'A321-200',
      sizeCategory: 'Narrowbody' },
    imported: true, turnaround: { id: id(4651), operationCode: 'AA465-1113', status: 'Confirmed', operationId: id(4652),
      operationStatus: 'Assigned' },
    stand: { id: id(601), code: 'B21', terminalCode: 'B' }, milestones: [],
  };
  return {
    at: TRAFFIC_NOON,
    picture: { ...live, aircraft: [aa465, ...crowd] },
    flights: { ...base, flights: [row] },
    tracks: {},
  };
}
