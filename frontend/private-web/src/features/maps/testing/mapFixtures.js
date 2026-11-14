import { normalizeStandCode } from '../../../services/standCodes';
import { DASHBOARD_POSITIONS } from '../../dashboard/dashboardPositions';
import { destinationPoint, haversineM, roundCoord, toLocal } from '../airport/geo';
import { standBox } from '../airport/standGeometry';

// Synthetic data for the map tests, over the internal reference catalogue of Punta Cana (41 stand points, B33 out).
// The states are invented: three stands of terminal A were placed by OCC, every other stand sits at its reference
// location (so the legend shows the «No oficial» tag for them).
const STAND_STATES = Object.freeze({
  A1: ['occupied', 'occ'],
  A2: ['available', 'occ'],
  A3: ['planned', 'occ'],
  B21: ['disabled', 'reference'],
  BN6: ['unverified', 'reference'],
});

/** The stands of a positions screen: `{ id, terminal, latitude, longitude, status, locationSource }`. */
export function createMapStands(overrides = {}) {
  return DASHBOARD_POSITIONS.map(position => {
    const [status, locationSource] = STAND_STATES[position.id] ?? ['available', 'reference'];
    return {
      id: position.id,
      terminal: position.terminal,
      latitude: position.lat,
      longitude: position.lon,
      status,
      locationSource,
      ...overrides[position.id],
    };
  });
}

/** The reference point of a stand as `[lng, lat]`. */
export function standPoint(code) {
  const position = DASHBOARD_POSITIONS.find(item => item.id === code);
  if (!position) throw new RangeError(`No reference point for stand ${code}`);
  return [position.lon, position.lat];
}

// A small invented airport for the layout review (lab/layoutQa.js), in metres east and north of an origin far from any
// real one: a taxiway «A» from the exit of runway 09/27 down to an apron lane along y = 100, four stands on that lane,
// a retired one, and a taxiway «X» that only the runway joins to the rest (n8, n9, n10), so it is cut off from the taxi
// network.
const QA_ORIGIN = Object.freeze([-60, 10]);
const qaPlane = toLocal(QA_ORIGIN);

/** A point of the invented airport, `x` metres east and `y` metres north of its origin, as `[lng, lat]`. */
export const qaPoint = (x, y) => roundCoord(qaPlane.inverse([x, y]));

const QA_LANE = Object.freeze([['n4', -200], ['ah-a', -100], ['n1', 0]]);

/** The airport layout of the review tests: only what lab/layoutQa.js reads, in the shape of mdpc.layout.json. */
export function createQaLayout() {
  const nodes = [
    ['n1', 'junction', 0, 100], ['n2', 'exit', 0, 300], ['n3', 'runway', 500, 300], ['n8', 'exit', 1000, 300],
    ['n9', 'junction', 1000, 100], ['n10', 'junction', 1100, 100], ['n4', 'junction', -200, 100],
    ['hp-A-09-27', 'hold', 0, 210], ['ah-a', 'apronHold', -100, 100],
  ].map(([id, kind, x, y]) => ({ id, p: qaPoint(x, y), kind }));
  const at = id => nodes.find(node => node.id === id).p;
  const edge = (a, b, kind, ref = null) => ({ a, b, m: Math.round(haversineM(at(a), at(b)) * 10) / 10, kind, ref });
  // The lane node nearest to a lead-in that starts at `x` on the lane.
  const laneNode = x => QA_LANE.reduce((best, entry) => (Math.abs(entry[1] - x) < Math.abs(best[1] - x) ? entry : best))[0];

  const stand = (code, x, y, headingTrue, { flags = [], centroidM = null, gate = null, node = true, retired = false }) => {
    const center = qaPoint(x, y);
    return {
      code,
      terminal: code.startsWith('B') ? 'B' : 'A',
      kind: code.startsWith('AN') ? 'remote' : 'contact',
      bridge: false,
      aliases: [],
      center,
      headingTrue,
      sizeLetter: 'D',
      widthM: 60,
      polygon: standBox(center, headingTrue, 'D'),
      leadIn: node ? [qaPoint(x, 100), center] : null,
      node: node ? `st-${code}` : null,
      retired,
      overlaps: [],
      provenance: { center: 'elevant', polygon: centroidM === null ? 'derived' : 'osm:way/1', heading: 'osm', qa: 'auto' },
      qa: {
        flags,
        osmWay: centroidM === null ? null : 1,
        osmCentroid: centroidM === null ? null : qaPoint(x, y - centroidM),
        centroidDistanceM: centroidM,
        gate: gate === null ? null : { ref: gate.ref, p: qaPoint(x, 0), distanceM: gate.distanceM },
        overlapMaxPct: 0,
      },
    };
  };
  const stands = [
    stand('A10', -260, 40, 180, { flags: ['narrowed'], centroidM: 32 }),
    stand('A2', -160, 40, 180, { centroidM: 12, gate: { ref: '2', distanceM: 40 } }),
    stand('B31', 60, 40, 180, { flags: ['unmatched', 'narrowed'], gate: { ref: 'B31', distanceM: 40 } }),
    stand('AN1', -330, 160, 0, { flags: ['far'], centroidM: 55 }),
    stand('B33', 130, 40, 180, { flags: ['headingAssumed'], node: false, retired: true }),
  ];
  const drawn = stands.filter(item => item.node !== null);
  for (const item of drawn) {
    nodes.push({ id: item.node, p: item.center, kind: 'stand' });
    nodes.push({ id: `ls-${item.code}`, p: item.leadIn[0], kind: 'junction' });
  }
  const edges = [
    edge('n2', 'hp-A-09-27', 'taxiway', 'A'), edge('hp-A-09-27', 'n1', 'taxiway', 'A'),
    edge('n1', 'ah-a', 'taxilane'), edge('ah-a', 'n4', 'taxilane'),
    edge('n2', 'n3', 'runway', '09/27'), edge('n3', 'n8', 'runway', '09/27'),
    edge('n8', 'n9', 'taxiway', 'X'), edge('n9', 'n10', 'taxiway', 'X'),
    // Each lead-in starts on the apron lane, joined to the lane node nearest to it.
    ...drawn.flatMap(item => [
      edge(laneNode(qaPlane.forward(item.leadIn[0])[0]), `ls-${item.code}`, 'taxilane'),
      edge(`ls-${item.code}`, item.node, 'leadin', item.code),
    ]),
  ];
  const hold = at('hp-A-09-27');
  return {
    schema: 1,
    meta: { icao: 'ZZZZ', iata: 'ZZZ', bbox: [...qaPoint(-400, -100), ...qaPoint(1200, 400)] },
    taxiGraph: { nodes, edges },
    holdingPoints: [{ id: 'hp-A-09-27', runway: '09/27', taxiwayRef: 'A', p: hold, node: 'hp-A-09-27', source: 'derived' }],
    apronHolds: [{ id: 'ah-a', p: at('ah-a'), node: 'ah-a', terminals: ['A'] }],
    stands,
    qa: {
      gates: [{ ref: '2', p: qaPoint(-160, 0) }, { ref: 'B31', p: qaPoint(60, 0) }],
      // The OSM stand lines, from a gate to the apron lane, and one without a gate.
      standLines: [
        { way: 1, gate: '2', line: [qaPoint(-160, 0), qaPoint(-160, 100)] },
        { way: 2, gate: null, line: [qaPoint(-260, 0), qaPoint(-260, 100)] },
      ],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The positions board of the ramp (PR M4), synthetic: invented flights, registrations and agents, every time relative
// to the `nowMs` a test chooses, and no coordinate written by hand (a stand OCC placed sits relative to a reference
// point of the internal catalogue).

const MINUTE_MS = 60 * 1000;
const isoAt = ms => new Date(ms).toISOString();

/** The terminal a stand code belongs to at Punta Cana: BN… is the FBO, A… and AN… terminal A, B… terminal B. */
function terminalOfCode(code) {
  const letters = /^[A-Z]+/u.exec(normalizeStandCode(code))?.[0] ?? '';
  if (letters === 'BN') return 'FBO';
  if (letters.startsWith('A')) return 'A';
  return letters.startsWith('B') ? 'B' : null;
}

/**
 * A stand of the positions board, in the shape the API sends (`OccPositionResponse`): free, not placed by OCC, covered
 * by nobody, with the board's status derived from its visits as the API derives it (an arrival time makes it
 * `occupied`, a visit `planned`). `code` is written as the database writes it («A05»); `overrides` replace any field.
 */
export function boardStand(code, overrides = {}) {
  const turnarounds = overrides.turnarounds ?? [];
  const status = turnarounds.some(visit => visit.arrivedAt != null) ? 'occupied' : turnarounds.length > 0 ? 'planned' : 'available';
  return {
    standId: `stand-${normalizeStandCode(code)}`,
    code,
    terminalCode: terminalOfCode(code),
    standType: 'Contact',
    status,
    turnarounds,
    latitude: null,
    longitude: null,
    hasBoardingBridge: false,
    isRemote: false,
    maxAircraftSize: null,
    cancelledBy: null,
    narrowbodyOnly: false,
    coveredBy: [],
    ...overrides,
  };
}

/**
 * A visit of the positions board (`OccPositionTurnaroundResponse`): flight `flight` due on the stand `arrivalInMin`
 * minutes from `nowMs` (negative: in the past), leaving `departureInMin` minutes from it as the next flight number.
 * `arrived` records its arrival (at its time, or now when that is still ahead). `overrides` replace any field.
 */
export function boardVisit({ nowMs, flight = 'DM161', arrivalInMin = 60, departureInMin = arrivalInMin + 60,
  arrived = false, ...overrides } = {}) {
  if (!Number.isFinite(nowMs)) throw new TypeError('boardVisit needs nowMs');
  const [, prefix = 'DM', digits = '0'] = /^([A-Z]+)(\d+)$/u.exec(flight) ?? [];
  const arrivalAt = nowMs + arrivalInMin * MINUTE_MS;
  return {
    turnaroundId: `turn-${flight}`,
    operationCode: `PUJ-${flight}`,
    airlineName: 'Aerolínea de prueba',
    aircraftRegistration: `HI${digits.padStart(4, '0')}`,
    arrivalFlightNumber: flight,
    departureFlightNumber: `${prefix}${Number(digits) + 1}`,
    arrivalScheduledAt: isoAt(arrivalAt),
    arrivedAt: arrived ? isoAt(Math.min(arrivalAt, nowMs)) : null,
    departureScheduledAt: isoAt(nowMs + departureInMin * MINUTE_MS),
    assignedFrom: isoAt(nowMs - 120 * MINUTE_MS),
    status: arrived ? 'InProgress' : 'Confirmed',
    ...overrides,
  };
}

/** The agents of the scenario: invented names. */
export const SCENARIO_AGENTS = Object.freeze({ marta: 'Marta Castillo', luis: 'Luis Peña', ana: 'Ana Ruiz' });

/**
 * A ramp at `nowMs` with every stand state, as the positions board and the map flights (contracts 1.3) give it:
 * - A1 free; A2 planned (due in 90 min); A3 arriving (due in 10 min) and covered by nobody;
 * - A4 occupied while another flight arrives in 5 min (a conflict); A5 releasing (leaves in 10 min);
 * - A6 the demo flight ZZ9001: it landed 2 min ago, so the board already says `occupied`, and the server parks it in
 *   3 min (`demo.onBlockAt`): with the map flights it is still arriving;
 * - A9 occupied, and it cancels A10, free and so disabled (a combined pair); B21 past its departure time;
 * - B22 free and limited to narrow-body aircraft; BN6 free, covered by nobody, with no flight due;
 * - C7 a stand the layout does not know, placed by OCC 120 m west of BN13; Z1 unknown and not placed;
 * - every other stand of the catalogue has no database row (`unverified`).
 * Returns `{ nowMs, board, flightsByTurnaround }`.
 */
export function createRampScenario(nowMs) {
  const visit = (flight, options) => boardVisit({ nowMs, flight, ...options });
  const at = minutes => isoAt(nowMs + minutes * MINUTE_MS);
  const { marta, luis, ana } = SCENARIO_AGENTS;
  const [placedLongitude, placedLatitude] = destinationPoint(standPoint('BN13'), 270, 120);
  const positions = [
    boardStand('A01', { coveredBy: [marta] }),
    boardStand('A02', { coveredBy: [marta], turnarounds: [visit('DM201', { arrivalInMin: 90 })] }),
    boardStand('A03', { turnarounds: [visit('DM203', { arrivalInMin: 10 })] }),
    boardStand('A04', { coveredBy: [luis], turnarounds: [
      visit('DM205', { arrivalInMin: -30, departureInMin: 60, arrived: true }),
      visit('DM207', { arrivalInMin: 5, departureInMin: 120 }),
    ] }),
    boardStand('A05', { coveredBy: [luis], turnarounds: [visit('DM209', { arrivalInMin: -45, departureInMin: 10, arrived: true })] }),
    boardStand('A06', { coveredBy: [marta], turnarounds: [visit('ZZ9001', {
      arrivalInMin: 3, departureInMin: 63, arrivedAt: at(-2), status: 'Confirmed', isDemo: true,
    })] }),
    boardStand('A09', { coveredBy: [ana], turnarounds: [visit('DM211', { arrivalInMin: -20, departureInMin: 120, arrived: true })] }),
    boardStand('A10', { coveredBy: [ana], cancelledBy: 'A09' }),
    boardStand('B21', { coveredBy: [ana], turnarounds: [visit('DM213', { arrivalInMin: -90, departureInMin: -5, arrived: true })] }),
    boardStand('B22', { coveredBy: [luis], narrowbodyOnly: true }),
    boardStand('BN06', { standType: 'Remote', isRemote: true, maxAircraftSize: 'Narrowbody', narrowbodyOnly: true }),
    boardStand('C07', { terminalCode: 'FBO', coveredBy: [ana], latitude: placedLatitude, longitude: placedLongitude }),
    boardStand('Z01', { terminalCode: null }),
  ];
  const demo = {
    demoFlightId: 'demo-1', state: 'Active', phase: 'TaxiIn', appearAt: at(-8), touchdownAt: at(-2), onBlockAt: at(3),
    scheduledOffBlockAt: at(63), offBlockAt: null, takeoffAt: null, vanishAt: null,
  };
  const demoLeg = (direction, flightNumber, extra) => ({
    flightKey: `p:demo-${direction === 'Arrival' ? 'arr' : 'dep'}`, visitKey: 'p:demo-arr', turnaroundId: 'turn-ZZ9001',
    direction, flightNumber, estimatedAt: null, actualAt: null, actualKind: null, isDemo: true, demo, milestones: [],
    aircraft: { registration: 'HI9001', typeIcaoCode: 'B38M', model: 'Boeing 737 MAX 8', sizeCategory: 'Narrowbody' },
    ...extra,
  });
  return {
    nowMs,
    board: {
      stationId: '20000000-0000-7000-8000-000000000003',
      stationCode: 'PUJ',
      operationDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(nowMs),
      asOf: isoAt(nowMs),
      positions,
      unassigned: [],
      canAssign: true,
    },
    flightsByTurnaround: {
      'turn-ZZ9001': [
        demoLeg('Arrival', 'ZZ9001', { phase: 'landed', scheduledAt: at(3), actualAt: at(-2), actualKind: 'Runway' }),
        demoLeg('Departure', 'ZZ9002', { phase: 'scheduled', scheduledAt: at(63) }),
      ],
    },
  };
}
