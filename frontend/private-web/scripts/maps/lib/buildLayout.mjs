import {
  convexIntersectionAreaM2,
  destinationPoint,
  haversineM,
  initialBearing,
  lineEntersPolygon,
  minimumBoundingRectangle,
  pointInPolygon,
  pointToPolylineM,
  polygonAreaM2,
  polygonCentroid,
  roundCoord,
  toLocal,
} from '../../../src/features/maps/airport/geo.js';
import {
  buildTaxiGraph, connectedComponents, edgeLine, nearestEdge,
} from '../../../src/features/maps/airport/taxiGraph.js';
import {
  STAND_BOX, headingFromAxis, leadIn, lineUpDistanceM, standBox,
} from '../../../src/features/maps/airport/standGeometry.js';
import { normalizeStandCode } from '../../../src/services/standCodes.js';

// The generator of the Punta Cana airport layout (PR M3, design C2 as adjusted by the contracts page): a pure and
// deterministic function from the committed inputs (the OpenStreetMap extract, the OurAirports rows, the 42 internal
// stand points of positionsData.js and the manual QA table) to src/features/maps/airport/data/mdpc.layout.json,
// region.context.json and the per-stand QA report. Nothing here reads the clock or the network: every date comes from
// the inputs. Coordinates are [lng, lat]; the output rounds them to 6 decimals.

export const LAYOUT_SCHEMA = 1;
export const ARP = Object.freeze([-68.3634, 18.5674]);
export const MATCH_RADIUS_M = 40;
export const AMBIGUOUS_MARGIN_M = 10;
export const FAR_M = 50;
export const OVERLAP_PCT = 15;
export const NEIGHBOUR_RADIUS_M = 150;
export const LEAD_IN_RANGE_M = 150;
export const HOLD_OFFSET_M = 90;
export const THRESHOLD_TOLERANCE_M = 30;
export const COMPONENT_RANGE_M = 300;
const SNAP_TO_NODE_M = 1;
const ROW_AXIS_NEIGHBOURS = 2;
const PARALLEL_DEG = 20;
// The nearest taxi edge tells which way a stand faces only when it lies this far or more off the stand's row line:
// one beside the row, as taxiway E north of the column B34–B37, says nothing about it.
const ROW_SIDE_DEG = 30;
// Two back rays that meet the taxi network within a metre of each other do not tell a stand's direction either.
const RAY_TIE_M = 1;
const GATE_RANGE_M = 80;
const HOLD_DEDUP_M = 15;
const HOLD_REACH_M = 400;
const TAXI_KINDS = Object.freeze(['taxiway', 'taxilane']);

/**
 * The QA flags of a stand, in the order the layout lists them: `unmatched` (no OSM stand way within 40 m), `ambiguous`
 * (another OSM candidate as good, or the one OSM ties to the stand's own gate), `far` (the OSM centroid or the gate of
 * the same code beyond 50 m), `overlap` (more than 15 % of another box), `crossesTaxiway` (a taxiway or taxilane runs
 * through the box), `leadInCrosses` (the lead-in runs through another box), `leadInNotBehind` (the lead-in leaves the
 * taxi network 90° or less from the nose: the aircraft would come in from the side or the front), `narrowed` (the box
 * is narrower than its code letter) and `headingAssumed` (the heading follows its row), which only explain how the box
 * was drawn, and last `offNetwork` (beyond 300 m of the taxi network) and `noLeadIn` (no taxi edge to draw a lead-in
 * from).
 */
export const QA_FLAGS = Object.freeze([
  'unmatched', 'ambiguous', 'far', 'overlap', 'crossesTaxiway', 'leadInCrosses', 'leadInNotBehind', 'narrowed',
  'headingAssumed', 'offNetwork', 'noLeadIn',
]);

const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, at) => `${prefix}${from + at}`);

/**
 * The stand rows of Punta Cana, copied from contracts 1.2 (PuntaCanaStationLayout): code, terminal, kind and bridge.
 * A row is a line of stands that share an axis; stands without OSM geometry follow it.
 */
export const STAND_ROWS = Object.freeze([
  { id: 'A', terminal: 'A', kind: 'contact', bridge: false, codes: range('A', 1, 11) },
  { id: 'AN', terminal: 'A', kind: 'remote', bridge: false, codes: range('AN', 1, 5) },
  { id: 'B20-B26', terminal: 'B', kind: 'contact', bridge: true, codes: range('B', 20, 26) },
  { id: 'B27-B31', terminal: 'B', kind: 'contact', bridge: false, codes: range('B', 27, 31) },
  { id: 'B32-B37', terminal: 'B', kind: 'remote', bridge: false, codes: range('B', 32, 37) },
  { id: 'BN', terminal: 'FBO', kind: 'fbo', bridge: false, codes: range('BN', 6, 13) },
].map(row => Object.freeze({ ...row, codes: Object.freeze(row.codes) })));

const ROW_BY_CODE = new Map(STAND_ROWS.flatMap(row => row.codes.map(code => [code, row])));

const round1 = value => Math.round(value * 10) / 10;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lineLength = line => line.slice(1).reduce((sum, point, at) => sum + haversineM(line[at], point), 0);
const normalizeBearing = degrees => ((degrees % 360) + 360) % 360;
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
/** Whether `point` lies behind a stand at `center` whose nose points to `heading`: more than 90° from the nose. */
const isBehind = (center, heading, point) => angleBetween(heading, initialBearing(center, point)) > 90;

// ---------------------------------------------------------------------------------------------------------------
// OSM input

function readOsm(osm) {
  const ways = [];
  const nodes = [];
  for (const element of osm?.elements ?? []) {
    if (element.type === 'way') {
      const line = element.geometry.map(({ lat, lon }) => [lon, lat]);
      const closed = element.nodes.length > 3 && element.nodes[0] === element.nodes[element.nodes.length - 1];
      ways.push({ id: element.id, tags: element.tags ?? {}, nodeIds: element.nodes, line, closed });
    } else if (element.type === 'node') {
      nodes.push({ id: element.id, tags: element.tags ?? {}, p: [element.lon, element.lat] });
    }
  }
  ways.sort((a, b) => a.id - b.id);
  nodes.sort((a, b) => a.id - b.id);
  return { ways, nodes };
}

const waysOf = (osm, aeroway) => osm.ways.filter(way => way.tags.aeroway === aeroway);

// ---------------------------------------------------------------------------------------------------------------
// 1. Runways

function buildRunways(osm, ourAirports, report) {
  const runways = [];
  for (const row of ourAirports.runways ?? []) {
    const id = `${row.leIdent}/${row.heIdent}`;
    const rawLe = [row.le.lon, row.le.lat];
    const rawHe = [row.he.lon, row.he.lat];
    const leHeading = initialBearing(rawLe, rawHe);
    const heHeading = initialBearing(rawHe, rawLe);
    const leThreshold = row.le.displacedThresholdM > 0
      ? destinationPoint(rawLe, leHeading, row.le.displacedThresholdM) : rawLe;
    const heThreshold = row.he.displacedThresholdM > 0
      ? destinationPoint(rawHe, heHeading, row.he.displacedThresholdM) : rawHe;
    const osmWay = waysOf(osm, 'runway').find(way => way.tags.ref === id);
    let centerline = [rawLe, rawHe];
    const qa = { osmWay: osmWay?.id ?? null, osmEndDistanceM: null, flags: [] };
    if (osmWay) {
      centerline = haversineM(osmWay.line[0], rawLe) <= haversineM(osmWay.line[osmWay.line.length - 1], rawLe)
        ? osmWay.line : [...osmWay.line].reverse();
      qa.osmEndDistanceM = [
        round1(haversineM(centerline[0], leThreshold)),
        round1(haversineM(centerline[centerline.length - 1], heThreshold)),
      ];
      if (qa.osmEndDistanceM.some(distance => distance > THRESHOLD_TOLERANCE_M)) qa.flags.push('threshold');
    } else {
      qa.flags.push('noOsmCenterline');
    }
    const osmWidth = Number(osmWay?.tags.width);
    const widthM = row.widthM ?? (Number.isFinite(osmWidth) ? osmWidth : 45);
    const lengthM = row.lengthM ?? round1(haversineM(rawLe, rawHe));
    // The pavement: the straight runway between its OSM ends (or its ends), buffered by half the width.
    const start = centerline[0];
    const end = centerline[centerline.length - 1];
    const axis = initialBearing(start, end);
    const half = widthM / 2;
    const corners = [
      destinationPoint(start, axis - 90, half), destinationPoint(end, axis - 90, half),
      destinationPoint(end, axis + 90, half), destinationPoint(start, axis + 90, half),
    ];
    runways.push({
      id,
      lengthM,
      widthM,
      surface: row.surface ?? osmWay?.tags.surface ?? null,
      centerline,
      polygon: [...corners, corners[0]],
      ends: [
        { ident: row.leIdent, threshold: leThreshold, headingTrue: round1(leHeading), elevationFt: row.le.elevationFt },
        { ident: row.heIdent, threshold: heThreshold, headingTrue: round1(heHeading), elevationFt: row.he.elevationFt },
      ],
      qa,
    });
    report.runways.push({ id, osmWay: qa.osmWay, osmEndDistanceM: qa.osmEndDistanceM, flags: qa.flags });
  }
  return runways;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Taxi graph

function edgeFrom(a, b, line, kind, ref, way) {
  const edge = { a, b, m: round1(lineLength(line)), kind, ref: ref ?? null, way };
  if (line.length > 2) edge.line = line;
  return edge;
}

function buildGraphState(osm, report) {
  const taxiWays = osm.ways.filter(way => ['runway', 'taxiway', 'taxilane'].includes(way.tags.aeroway));
  const usage = new Map();
  const onRunway = new Set();
  const onTaxi = new Set();
  for (const way of taxiWays) {
    for (const id of new Set(way.nodeIds)) usage.set(id, (usage.get(id) ?? 0) + 1);
    for (const id of way.nodeIds) (way.tags.aeroway === 'runway' ? onRunway : onTaxi).add(id);
  }
  const nodes = new Map();
  const edges = [];
  const addNode = (osmId, p) => {
    const id = `n${osmId}`;
    if (!nodes.has(id)) {
      const kind = onRunway.has(osmId) ? (onTaxi.has(osmId) ? 'exit' : 'runway') : 'junction';
      nodes.set(id, { id, p, kind });
    }
    return id;
  };
  for (const way of taxiWays) {
    const kind = way.tags.aeroway === 'runway' ? 'runway' : way.tags.aeroway;
    const counts = new Map();
    way.nodeIds.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
    let startAt = 0;
    for (let at = 1; at < way.nodeIds.length; at += 1) {
      const osmId = way.nodeIds[at];
      const split = at === way.nodeIds.length - 1 || usage.get(osmId) > 1 || counts.get(osmId) > 1;
      if (!split) continue;
      const a = addNode(way.nodeIds[startAt], way.line[startAt]);
      const b = addNode(osmId, way.line[at]);
      if (a !== b) edges.push(edgeFrom(a, b, way.line.slice(startAt, at + 1), kind, way.tags.ref, way.id));
      startAt = at;
    }
  }
  // Keep the connected network that holds the runways; report what is cut off.
  const graph = buildTaxiGraph({ nodes: [...nodes.values()], edges });
  const components = connectedComponents(graph);
  const main = components.find(component => component.some(id => nodes.get(id).kind !== 'junction')) ?? components[0] ?? [];
  const kept = new Set(main);
  for (const component of components) {
    if (component === main) continue;
    const ways = [...new Set(edges.filter(edge => kept.has(edge.a) === false && component.includes(edge.a))
      .map(edge => edge.way))].sort((a, b) => a - b);
    report.dropped.push({ type: 'taxi-component', ids: ways, nodes: component.length });
  }
  return {
    nodes: new Map([...nodes].filter(([id]) => kept.has(id))),
    edges: edges.filter(edge => kept.has(edge.a) && kept.has(edge.b)),
  };
}

const currentGraph = state => buildTaxiGraph({ nodes: [...state.nodes.values()], edges: state.edges });

/**
 * Puts a node at `point` on the nearest edge of the given kinds: reuses an end node within 1 m, otherwise splits the
 * edge there under the id `nodeId`. Returns `{ nodeId, point, distanceM }` or `null` when no edge qualifies.
 */
function insertNode(state, point, nodeId, kind, { kinds = TAXI_KINDS } = {}) {
  const graph = currentGraph(state);
  const hit = nearestEdge(graph, point, { kinds });
  if (!hit) return null;
  const { edge } = hit;
  const line = Array.isArray(edge.line) ? edge.line : [state.nodes.get(edge.a).p, state.nodes.get(edge.b).p];
  const toA = haversineM(hit.point, state.nodes.get(edge.a).p);
  const toB = haversineM(hit.point, state.nodes.get(edge.b).p);
  if (Math.min(toA, toB) <= SNAP_TO_NODE_M) {
    const existing = toA <= toB ? edge.a : edge.b;
    return { nodeId: existing, point: state.nodes.get(existing).p, distanceM: hit.distanceM, reused: true };
  }
  if (state.nodes.has(nodeId)) throw new Error(`Duplicate graph node id ${nodeId}`);
  state.nodes.set(nodeId, { id: nodeId, p: hit.point, kind });
  const first = [...line.slice(0, hit.index + 1), hit.point];
  const second = [hit.point, ...line.slice(hit.index + 1)];
  const index = state.edges.indexOf(edge);
  state.edges.splice(index, 1,
    edgeFrom(edge.a, nodeId, first, edge.kind, edge.ref, edge.way),
    edgeFrom(nodeId, edge.b, second, edge.kind, edge.ref, edge.way));
  return { nodeId, point: hit.point, distanceM: hit.distanceM, reused: false };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Stands

/** Distance from a point to an OSM stand way: 0 inside a closed polygon, else to its outline or line. */
function distanceToWay(point, way) {
  if (way.closed && pointInPolygon(point, way.line)) return 0;
  return pointToPolylineM(point, way.line).distanceM;
}

/** The OSM stand ways that begin or end at one of `gates` (OSM gate nodes with their id). */
function waysAtGates(parkingWays, gates) {
  const ids = new Set(gates.map(gate => gate.id));
  return parkingWays.filter(way => ids.has(way.nodeIds[0]) || ids.has(way.nodeIds[way.nodeIds.length - 1]));
}

/**
 * Each stand's OSM way: a way matches one stand only; the nearest pairs are taken first. A match is ambiguous when
 * another way is almost as near to the stand, when another stand is almost as near to its way, or when OSM ties another
 * candidate way to the stand: the way that begins or ends at the OSM gate with the stand's own code (B20–B31 at MDPC;
 * «1» or «N1» are never another stand's code). Nothing then decides between them from OSM alone.
 */
function matchStandWays(stands, parkingWays, overrides, gates = []) {
  const forced = new Map();
  for (const stand of stands) {
    const override = overrides[stand.code];
    if (override && Object.hasOwn(override, 'osmWay')) forced.set(stand.code, override.osmWay);
  }
  const candidates = new Map(stands.map(stand => [stand.code, parkingWays
    .map(way => ({ way, distanceM: distanceToWay(stand.center, way) }))
    .filter(candidate => candidate.distanceM <= MATCH_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM || a.way.id - b.way.id)]));
  const pairs = [];
  for (const stand of stands) {
    if (forced.has(stand.code) || stand.retired) continue;
    for (const candidate of candidates.get(stand.code)) pairs.push({ stand, ...candidate });
  }
  pairs.sort((a, b) => a.distanceM - b.distanceM || compare(a.stand.code, b.stand.code) || a.way.id - b.way.id);
  const takenWays = new Set([...forced.values()].filter(id => id != null));
  const matches = new Map();
  for (const [code, wayId] of forced) {
    const way = parkingWays.find(candidate => candidate.id === wayId) ?? null;
    const stand = stands.find(candidate => candidate.code === code);
    matches.set(code, way ? { way, distanceM: distanceToWay(stand.center, way), forced: true } : null);
  }
  for (const pair of pairs) {
    if (matches.has(pair.stand.code) || takenWays.has(pair.way.id)) continue;
    matches.set(pair.stand.code, { way: pair.way, distanceM: pair.distanceM, forced: false });
    takenWays.add(pair.way.id);
  }
  // Ambiguous: another way almost as near to the stand, another stand almost as near to its way, or another candidate
  // that OSM ties to the stand's own gate.
  const ambiguous = new Set();
  for (const [code, match] of matches) {
    if (!match || match.forced) continue;
    const own = candidates.get(code);
    if (own.some(candidate => candidate.way.id !== match.way.id
      && candidate.distanceM - match.distanceM < AMBIGUOUS_MARGIN_M)) ambiguous.add(code);
    for (const other of stands) {
      if (other.code === code || other.retired) continue;
      const rival = candidates.get(other.code).find(candidate => candidate.way.id === match.way.id);
      if (rival && rival.distanceM - match.distanceM < AMBIGUOUS_MARGIN_M) ambiguous.add(code);
    }
    const gateWays = waysAtGates(parkingWays, gates.filter(gate => normalizeStandCode(gate.ref) === code));
    if (own.some(candidate => candidate.way.id !== match.way.id && gateWays.includes(candidate.way))
      && !gateWays.includes(match.way)) ambiguous.add(code);
  }
  return { matches, ambiguous };
}

function nearestPointOnPolygons(point, polygons) {
  let best = null;
  for (const polygon of polygons) {
    const hit = pointInPolygon(point, polygon.ring)
      ? { distanceM: 0, point: polygonCentroid(polygon.ring) }
      : pointToPolylineM(point, polygon.ring);
    if (best === null || hit.distanceM < best.distanceM) best = { ...hit, polygon };
  }
  return best;
}

/**
 * The direction rule of a contact stand: the nose faces the OSM gate with the stand's own code (B20–B31: where the nose
 * stops), else the terminal nearest to the stand. `null` when there is neither.
 */
function towardsTerminal(axisDeg, center, context, code) {
  const gate = code === null ? null : context.gates.find(candidate => normalizeStandCode(candidate.ref) === code
    && haversineM(candidate.p, center) <= GATE_RANGE_M);
  if (gate) return headingFromAxis(axisDeg, center, gate.p, { towards: true });
  const terminal = nearestPointOnPolygons(center, context.terminals);
  return terminal ? headingFromAxis(axisDeg, center, terminal.point, { towards: true }) : null;
}

/**
 * The direction rule of a stand that turns its tail to the taxi network (remote and FBO stands, or a contact stand with
 * neither gate nor terminal), so that its lead-in comes from behind. Of the two directions of the axis: the one whose
 * back ray meets a taxi edge within 150 m, the nearer meeting when both do; when neither does, the one facing away
 * from the taxi edge nearest to the stand, looked up from the stand itself, if that edge lies 30° or more off the
 * stand's row line. `null` when nothing near the stand decides.
 */
function awayFromTaxi(axisDeg, center, context) {
  const options = [normalizeBearing(axisDeg), normalizeBearing(axisDeg + 180)];
  const [first, second] = options.map(heading => rayHit(context.graph, center, heading));
  if (first || second) {
    if (!second || (first && first.t < second.t - RAY_TIE_M)) return options[0];
    if (!first || second.t < first.t - RAY_TIE_M) return options[1];
    return null;
  }
  const taxi = nearestEdge(context.graph, center, { kinds: TAXI_KINDS });
  if (!taxi || Math.abs(angleBetween(options[0], initialBearing(center, taxi.point)) - 90) < ROW_SIDE_DEG) return null;
  return headingFromAxis(axisDeg, center, taxi.point, { towards: false });
}

/** The last resort: away from the taxi edge nearest to the stand however little that decides, or the axis itself. */
function awayFromNearestTaxi(axisDeg, center, context) {
  const taxi = nearestEdge(context.graph, center, { kinds: TAXI_KINDS });
  return taxi ? headingFromAxis(axisDeg, center, taxi.point, { towards: false }) : normalizeBearing(axisDeg);
}

/** The heading a stand takes on `axisDeg` (either direction of it), or `null` when nothing near the stand decides. */
function orient(axisDeg, center, kind, context, code = null) {
  return (kind === 'contact' ? towardsTerminal(axisDeg, center, context, code) : null)
    ?? awayFromTaxi(axisDeg, center, context);
}

/**
 * The axis of an OSM stand way: the long side of a closed polygon's minimum rectangle, or for an open stand line
 * (a lead-in mark, often curved towards the taxiway) the bearing of its segment nearest to the stand point.
 */
function wayAxis(way, center, rectangle) {
  if (way.closed) return rectangle.axisDeg;
  const hit = pointToPolylineM(center, way.line);
  return initialBearing(way.line[hit.index], way.line[hit.index + 1]) % 180;
}

/** The principal axis (bearing in [0, 180)) of a set of points, by PCA in a local plane. */
function principalAxis(points) {
  const origin = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
  const plane = toLocal(origin);
  const local = points.map(plane.forward);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of local) {
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // `angle` is measured from east, counter-clockwise; a bearing is from north, clockwise.
  return normalizeBearing(90 - (angle * 180) / Math.PI) % 180;
}

/** Lateral and longitudinal offsets (metres) of `other` relative to a stand at `center` with `heading`. */
function offsets(center, heading, other) {
  const plane = toLocal(center);
  const [x, y] = plane.forward(other);
  const radians = (heading * Math.PI) / 180;
  const along = x * Math.sin(radians) + y * Math.cos(radians);
  const across = x * Math.cos(radians) - y * Math.sin(radians);
  return { along, across };
}

function smallestLetterFor(lengthM, widthM) {
  for (const [letter, size] of Object.entries(STAND_BOX)) {
    if (size.depthM >= lengthM && size.widthM >= widthM) return letter;
  }
  return 'F';
}

function buildStands(osm, standPoints, overrides, context) {
  const stands = standPoints.map(point => {
    const code = normalizeStandCode(point.id);
    const row = ROW_BY_CODE.get(code) ?? null;
    const override = overrides.stands?.[code] ?? {};
    return {
      code,
      terminal: point.terminal,
      kind: override.kind ?? row?.kind ?? 'remote',
      bridge: row?.bridge ?? false,
      rowId: row?.id ?? `${point.terminal}-${code}`,
      center: [point.lon, point.lat],
      retired: override.retired ?? point.retired === true,
      override,
      flags: [],
    };
  });
  const parkingWays = waysOf(osm, 'parking_position');
  const { matches, ambiguous } = matchStandWays(stands, parkingWays, overrides.stands ?? {}, context.gates);

  // Heading: manual, OSM, a row neighbour, or the row axis.
  for (const stand of stands) {
    const match = matches.get(stand.code) ?? null;
    stand.match = match;
    if (match) {
      const rectangle = minimumBoundingRectangle(match.way.line);
      stand.osmRectangle = rectangle;
      stand.osmCentroid = match.way.closed ? polygonCentroid(match.way.line) : pointAlongMiddle(match.way.line);
    } else if (!stand.retired) {
      stand.flags.push('unmatched');
    }
    if (ambiguous.has(stand.code)) stand.flags.push('ambiguous');
    if (Number.isFinite(stand.override.headingTrue)) {
      stand.headingTrue = normalizeBearing(stand.override.headingTrue);
      stand.headingSource = 'manual';
    } else if (match) {
      const axis = wayAxis(match.way, stand.center, stand.osmRectangle);
      stand.headingTrue = orient(axis, stand.center, stand.kind, context, stand.code)
        ?? awayFromNearestTaxi(axis, stand.center, context);
      stand.headingSource = 'osm';
    }
  }
  for (const stand of stands) {
    if (stand.headingSource) continue;
    const neighbours = stands
      .filter(other => other !== stand && other.rowId === stand.rowId && other.headingSource === 'osm')
      .map(other => ({ other, distanceM: haversineM(stand.center, other.center) }))
      .filter(candidate => candidate.distanceM <= NEIGHBOUR_RADIUS_M)
      .sort((a, b) => a.distanceM - b.distanceM || compare(a.other.code, b.other.code));
    if (neighbours.length > 0) {
      stand.headingTrue = neighbours[0].other.headingTrue;
      stand.headingSource = 'neighbour';
      stand.headingFrom = neighbours[0].other.code;
    }
  }
  // The rest stand across the local line of their row: the stand and its two nearest active row neighbours (rows can
  // bend, as B32–B37). Each one takes the direction that the taxi network or the terminal near it decides (orient).
  const derived = stands.filter(stand => !stand.headingSource);
  for (const stand of derived) {
    const rowPoints = [stand.center, ...stands
      .filter(other => other !== stand && other.rowId === stand.rowId && !other.retired)
      .sort((a, b) => haversineM(stand.center, a.center) - haversineM(stand.center, b.center) || compare(a.code, b.code))
      .slice(0, ROW_AXIS_NEIGHBOURS)
      .map(other => other.center)];
    stand.axisDeg = (rowPoints.length >= 2 ? principalAxis(rowPoints) : 0) + 90;
    stand.headingTrue = orient(stand.axisDeg, stand.center, stand.kind, context);
  }
  // Where nothing near a stand decides, it faces as the nearest active stand of its row that parks parallel to it and
  // whose direction is decided (B34 and B35, with taxiway E beside them, face as B36), else away from the nearest taxi.
  const guides = stands.filter(stand => !stand.retired && stand.headingTrue != null);
  for (const stand of derived) {
    if (stand.headingTrue == null) {
      const options = [normalizeBearing(stand.axisDeg), normalizeBearing(stand.axisDeg + 180)];
      const guide = guides
        .filter(other => other.rowId === stand.rowId
          && Math.min(...options.map(option => angleBetween(option, other.headingTrue))) <= PARALLEL_DEG)
        .map(other => ({ other, distanceM: haversineM(stand.center, other.center) }))
        .sort((a, b) => a.distanceM - b.distanceM || compare(a.other.code, b.other.code))[0]?.other;
      if (guide) {
        stand.headingTrue = angleBetween(options[0], guide.headingTrue) <= angleBetween(options[1], guide.headingTrue)
          ? options[0] : options[1];
        stand.headingFrom = guide.code;
      } else {
        stand.headingTrue = awayFromNearestTaxi(stand.axisDeg, stand.center, context);
      }
    }
    stand.headingSource = 'row';
    stand.flags.push('headingAssumed');
  }

  // Size and box: override, then the smallest letter around a closed OSM polygon, then C (FBO) or D.
  const active = stands.filter(stand => !stand.retired);
  for (const stand of stands) {
    const rectangle = stand.match?.way.closed ? stand.osmRectangle : null;
    stand.sizeLetter = stand.override.sizeLetter
      ?? (rectangle ? smallestLetterFor(rectangle.lengthM, rectangle.widthM) : (stand.kind === 'fbo' ? 'C' : 'D'));
    const size = STAND_BOX[stand.sizeLetter];
    let maxWidthM = Infinity;
    if (!stand.retired) {
      for (const other of active) {
        // Side by side: a stand of the same row, or of any row parked parallel to it (B31 beside B32).
        const parallel = Math.abs(((other.headingTrue - stand.headingTrue + 540) % 180) - 90) > 90 - PARALLEL_DEG;
        if (other === stand || (other.rowId !== stand.rowId && !parallel)) continue;
        const { along, across } = offsets(stand.center, stand.headingTrue, other.center);
        if (Math.abs(along) < size.depthM) maxWidthM = Math.min(maxWidthM, Math.abs(across));
      }
    }
    stand.widthM = Math.min(size.widthM, maxWidthM);
    if (stand.widthM < size.widthM) stand.flags.push('narrowed');
    stand.polygon = Array.isArray(stand.override.polygon)
      ? stand.override.polygon
      : standBox(stand.center, stand.headingTrue, stand.sizeLetter, { maxWidthM });
  }
  return stands;
}

/** The point half way along a line. */
function pointAlongMiddle(line) {
  const half = lineLength(line) / 2;
  let walked = 0;
  for (let at = 0; at < line.length - 1; at += 1) {
    const step = haversineM(line[at], line[at + 1]);
    if (walked + step >= half) {
      return destinationPoint(line[at], initialBearing(line[at], line[at + 1]), half - walked);
    }
    walked += step;
  }
  return line[line.length - 1];
}

function overlapPct(a, b) {
  const shared = convexIntersectionAreaM2(a.polygon, b.polygon);
  const smaller = Math.min(polygonAreaM2(a.polygon), polygonAreaM2(b.polygon));
  return smaller > 0 ? (shared / smaller) * 100 : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Lead-ins

/**
 * Where the ray from the stand centre, opposite to `heading`, first crosses a taxi edge of `graph` within range:
 * `{ t (metres from the centre), point }`, or `null`.
 */
function rayHit(graph, center, heading) {
  const plane = toLocal(center);
  const back = ((heading + 180) * Math.PI) / 180;
  const direction = [Math.sin(back), Math.cos(back)];
  let best = null;
  for (const edge of graph.edges) {
    if (!TAXI_KINDS.includes(edge.kind)) continue;
    const local = edgeLine(graph, edge).map(plane.forward);
    for (let at = 0; at < local.length - 1; at += 1) {
      const [px, py] = local[at];
      const [qx, qy] = local[at + 1];
      const sx = qx - px;
      const sy = qy - py;
      const denominator = direction[0] * sy - direction[1] * sx;
      if (Math.abs(denominator) < 1e-12) continue;
      const t = (px * sy - py * sx) / denominator;
      const u = (px * direction[1] - py * direction[0]) / denominator;
      if (t < 0 || t > LEAD_IN_RANGE_M || u < 0 || u > 1) continue;
      if (best === null || t < best.t) best = { t, point: plane.inverse([direction[0] * t, direction[1] * t]) };
    }
  }
  return best;
}

/**
 * Each active stand's lead-in, joined to the taxi network at a new graph node (design C2 step 4). The aircraft rolls
 * in nose first along the stand axis, so the lead-in comes from behind: `ray`, straight from the taxi edge that the back
 * ray meets within 150 m; otherwise `lineUp`, from the taxi edge nearest to the point where the aircraft lines up behind
 * its box (lineUpDistanceM), then along the axis, so it never runs sideways through the stands beside it. When even
 * that edge lies in front of the stand, the lead-in comes `nearest`: straight from it, and flagged leadInNotBehind.
 */
function addLeadIns(state, stands, report) {
  for (const stand of stands) {
    if (stand.retired) continue;
    const graph = currentGraph(state);
    const ray = rayHit(graph, stand.center, stand.headingTrue);
    let target = ray?.point ?? null;
    let method = 'ray';
    let minAlignM = 0;
    if (!ray) {
      const lineUpM = lineUpDistanceM(stand.sizeLetter);
      const lineUp = destinationPoint(stand.center, stand.headingTrue + 180, lineUpM);
      target = nearestEdge(graph, lineUp, { kinds: TAXI_KINDS })?.point ?? null;
      const behind = target !== null && isBehind(stand.center, stand.headingTrue, target);
      method = behind ? 'lineUp' : 'nearest';
      minAlignM = behind ? lineUpM : 0;
    }
    if (!target) {
      stand.flags.push('noLeadIn');
      continue;
    }
    const snap = insertNode(state, target, `ls-${stand.code}`, 'junction');
    const nodeId = `st-${stand.code}`;
    state.nodes.set(nodeId, { id: nodeId, p: stand.center, kind: 'stand' });
    stand.leadIn = leadIn(stand.center, stand.headingTrue, snap.point, { minAlignM });
    stand.leadInMethod = method;
    stand.node = nodeId;
    state.edges.push(edgeFrom(snap.nodeId, nodeId, stand.leadIn, 'leadin', stand.code, null));
    report.leadIns.push({ code: stand.code, method: stand.leadInMethod, lengthM: round1(lineLength(stand.leadIn)) });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Holding points

/** Distances (metres, over taxi edges only) from the given nodes, up to `limitM`. */
function distancesFrom(state, sourceIds, limitM) {
  const graph = currentGraph(state);
  const distance = new Map(sourceIds.map(id => [id, 0]));
  const open = new Set(sourceIds);
  while (open.size > 0) {
    let current = null;
    for (const id of open) {
      if (current === null || distance.get(id) < distance.get(current)
        || (distance.get(id) === distance.get(current) && id < current)) current = id;
    }
    open.delete(current);
    for (const { to, edge } of graph.adjacency.get(current) ?? []) {
      if (!TAXI_KINDS.includes(edge.kind)) continue;
      const candidate = distance.get(current) + edge.m;
      if (candidate > limitM || candidate >= (distance.get(to) ?? Infinity)) continue;
      distance.set(to, candidate);
      open.add(to);
    }
  }
  return distance;
}

/**
 * Where taxi edges cross the line `offsetM` from a runway centreline (on either side, and round its ends): one
 * `{ edge, point, alongM }` per crossing.
 */
function offsetCrossings(state, runway, offsetM) {
  // Beyond a runway end the distance is to that end, so a taxiway entering at the threshold gets its hold too.
  const beside = point => pointToPolylineM(point, runway.centerline).distanceM;
  const crossings = [];
  for (const edge of state.edges) {
    if (!TAXI_KINDS.includes(edge.kind)) continue;
    const line = edge.line ?? [state.nodes.get(edge.a).p, state.nodes.get(edge.b).p];
    let walked = 0;
    for (let at = 0; at < line.length - 1; at += 1) {
      const from = line[at];
      const to = line[at + 1];
      const length = haversineM(from, to);
      const fromSide = beside(from) - offsetM;
      const toSide = beside(to) - offsetM;
      if (fromSide !== 0 && Math.sign(fromSide) !== Math.sign(toSide)) {
        const bearing = initialBearing(from, to);
        let low = 0;
        let high = 1;
        for (let step = 0; step < 40; step += 1) {
          const middle = (low + high) / 2;
          const side = beside(destinationPoint(from, bearing, middle * length)) - offsetM;
          if (Math.sign(side) === Math.sign(fromSide)) low = middle; else high = middle;
        }
        crossings.push({ edge, point: destinationPoint(from, bearing, high * length), alongM: walked + high * length });
      }
      walked += length;
    }
  }
  return crossings;
}

/**
 * Holding points: on every taxi route that leaves a runway, the point 90 m from its centreline (design C2 step 5).
 * An OSM holding position within 40 m of that point replaces it (`source: 'osm'`); the rest are `derived`.
 */
function addHoldingPoints(state, runways, osm, report) {
  const osmHolds = waysOf(osm, 'holding_position').map(way => pointAlongMiddle(way.line))
    .concat(osm.nodes.filter(node => node.tags.aeroway === 'holding_position').map(node => node.p));
  const placements = [];
  for (const runway of runways) {
    const exits = state.edges.filter(edge => edge.kind === 'runway' && edge.ref === runway.id)
      .flatMap(edge => [edge.a, edge.b])
      .filter((id, at, all) => all.indexOf(id) === at && state.nodes.get(id).kind === 'exit')
      .sort(compare);
    if (exits.length === 0) continue;
    const reach = distancesFrom(state, exits, HOLD_REACH_M);
    const crossings = offsetCrossings(state, runway, HOLD_OFFSET_M)
      .filter(({ edge, alongM }) => Math.min(
        (reach.get(edge.a) ?? Infinity) + alongM,
        (reach.get(edge.b) ?? Infinity) + edge.m - alongM,
      ) <= HOLD_REACH_M);
    const kept = [];
    for (const crossing of crossings) {
      if (kept.some(other => haversineM(other.point, crossing.point) < HOLD_DEDUP_M)) continue;
      kept.push(crossing);
    }
    for (const crossing of kept) {
      const osmHold = osmHolds
        .map(point => ({ point, distanceM: haversineM(point, crossing.point) }))
        .filter(candidate => candidate.distanceM <= 40)
        .sort((a, b) => a.distanceM - b.distanceM)[0];
      placements.push({
        runway: runway.id,
        ref: crossing.edge.ref ?? `w${crossing.edge.way}`,
        edgeRef: crossing.edge.ref,
        point: osmHold ? osmHold.point : crossing.point,
        source: osmHold ? 'osm' : 'derived',
      });
    }
  }
  placements.sort((a, b) => compare(a.runway, b.runway) || compare(a.ref, b.ref)
    || a.point[0] - b.point[0] || a.point[1] - b.point[1]);
  const used = new Map();
  const holdingPoints = [];
  for (const placement of placements) {
    const base = `hp-${placement.ref}-${placement.runway.replace('/', '-')}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    const inserted = insertNode(state, placement.point, id, 'hold');
    if (!inserted) continue;
    const node = state.nodes.get(inserted.nodeId);
    if (node.kind === 'junction') node.kind = 'hold';
    holdingPoints.push({
      id, runway: placement.runway, taxiwayRef: placement.edgeRef, p: inserted.point, node: inserted.nodeId,
      source: placement.source,
    });
    report.holds.push({
      id, runway: placement.runway, taxiwayRef: placement.ref, source: placement.source,
      offsetM: round1(pointToPolylineM(inserted.point, runways.find(r => r.id === placement.runway).centerline).distanceM),
    });
  }
  return holdingPoints;
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Apron holds

const APRON_HOLD_GROUPS = Object.freeze([
  { id: 'ah-a', terminals: ['A'] },
  { id: 'ah-b', terminals: ['B'] },
  { id: 'ah-fbo', terminals: ['FBO'] },
]);

function addApronHolds(state, stands, report) {
  const active = stands.filter(stand => !stand.retired);
  const apronHolds = [];
  for (const group of APRON_HOLD_GROUPS) {
    const members = active.filter(stand => group.terminals.includes(stand.terminal));
    if (members.length === 0) continue;
    const centroid = [
      members.reduce((sum, stand) => sum + stand.center[0], 0) / members.length,
      members.reduce((sum, stand) => sum + stand.center[1], 0) / members.length,
    ];
    const candidates = [...state.nodes.values()]
      .filter(node => node.kind === 'junction' && !node.id.startsWith('ls-'))
      .filter(node => state.edges.some(edge => TAXI_KINDS.includes(edge.kind) && (edge.a === node.id || edge.b === node.id)))
      .filter(node => !active.some(stand => pointInPolygon(node.p, stand.polygon)))
      .filter(node => !active.some(stand => stand.leadIn && pointToPolylineM(node.p, stand.leadIn).distanceM < 5))
      .map(node => ({ node, distanceM: haversineM(node.p, centroid) }))
      .sort((a, b) => a.distanceM - b.distanceM || compare(a.node.id, b.node.id));
    const chosen = candidates[0];
    if (!chosen) continue;
    chosen.node.kind = 'apronHold';
    apronHolds.push({ id: group.id, p: chosen.node.p, node: chosen.node.id, terminals: [...group.terminals] });
    report.apronHolds.push({ id: group.id, node: chosen.node.id, distanceToStandsM: round1(chosen.distanceM) });
  }
  return apronHolds;
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Markings

function buildMarkings(runways) {
  const markings = [];
  for (const runway of runways) {
    for (const end of runway.ends) {
      const half = runway.widthM / 2 - 3;
      markings.push({
        type: 'thresholdBar', runway: runway.id, ident: end.ident,
        line: [destinationPoint(end.threshold, end.headingTrue - 90, half),
          destinationPoint(end.threshold, end.headingTrue + 90, half)],
      });
      markings.push({
        type: 'designator', runway: runway.id, ident: end.ident,
        p: destinationPoint(end.threshold, end.headingTrue, 90), rotation: end.headingTrue,
      });
    }
    markings.push({
      type: 'centreline', runway: runway.id,
      line: [destinationPoint(runway.ends[0].threshold, runway.ends[0].headingTrue, 160),
        destinationPoint(runway.ends[1].threshold, runway.ends[1].headingTrue, 160)],
    });
  }
  return markings;
}

// ---------------------------------------------------------------------------------------------------------------
// Assembly

function bboxOf(rings) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings) for (const [lng, lat] of ring) {
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

/** Deep copy with every `[lng, lat]` pair rounded to 6 decimals and every other number left as it is. */
function roundGeometry(value) {
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every(item => typeof item === 'number')) return roundCoord(value, 6);
    return value.map(roundGeometry);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundGeometry(item)]));
  }
  return value;
}

function nearestDistanceToNetwork(ring, state) {
  let best = Infinity;
  const lines = state.edges.map(edge => edge.line ?? [state.nodes.get(edge.a).p, state.nodes.get(edge.b).p]);
  for (const point of ring) {
    for (const line of lines) best = Math.min(best, pointToPolylineM(point, line).distanceM);
  }
  return best;
}

function frequencyLabel(navaid) {
  return navaid.type === 'NDB' ? String(navaid.frequencyKhz) : (navaid.frequencyKhz / 1000).toFixed(1);
}

/**
 * Builds the layout, the region context and the QA report from the committed inputs. Pure and deterministic.
 * @param {{ osm: object, ourAirports: object, standPoints: Array<object>, overrides: object }} inputs
 */
export function buildLayout({ osm: rawOsm, ourAirports, standPoints, overrides = {} }) {
  const osm = readOsm(rawOsm);
  const standOverrides = { stands: overrides.stands ?? {} };
  const report = { runways: [], dropped: [], stands: [], leadIns: [], holds: [], apronHolds: [], summary: {} };

  const runways = buildRunways(osm, ourAirports, report);
  const state = buildGraphState(osm, report);

  const keepNear = (ring, type, id) => {
    const distanceM = nearestDistanceToNetwork(ring, state);
    if (distanceM > COMPONENT_RANGE_M) {
      report.dropped.push({ type, ids: [id], distanceM: round1(distanceM) });
      return false;
    }
    return true;
  };
  const terminals = waysOf(osm, 'terminal').filter(way => way.closed && keepNear(way.line, 'terminal', way.id))
    .map(way => ({ id: `term-${way.id}`, name: way.tags.name ?? null, ring: way.line }));
  const aprons = waysOf(osm, 'apron').filter(way => way.closed && keepNear(way.line, 'apron', way.id))
    .map(way => ({ id: `apron-${way.id}`, name: way.tags.name ?? null, polygon: way.line }));

  const gateNodes = osm.nodes.filter(node => node.tags.aeroway === 'gate' && node.tags.ref)
    .map(node => ({ id: node.id, ref: node.tags.ref, p: node.p }));
  const gates = gateNodes.map(({ ref, p }) => ({ ref, p }));
  // The OSM stand lines, matched or not, with the ref of the gate at either end: what the review scene draws beside the
  // generated boxes, so a person sees which line a point sits on and which one OSM ties to each gate.
  const gateRefs = new Map(gateNodes.map(gate => [gate.id, gate.ref]));
  const standLines = waysOf(osm, 'parking_position').map(way => ({
    way: way.id,
    gate: gateRefs.get(way.nodeIds[0]) ?? gateRefs.get(way.nodeIds[way.nodeIds.length - 1]) ?? null,
    line: way.line,
  }));
  const context = { terminals, gates: gateNodes, graph: currentGraph(state) };
  const stands = buildStands(osm, standPoints, standOverrides, context);
  for (const stand of stands) {
    if (stand.retired) continue;
    if (nearestDistanceToNetwork([stand.center], state) > COMPONENT_RANGE_M) stand.flags.push('offNetwork');
  }

  // QA: OSM gates, distances and overlaps.
  const active = stands.filter(stand => !stand.retired);
  for (const stand of stands) {
    const gate = gates.find(candidate => normalizeStandCode(candidate.ref) === stand.code) ?? null;
    stand.gate = gate ? { ref: gate.ref, p: gate.p, distanceM: round1(haversineM(stand.center, gate.p)) } : null;
    stand.centroidDistanceM = stand.osmCentroid ? round1(haversineM(stand.center, stand.osmCentroid)) : null;
    if ((stand.centroidDistanceM ?? 0) > FAR_M || (stand.gate?.distanceM ?? 0) > FAR_M) stand.flags.push('far');
    stand.overlaps = [];
    let worst = 0;
    if (!stand.retired) {
      for (const other of active) {
        if (other === stand) continue;
        const pct = overlapPct(stand, other);
        if (pct > 0.05) stand.overlaps.push(other.code);
        worst = Math.max(worst, pct);
      }
    }
    stand.overlapMaxPct = round1(worst);
    if (worst > OVERLAP_PCT) stand.flags.push('overlap');
  }
  // QA: a box that a taxiway or taxilane of OSM runs through is not a place to park (seen in the review scene: BN9).
  const taxiLines = state.edges.filter(edge => TAXI_KINDS.includes(edge.kind))
    .map(edge => edge.line ?? [state.nodes.get(edge.a).p, state.nodes.get(edge.b).p]);
  for (const stand of active) {
    if (taxiLines.some(line => lineEntersPolygon(line, stand.polygon))) stand.flags.push('crossesTaxiway');
  }

  addLeadIns(state, stands, report);
  // QA: a lead-in drawn where OSM maps no taxilane may run through a neighbour's box, or reach the stand from its side
  // or its nose: no aircraft taxis through a box, and every aircraft rolls in nose first from behind.
  for (const stand of active) {
    if (!stand.leadIn) continue;
    if (active.some(other => other !== stand && lineEntersPolygon(stand.leadIn, other.polygon))) {
      stand.flags.push('leadInCrosses');
    }
    if (!isBehind(stand.center, stand.headingTrue, stand.leadIn[0])) stand.flags.push('leadInNotBehind');
  }
  const holdingPoints = addHoldingPoints(state, runways, osm, report);
  const apronHolds = addApronHolds(state, stands, report);

  const usedWays = new Set(state.edges.map(edge => edge.way).filter(id => id != null));
  const taxiways = osm.ways
    .filter(way => (way.tags.aeroway === 'taxiway' || way.tags.aeroway === 'taxilane') && usedWays.has(way.id))
    .map(way => ({ id: `tw-${way.id}`, ref: way.tags.ref ?? null, kind: way.tags.aeroway, line: way.line }));

  // Aliases come only from the manual table (owner-confirmed); none is ever inferred.
  const aliasesOf = code => Object.entries(overrides.aliases ?? {})
    .filter(([, target]) => normalizeStandCode(target) === code)
    .map(([alias]) => alias)
    .sort(compare);
  const flagOrder = QA_FLAGS;
  const layoutStands = stands.map(stand => {
    const flags = flagOrder.filter(flag => stand.flags.includes(flag));
    const reviewed = typeof stand.override.reviewedBy === 'string' && stand.override.reviewedBy !== '';
    const entry = {
      code: stand.code,
      terminal: stand.terminal,
      kind: stand.kind,
      bridge: stand.bridge,
      aliases: aliasesOf(stand.code),
      center: stand.center,
      headingTrue: round1(stand.headingTrue),
      sizeLetter: stand.sizeLetter,
      widthM: round1(stand.widthM),
      polygon: stand.polygon,
      leadIn: stand.leadIn ?? null,
      node: stand.node ?? null,
      retired: stand.retired,
      overlaps: stand.overlaps,
      provenance: {
        center: 'elevant',
        polygon: Array.isArray(stand.override.polygon) ? 'manual'
          : stand.match ? `osm:way/${stand.match.way.id}` : 'derived',
        heading: stand.headingSource,
        qa: reviewed ? 'reviewed' : 'auto',
      },
      qa: {
        flags,
        osmWay: stand.match?.way.id ?? null,
        osmCentroid: stand.osmCentroid ?? null,
        centroidDistanceM: stand.centroidDistanceM,
        gate: stand.gate,
        overlapMaxPct: stand.overlapMaxPct,
      },
    };
    if (stand.headingFrom) entry.provenance.headingFrom = stand.headingFrom;
    if (reviewed) {
      entry.provenance.reviewedBy = stand.override.reviewedBy;
      entry.provenance.reviewedOn = stand.override.reviewedOn ?? null;
    }
    if (stand.override.note) entry.note = stand.override.note;
    report.stands.push({
      code: stand.code, terminal: stand.terminal, kind: stand.kind, retired: stand.retired,
      osmWay: entry.qa.osmWay, centroidDistanceM: entry.qa.centroidDistanceM,
      gateRef: stand.gate?.ref ?? null, gateDistanceM: stand.gate?.distanceM ?? null,
      headingTrue: entry.headingTrue, headingSource: stand.headingSource, headingFrom: stand.headingFrom ?? null,
      sizeLetter: stand.sizeLetter, widthM: entry.widthM, overlapMaxPct: stand.overlapMaxPct,
      leadIn: stand.leadInMethod ?? null, flags,
    });
    return entry;
  });

  for (const flag of flagOrder) {
    report.summary[flag] = report.stands.filter(stand => stand.flags.includes(flag)).map(stand => stand.code);
  }

  const graphNodes = [...state.nodes.values()].sort((a, b) => compare(a.id, b.id))
    .map(node => ({ id: node.id, p: node.p, kind: node.kind }));
  const graphEdges = state.edges
    .map(edge => {
      const out = { a: edge.a, b: edge.b, m: edge.m, kind: edge.kind, ref: edge.ref };
      if (edge.line) out.line = edge.line;
      return out;
    })
    .sort((x, y) => compare(x.a, y.a) || compare(x.b, y.b) || x.m - y.m);

  const extractedAt = rawOsm?.osm3s?.timestamp_osm_base ?? null;
  const fetchedAt = ourAirports?.meta?.fetchedAt ?? null;
  const activePolygons = layoutStands.filter(stand => !stand.retired).map(stand => stand.polygon);
  const bbox = bboxOf([
    ...runways.map(runway => runway.polygon), ...taxiways.map(taxiway => taxiway.line),
    ...aprons.map(apron => apron.polygon), ...terminals.map(terminal => terminal.ring), ...activePolygons,
  ]);

  const layout = roundGeometry({
    schema: LAYOUT_SCHEMA,
    meta: {
      icao: ourAirports.airport?.icao ?? 'MDPC',
      iata: ourAirports.airport?.iata ?? 'PUJ',
      name: ourAirports.airport?.name ?? null,
      arp: [...ARP],
      elevationFt: ourAirports.airport?.elevationFt ?? null,
      bbox: [roundCoord([bbox[0], bbox[1]]), roundCoord([bbox[2], bbox[3]])].flat(),
      sources: [
        { id: 'osm', name: 'OpenStreetMap', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', extractedAt },
        { id: 'ourairports', name: 'OurAirports', license: 'public domain', fetchedAt },
        { id: 'elevant', name: 'ELEVANT', note: '42 puntos internos (41 activos, B33 retirada), sin verificar contra el AIP' },
      ],
      frequencies: (ourAirports.frequencies ?? []).map(row => ({ ...row })),
    },
    runways,
    taxiways,
    taxiGraph: { nodes: graphNodes, edges: graphEdges },
    holdingPoints,
    apronHolds,
    aprons,
    terminals: terminals.map(terminal => ({ id: terminal.id, name: terminal.name, polygon: terminal.ring })),
    stands: layoutStands,
    markings: buildMarkings(runways),
    operations: { preferred: { arrival: '08', departure: '08' }, source: 'assumption', basis: 'owner-decision-19' },
    qa: { gates, standLines },
  });

  const region = roundGeometry({
    meta: { source: 'OurAirports', license: 'public domain', extractedAt: fetchedAt },
    airports: (ourAirports.regionalAirports ?? []).map(airport => ({
      ident: airport.ident, icao: airport.icao, iata: airport.iata, name: airport.name, type: airport.type,
      municipality: airport.municipality, country: airport.country, p: [airport.lon, airport.lat],
      elevationFt: airport.elevationFt, distanceNm: airport.distanceNm,
    })),
    navaids: (ourAirports.navaids ?? []).map(navaid => ({
      ident: navaid.ident, name: navaid.name, type: navaid.type, frequencyKhz: navaid.frequencyKhz,
      frequencyLabel: frequencyLabel(navaid), p: [navaid.lon, navaid.lat], elevationFt: navaid.elevationFt,
    })),
  });

  return { layout, region, report };
}

// ---------------------------------------------------------------------------------------------------------------
// Output formats

/** JSON with two-space indentation, every `[lng, lat]` pair on one line, and a final newline. */
export function stringifyLayout(value) {
  return `${JSON.stringify(value, null, 2)
    .replace(/\[\n\s+(-?[\d.eE+-]+),\n\s+(-?[\d.eE+-]+)\n\s+\]/gu, '[$1, $2]')}\n`;
}

const cell = value => (value === null || value === undefined ? '—' : String(value));

/** The QA report as Markdown: one row per stand, then the runways, holds, apron holds and what was dropped. */
export function formatReport(report) {
  const lines = [
    '| Posición | Terminal | Tipo | Way OSM | Dist. centroide (m) | Puerta OSM | Dist. puerta (m) | Rumbo | Fuente rumbo | Letra | Ancho (m) | Solape máx. % | Entrada | Marcas |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const stand of report.stands) {
    lines.push(`| ${stand.code}${stand.retired ? ' (retirada)' : ''} | ${stand.terminal} | ${stand.kind} | ${cell(stand.osmWay)} | `
      + `${cell(stand.centroidDistanceM)} | ${cell(stand.gateRef)} | ${cell(stand.gateDistanceM)} | ${stand.headingTrue} | `
      + `${stand.headingSource}${stand.headingFrom ? ` (${stand.headingFrom})` : ''} | ${stand.sizeLetter} | `
      + `${stand.widthM} | ${stand.overlapMaxPct} | ${cell(stand.leadIn)} | `
      + `${stand.flags.join(', ') || '—'} |`);
  }
  lines.push('', '**Resumen de marcas**', '');
  for (const [flag, codes] of Object.entries(report.summary)) {
    lines.push(`- ${flag}: ${codes.length}${codes.length ? ` (${codes.join(', ')})` : ''}`);
  }
  lines.push('', '**Pistas**', '');
  for (const runway of report.runways) {
    lines.push(`- ${runway.id}: way ${cell(runway.osmWay)}, extremos OSM a ${cell(runway.osmEndDistanceM?.join(' m y '))} m `
      + `de los umbrales de OurAirports${runway.flags.length ? `; marcas: ${runway.flags.join(', ')}` : ''}`);
  }
  lines.push('', '**Puntos de espera**', '');
  for (const hold of report.holds) {
    lines.push(`- ${hold.id}: pista ${hold.runway}, calle ${hold.taxiwayRef}, fuente ${hold.source}, a ${hold.offsetM} m del eje`);
  }
  lines.push('', '**Esperas de plataforma**', '');
  for (const hold of report.apronHolds) {
    lines.push(`- ${hold.id}: nodo ${hold.node}, a ${hold.distanceToStandsM} m del centro de sus posiciones`);
  }
  lines.push('', '**Descartado**', '');
  if (report.dropped.length === 0) lines.push('- nada');
  for (const item of report.dropped) {
    lines.push(`- ${item.type}: ${item.ids.join(', ')}${item.distanceM != null ? ` (a ${item.distanceM} m)` : ''}`
      + `${item.nodes != null ? ` (${item.nodes} nodos)` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
