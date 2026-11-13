import { DASHBOARD_POSITIONS } from '../../dashboard/dashboardPositions';
import { haversineM, roundCoord, toLocal } from '../airport/geo';
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
