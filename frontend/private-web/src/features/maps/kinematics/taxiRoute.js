import { normalizeStandCode } from '../../../services/standCodes.js';
import {
  destinationPoint,
  easePolyline,
  filletPath,
  haversineM,
  initialBearing,
  measurePolyline,
  nearestOnPolyline,
  pointAlong,
  resampleFilletPath,
  toLocal,
} from '../airport/geo.js';
import { centrelineBetween } from '../airport/runwayInUse.js';
import { buildTaxiGraph, edgeLine, nearestEdge, routeBetween, routeLine } from '../airport/taxiGraph.js';

// Taxi routes for the map kinematics (PR M6, design F2 as adjusted by contracts 2.3): the route on the layout's taxi
// graph by a cost per edge, then its line eased, rounded with 30 m arcs and resampled every 5 m with the tangent
// heading, so a trajectory only has to walk it at a speed. Geometry only: no time is read or written here. Metres,
// degrees true, `[lng, lat]`; the rounding works in the east-north plane of the path's first point. The layout always
// arrives as a parameter and each one gets its own cached graph. Pure: explicit '.js' imports, no clock, no JSON.

/** The cost of a metre by edge kind: an inactive runway costs ten times a taxiway; a runway in use, one. */
export const TAXI_COST = Object.freeze({ taxiway: 1, taxilane: 1.3, leadin: 2, runway: 10 });
/** The radius corners are rounded at, and the spacing of the samples, in metres. */
export const TAXI_FILLET_M = 30;
export const TAXI_STEP_M = 5;
/** Easing widens corners below this radius, moving the line at most `TAXI_MAX_SHIFT_M` from the graph's. */
export const TAXI_MIN_RADIUS_M = 20;
export const TAXI_MAX_SHIFT_M = 15;
/** A sample is `turning` above this curvature (1/m): a radius under 60 m. */
export const TURNING_CURVATURE = 1 / 60;
/** How far a pushback goes along the taxiway behind the stand, at most. */
export const PUSHBACK_MAX_M = 40;
/** How far the line-up runs along the centreline past the exit, so the turn onto the runway is rounded. */
export const LINE_UP_RUN_M = 60;
/** An exit lies on a runway when it is this close to the runway's centreline. */
export const EXIT_ON_CENTERLINE_M = 1;
/** The way an exit leaves a runway is read over this first stretch of each of its taxi edges, in metres. */
export const EXIT_TURN_PROBE_M = 10;
// Holding points this close in distance to the threshold are equally «full length»: the shorter route decides.
const HOLD_TIE_M = 20;
// A street leaves the lead-in's join «behind» the first taxi edge when it points within this of the opposite way.
const BEHIND_DEG = 60;
// A pushback continues through a node only onto a street turning less than this.
const STRAIGHT_ON_DEG = 30;
// A pushback line that doubles back on itself by more than this loses the vertex.
const DOUBLE_BACK_RAD = (150 * Math.PI) / 180;
// How far ahead along the graph line a sample may find its edge (a hairpin the easing cut is skipped).
const KIND_WINDOW_M = 400;

const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const normalizeDeg = degrees => {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
};
const freezePoint = point => Object.freeze([point[0], point[1]]);
const graphs = new WeakMap();
const exitsByLayout = new WeakMap();

/** The taxi graph of a layout, built once per layout object. */
export function graphFor(layout) {
  let graph = graphs.get(layout);
  if (!graph) {
    graph = buildTaxiGraph(layout?.taxiGraph ?? {});
    graphs.set(layout, graph);
  }
  return graph;
}

/**
 * The cost of an edge for a taxiing aircraft: `edge => edge.m × factor` (`TAXI_COST`), where a runway edge whose
 * `ref` is in `activeRunwayIds` costs its length and one in `closedRunwayIds` is never used (Infinity).
 */
export function taxiCostFn({ activeRunwayIds = [], closedRunwayIds = [] } = {}) {
  const active = new Set(activeRunwayIds);
  const closed = new Set(closedRunwayIds);
  return edge => {
    if (edge.kind === 'runway') {
      if (closed.has(edge.ref)) return Infinity;
      return edge.m * (active.has(edge.ref) ? 1 : TAXI_COST.runway);
    }
    return edge.m * (TAXI_COST[edge.kind] ?? 1);
  };
}

/**
 * How far an aircraft rolling along `headingDeg` turns to leave by an exit node: the smallest angle between that
 * heading and the bearing of the first 10 m of each of the node's edges that are not runway (an edge without length
 * shows no way). Infinity when no edge shows one.
 */
function exitTurnDeg(graph, node, headingDeg) {
  let least = Infinity;
  for (const { edge } of graph.adjacency.get(node.id)) {
    if (edge.kind === 'runway') continue;
    const line = edge.a === node.id ? edgeLine(graph, edge) : [...edgeLine(graph, edge)].reverse();
    const probe = pointAlong(line, EXIT_TURN_PROBE_M);
    if (probe.bearingDeg === null) continue;
    least = Math.min(least, angleBetween(initialBearing(node.p, probe.p), headingDeg));
  }
  return least;
}

/**
 * The exits of a runway end, nearest to its threshold first: `[{ nodeId, p, alongM, turnDeg }]`, frozen, where
 * `alongM` is the distance along the centreline from the threshold and `turnDeg` how far an aircraft rolling along the
 * end's heading turns to leave by it, read over the first 10 m of each of its edges that are not runway (0° runs
 * straight on, 90° is a right-angle exit; more points back towards the threshold: a rapid exit built for the other
 * direction). An exit is an `exit` node within 1 m of the centreline with at least one edge that is not runway; the
 * same node is an exit of both ends of its runway, with its own `alongM` and `turnDeg` for each.
 */
export function runwayExits(layout, end) {
  if (!end?.centerline) return Object.freeze([]);
  let byEnd = exitsByLayout.get(layout);
  if (!byEnd) {
    byEnd = new Map();
    exitsByLayout.set(layout, byEnd);
  }
  const cacheKey = `${end.runwayId}|${end.ident}`;
  if (byEnd.has(cacheKey)) return byEnd.get(cacheKey);
  const graph = graphFor(layout);
  const centreline = measurePolyline(end.centerline);
  const exits = [];
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'exit') continue;
    if (!graph.adjacency.get(node.id).some(({ edge }) => edge.kind !== 'runway')) continue;
    const hit = nearestOnPolyline(centreline, node.p);
    if (hit === null || hit.distanceM > EXIT_ON_CENTERLINE_M) continue;
    exits.push(Object.freeze({
      nodeId: node.id, p: freezePoint(node.p), alongM: hit.alongM, turnDeg: exitTurnDeg(graph, node, end.headingTrue),
    }));
  }
  exits.sort((a, b) => a.alongM - b.alongM || compareIds(a.nodeId, b.nodeId));
  const result = Object.freeze(exits);
  byEnd.set(cacheKey, result);
  return result;
}

/** The layout's stand for a stand object or a code («A01» is «A1»), active and joined to the graph; or `null`. */
function resolveStand(layout, stand) {
  if (stand?.node && graphFor(layout).nodes.has(stand.node)) return stand;
  const code = normalizeStandCode(typeof stand === 'string' ? stand : stand?.code);
  if (code === '') return null;
  return (layout?.stands ?? []).find(candidate => candidate.retired !== true && candidate.node
    && normalizeStandCode(candidate.code) === code) ?? null;
}

/** The apron hold whose terminal group includes `terminal`: `{ id, p, node, terminals }`, or `null`. */
export function apronHoldFor(layout, terminal) {
  if (terminal === null || terminal === undefined) return null;
  return (layout?.apronHolds ?? []).find(hold => (hold.terminals ?? []).includes(terminal)) ?? null;
}

const directedLine = (graph, edge, fromId) => (edge.a === fromId ? edgeLine(graph, edge) : [...edgeLine(graph, edge)].reverse());

/** The pieces of a route: each edge's line in the direction of travel with its kind. */
function routePieces(graph, route) {
  return route.edges.map((edge, at) => ({ coords: directedLine(graph, edge, route.nodeIds[at]), kind: edge.kind }));
}

function segmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0
    : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

/** Drops the vertices where a planar line doubles back on itself (a pushback into a dead end), never its ends. */
function withoutDoublingBack(points) {
  const kept = [...points];
  let changed = true;
  while (changed && kept.length > 2) {
    changed = false;
    for (let at = 1; at < kept.length - 1; at += 1) {
      const u = [kept[at][0] - kept[at - 1][0], kept[at][1] - kept[at - 1][1]];
      const v = [kept[at + 1][0] - kept[at][0], kept[at + 1][1] - kept[at][1]];
      const turn = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
      if (turn > DOUBLE_BACK_RAD) {
        kept.splice(at, 1);
        changed = true;
        break;
      }
    }
  }
  return kept;
}

/**
 * A TaxiPath from pieces of line (`[{ coords: [[lng, lat]…], kind }]`, in order): `{ coords, headingsDeg, kinds,
 * turning, alongM, lengthM, stepM, heading, nodeIds, edges }`, frozen. The joined line is eased and rounded in the
 * east-north plane of its first point, then sampled every `stepM` (the last sample is the line's end). `headingsDeg`
 * is the tangent ('tangent') or its opposite ('reverse': a pushback, the nose away from the motion); `kinds[i]` is
 * the kind of the piece sample i lies on and `turning[i]` whether the path curves tighter than 60 m there.
 */
function buildTaxiPath(pieces, { nodeIds, edges, heading = 'tangent', filletM, stepM, doublingBack = false, extra = {} }) {
  const line = [];
  const lineKinds = [];
  for (const piece of pieces) {
    piece.coords.forEach(point => {
      const last = line[line.length - 1];
      if (last !== undefined && haversineM(last, point) <= 0.01) return;
      line.push(point);
      lineKinds.push(piece.kind);
    });
  }
  if (line.length === 0) return null;
  const origin = line[0];
  const plane = toLocal(origin);
  const flat = line.map(plane.forward);
  const rounded = filletPath(
    easePolyline(doublingBack ? withoutDoublingBack(flat) : flat, {
      radiusM: filletM, minRadiusM: TAXI_MIN_RADIUS_M, maxShiftM: TAXI_MAX_SHIFT_M,
    }),
    filletM,
  );
  const samples = resampleFilletPath(rounded, stepM);
  const count = samples.coords.length;
  const coords = samples.coords.map((point, at) => {
    if (at === 0) return freezePoint(origin);
    if (at === count - 1) return freezePoint(line[line.length - 1]);
    return freezePoint(plane.inverse(point));
  });
  const flip = heading === 'reverse' ? 180 : 0;
  const headingsDeg = samples.tangentsDeg.map(value => (value === null ? null : normalizeDeg(value + flip)));

  // Each sample takes the kind of the graph segment it lies along, walking forward only.
  const cumulative = [0];
  for (let at = 1; at < flat.length; at += 1) {
    cumulative.push(cumulative[at - 1] + Math.hypot(flat[at][0] - flat[at - 1][0], flat[at][1] - flat[at - 1][1]));
  }
  const kinds = [];
  let segment = 0;
  for (const point of samples.coords) {
    if (flat.length < 2) {
      kinds.push(lineKinds[0]);
      continue;
    }
    let best = segment;
    let bestDistance = Infinity;
    for (let at = segment; at < flat.length - 1 && cumulative[at] <= cumulative[segment + 1] + KIND_WINDOW_M; at += 1) {
      const distance = segmentDistance(point, flat[at], flat[at + 1]);
      if (distance < bestDistance - 1e-9) {
        bestDistance = distance;
        best = at;
      }
    }
    segment = best;
    kinds.push(lineKinds[best + 1]);
  }

  const turning = headingsDeg.map((_, at) => {
    const before = Math.max(0, at - 1);
    const after = Math.min(count - 1, at + 1);
    const span = samples.alongM[after] - samples.alongM[before];
    if (!(span > 0) || headingsDeg[before] === null || headingsDeg[after] === null) return false;
    return (angleBetween(headingsDeg[after], headingsDeg[before]) * Math.PI) / 180 / span > TURNING_CURVATURE;
  });

  return Object.freeze({
    coords: Object.freeze(coords),
    headingsDeg: Object.freeze(headingsDeg),
    kinds: Object.freeze(kinds),
    turning: Object.freeze(turning),
    alongM: samples.alongM,
    lengthM: samples.alongM[count - 1],
    stepM,
    heading,
    nodeIds: Object.freeze([...nodeIds]),
    edges: Object.freeze([...edges]),
    ...extra,
  });
}

/**
 * The TaxiPath of a graph route (`routeBetween`): its line eased, rounded with `filletM` arcs and resampled every
 * `stepM` metres, the heading the tangent. `{ coords, headingsDeg, kinds, turning, alongM, lengthM, stepM, heading,
 * nodeIds, edges }`, frozen.
 */
export function taxiPath(layout, route, { filletM = TAXI_FILLET_M, stepM = TAXI_STEP_M } = {}) {
  if (!route) return null;
  const graph = graphFor(layout);
  const pieces = route.edges.length > 0 ? routePieces(graph, route) : [{ coords: routeLine(graph, route), kind: 'taxiway' }];
  return buildTaxiPath(pieces, { nodeIds: route.nodeIds, edges: route.edges, filletM, stepM });
}

/** The runways whose edges meet at a node: an aircraft at an exit leaves them, so its taxi route never rolls on them. */
function runwaysAt(graph, nodeId) {
  return [...new Set((graph.adjacency.get(nodeId) ?? [])
    .filter(({ edge }) => edge.kind === 'runway' && edge.ref !== null && edge.ref !== undefined)
    .map(({ edge }) => edge.ref))];
}

/**
 * The taxi from a runway exit to a stand's centre, ending on its lead-in (a TaxiPath), or `null`. The runway the exit
 * is on is closed to the route (the aircraft has just left it); other runways cost as `taxiCostFn` says.
 */
export function routeExitToStand(layout, { exitNodeId, stand, activeRunwayIds = [] } = {}, options = {}) {
  const graph = graphFor(layout);
  const target = resolveStand(layout, stand);
  if (!target || !graph.nodes.has(exitNodeId)) return null;
  const costFn = taxiCostFn({ activeRunwayIds, closedRunwayIds: runwaysAt(graph, exitNodeId) });
  return taxiPath(layout, routeBetween(graph, exitNodeId, target.node, { costFn }), options);
}

/**
 * The taxi from a runway exit to the apron hold of the stand's terminal group (a flight without a stand waits there),
 * or, without a terminal or a hold for it, to the apron hold the shortest route reaches: a TaxiPath or `null`.
 */
export function routeExitToApronHold(layout, { exitNodeId, terminal = null, activeRunwayIds = [] } = {}, options = {}) {
  const graph = graphFor(layout);
  if (!graph.nodes.has(exitNodeId)) return null;
  const costFn = taxiCostFn({ activeRunwayIds, closedRunwayIds: runwaysAt(graph, exitNodeId) });
  const best = apronHoldRoute(layout, graph, exitNodeId, { terminal, costFn });
  return best === null ? null : taxiPath(layout, best.route, options);
}

/** The apron hold named (object or id), else the terminal's, else the one the cheapest route reaches (ties by id). */
function apronHoldRoute(layout, graph, fromNodeId, { terminal = null, apronHold = null, costFn }) {
  const named = typeof apronHold === 'string'
    ? (layout?.apronHolds ?? []).find(candidate => candidate.id === apronHold || candidate.node === apronHold) ?? null
    : apronHold;
  const own = named ?? apronHoldFor(layout, terminal);
  const holds = own ? [own] : (layout?.apronHolds ?? []);
  let best = null;
  for (const hold of holds) {
    if (!graph.nodes.has(hold.node)) continue;
    const route = routeBetween(graph, fromNodeId, hold.node, { costFn });
    if (route && (best === null || route.cost < best.cost - 1e-9
      || (Math.abs(route.cost - best.cost) <= 1e-9 && compareIds(hold.id, best.hold.id) < 0))) {
      best = { route, cost: route.cost, hold };
    }
  }
  return best;
}

/**
 * The ground path of a landing (PR M6): from `fromAlongM` metres along `runwayEnd`'s centreline (the touchdown point)
 * to the exit `exitNodeId`, then the taxi to a stand's centre or, without a stand, to an apron hold (`apronHold`, else
 * the `terminal`'s, else the one the cheapest route reaches), eased, rounded and sampled as one line, so the turn-off
 * has no heading step. A TaxiPath with `exit`, `fromAlongM` and `apronHold` (the hold it ends at, or `null`) added:
 * the samples on the centreline are of kind 'runway'. The runway the exit is on is closed to the taxi. `null` when the
 * exit is not on that runway beyond `fromAlongM`, or nothing is reachable.
 */
export function routeLandingTaxi(layout, {
  runwayEnd, fromAlongM = 0, exitNodeId, stand = null, terminal = null, apronHold = null, activeRunwayIds = [],
} = {}, options = {}) {
  if (!runwayEnd) return null;
  const graph = graphFor(layout);
  const exit = runwayExits(layout, runwayEnd).find(candidate => candidate.nodeId === exitNodeId);
  if (!exit || !(exit.alongM > fromAlongM)) return null;
  const costFn = taxiCostFn({ activeRunwayIds, closedRunwayIds: runwaysAt(graph, exitNodeId) });
  let route = null;
  let hold = null;
  if (stand !== null && stand !== undefined) {
    const target = resolveStand(layout, stand);
    if (!target) return null;
    route = routeBetween(graph, exitNodeId, target.node, { costFn });
  } else {
    const best = apronHoldRoute(layout, graph, exitNodeId, { terminal, apronHold, costFn });
    route = best?.route ?? null;
    hold = best?.hold ?? null;
  }
  if (!route) return null;
  const pieces = [
    { coords: centrelineBetween(runwayEnd, fromAlongM, exit.alongM), kind: 'runway' },
    ...routePieces(graph, route),
  ];
  return buildTaxiPath(pieces, {
    nodeIds: route.nodeIds,
    edges: route.edges,
    filletM: options.filletM ?? TAXI_FILLET_M,
    stepM: options.stepM ?? TAXI_STEP_M,
    extra: { exit, fromAlongM, apronHold: hold },
  });
}

/**
 * The holding point a departure from `departureEnd` taxis to: the runway's holding point nearest to the threshold
 * (the full length is left), the shorter route deciding between two within 20 m of each other.
 */
function departureHoldingPoint(layout, graph, departureEnd, fromNodeId, costFn) {
  const holds = (layout?.holdingPoints ?? [])
    .filter(hold => hold.runway === departureEnd.runwayId && graph.nodes.has(hold.node))
    .map(hold => ({ hold, distanceM: haversineM(hold.p, departureEnd.threshold) }))
    .sort((a, b) => a.distanceM - b.distanceM || compareIds(a.hold.id, b.hold.id));
  if (holds.length === 0) return null;
  const near = holds.filter(candidate => candidate.distanceM <= holds[0].distanceM + HOLD_TIE_M);
  let best = null;
  for (const { hold } of near) {
    const route = routeBetween(graph, fromNodeId, hold.node, { costFn });
    if (route && (best === null || route.cost < best.route.cost - 1e-9)) best = { hold, route };
  }
  return best;
}

/** From the holding point to its exit and onto the centreline: a TaxiPath with `exit` and `runwayAlongM` added. */
function lineUpPath(layout, graph, hold, departureEnd, { filletM, stepM }) {
  let best = null;
  for (const exit of runwayExits(layout, departureEnd)) {
    const route = routeBetween(graph, hold.node, exit.nodeId, { avoidKinds: ['runway'] });
    if (route && (best === null || route.lengthM < best.route.lengthM - 1e-9)) best = { exit, route };
  }
  if (best === null) return null;
  const runwayAlongM = Math.min(departureEnd.lengthM, best.exit.alongM + LINE_UP_RUN_M);
  const pieces = [
    ...routePieces(graph, best.route),
    { coords: centrelineBetween(departureEnd, best.exit.alongM, runwayAlongM), kind: 'runway' },
  ];
  return buildTaxiPath(pieces, {
    nodeIds: best.route.nodeIds, edges: best.route.edges, filletM, stepM, extra: { exit: best.exit, runwayAlongM },
  });
}

/** The point `distanceM` along a line from its start, by walking its segments. */
const along = (line, distanceM) => pointAlong(line, distanceM).p;

/**
 * The pushback of an aircraft parked at a stand, and the start of its taxi: `{ push, taxiStart, edges }`, where
 * `push` and `taxiStart` are pieces of line (`[{ coords, kind }]`). The aircraft backs along its lead-in (`backwards`,
 * from the stand centre to the join on the taxi network), then on along the street that leaves the join opposite to
 * the first taxi edge, at most 40 m (straight on through nodes); with no such street, 40 m straight back along the
 * first taxi edge's line. When the lead-in's last metres run along that line itself (a lead-in that continues a
 * dead-end lane), the pushback leaves them out and backs on from where they begin. The taxi starts where the
 * pushback ends and comes forward to the join. Without a first taxi edge the pushback is the lead-in alone.
 */
function pushbackPlan(graph, backwards, joinId, firstEdge) {
  const join = graph.nodes.get(joinId).p;
  if (!firstEdge) return { push: [{ coords: backwards, kind: 'leadin' }], taxiStart: [], edges: [] };
  const forward = initialBearing(join, along(directedLine(graph, firstEdge, joinId), Math.min(10, firstEdge.m)));
  const backward = normalizeDeg(forward + 180);
  const onLine = [];
  const kept = [...backwards];
  while (kept.length > 2 && angleBetween(initialBearing(kept[kept.length - 2], kept[kept.length - 1]), forward) <= BEHIND_DEG) {
    onLine.unshift(kept.pop());
  }
  if (onLine.length > 0) {
    const from = kept[kept.length - 1];
    const end = destinationPoint(from, backward, PUSHBACK_MAX_M);
    return {
      push: [{ coords: kept, kind: 'leadin' }, { coords: [from, end], kind: firstEdge.kind }],
      taxiStart: [{ coords: [end, from], kind: firstEdge.kind }, { coords: [from, ...onLine], kind: 'leadin' }],
      edges: [],
    };
  }
  const street = pushbackStreet(graph, joinId, firstEdge, backward);
  return {
    push: [{ coords: backwards, kind: 'leadin' }, { coords: street.coords, kind: street.kind }],
    taxiStart: [{ coords: [...street.coords].reverse(), kind: street.kind }],
    edges: street.edges,
  };
}

/** From the join, along the street opposite to the first taxi edge, or straight back: `{ coords, kind, edges }`. */
function pushbackStreet(graph, joinId, firstEdge, backward) {
  const join = graph.nodes.get(joinId).p;
  const streets = graph.adjacency.get(joinId)
    .filter(({ edge }) => edge !== firstEdge && edge.kind !== 'leadin' && edge.kind !== 'runway')
    .map(({ to, edge }) => {
      const coords = directedLine(graph, edge, joinId);
      const bearing = initialBearing(join, along(coords, Math.min(10, edge.m)));
      return { to, edge, coords, off: angleBetween(bearing, backward) };
    })
    .filter(street => street.off <= BEHIND_DEG)
    .sort((a, b) => a.off - b.off || compareIds(a.to, b.to));
  if (streets.length === 0) {
    return { coords: [join, destinationPoint(join, backward, PUSHBACK_MAX_M)], kind: firstEdge.kind, edges: [] };
  }
  // Along the street, then straight on through its nodes, until 40 m.
  const coords = [...streets[0].coords];
  const used = [streets[0].edge];
  let nodeId = streets[0].to;
  let previous = joinId;
  while (measurePolyline(coords).lengthM < PUSHBACK_MAX_M) {
    const incoming = initialBearing(coords[coords.length - 2], coords[coords.length - 1]);
    const next = graph.adjacency.get(nodeId)
      .filter(({ to, edge }) => to !== previous && edge.kind !== 'leadin' && edge.kind !== 'runway' && !used.includes(edge))
      .map(({ to, edge }) => {
        const line = directedLine(graph, edge, nodeId);
        return { to, edge, line, off: angleBetween(incoming, initialBearing(line[0], along(line, Math.min(10, edge.m)))) };
      })
      .filter(candidate => candidate.off < STRAIGHT_ON_DEG)
      .sort((a, b) => a.off - b.off || compareIds(a.to, b.to))[0];
    if (!next) break;
    coords.push(...next.line.slice(1));
    used.push(next.edge);
    previous = nodeId;
    nodeId = next.to;
  }
  const measured = measurePolyline(coords);
  const length = Math.min(PUSHBACK_MAX_M, measured.lengthM);
  const cut = [measured.coords[0]];
  measured.coords.forEach((point, at) => {
    if (at > 0 && measured.cumM[at] < length - 0.01) cut.push(point);
  });
  cut.push(pointAlong(measured, length).p);
  return { coords: cut, kind: streets[0].edge.kind, edges: used };
}

/**
 * The departure from a stand to the departure runway's holding point: `{ pushback, taxi, holdingPoint, lineUp }`, or
 * `null`.
 * - `holdingPoint`: the layout's holding point of `departureEnd`'s runway nearest to its threshold (at Punta Cana
 *   hp-E-08-26, 92 m from the 08 threshold, so the whole runway is left).
 * - `pushback` (heading 'reverse', the nose held away from the motion): back along the lead-in to the taxi network,
 *   then along the street that leaves it opposite to the first taxi edge, at most 40 m, rounded; behind a dead-end
 *   join, 40 m straight back along the line of the first taxi edge, so the nose always ends on the taxi direction.
 * - `taxi` starts where the pushback ends, passes the lead-in's join again and ends at the holding point.
 * - `lineUp` from the holding point to its exit and 60 m onto the centreline (`exit`, `runwayAlongM` added).
 * The departure runway is closed to the taxi (it holds short of it); other runways cost as `taxiCostFn` says.
 */
export function routeStandToHold(layout, { stand, departureEnd, activeRunwayIds = [] } = {}, options = {}) {
  const graph = graphFor(layout);
  const parked = resolveStand(layout, stand);
  if (!parked || !departureEnd) return null;
  const leadIn = graph.adjacency.get(parked.node).find(({ edge }) => edge.kind === 'leadin');
  if (!leadIn) return null;
  const joinId = leadIn.to;
  const costFn = taxiCostFn({ activeRunwayIds, closedRunwayIds: [departureEnd.runwayId] });
  const chosen = departureHoldingPoint(layout, graph, departureEnd, joinId, costFn);
  if (chosen === null) return null;
  const settings = { filletM: options.filletM ?? TAXI_FILLET_M, stepM: options.stepM ?? TAXI_STEP_M };
  const plan = pushbackPlan(graph, directedLine(graph, leadIn.edge, parked.node), joinId, chosen.route.edges[0]);
  const pushback = buildTaxiPath(plan.push, {
    nodeIds: [parked.node, joinId], edges: [leadIn.edge, ...plan.edges], heading: 'reverse', doublingBack: true, ...settings,
  });
  const taxiPieces = [...plan.taxiStart, ...routePieces(graph, chosen.route)];
  const taxi = buildTaxiPath(taxiPieces.length > 0 ? taxiPieces : [{ coords: routeLine(graph, chosen.route), kind: 'taxiway' }], {
    nodeIds: chosen.route.nodeIds, edges: chosen.route.edges, ...settings,
  });
  const lineUp = lineUpPath(layout, graph, chosen.hold, departureEnd, settings);
  return Object.freeze({ pushback, taxi, holdingPoint: chosen.hold, lineUp });
}

/**
 * The departure of an aircraft that waited at an apron hold (`apronHold` object or id): as `routeStandToHold`, without
 * a pushback. `{ pushback: null, taxi, holdingPoint, lineUp }`, or `null`.
 */
export function routeFromApronHold(layout, { apronHold, departureEnd, activeRunwayIds = [] } = {}, options = {}) {
  const graph = graphFor(layout);
  const hold = typeof apronHold === 'string'
    ? (layout?.apronHolds ?? []).find(candidate => candidate.id === apronHold || candidate.node === apronHold)
    : apronHold;
  if (!hold || !graph.nodes.has(hold.node) || !departureEnd) return null;
  const costFn = taxiCostFn({ activeRunwayIds, closedRunwayIds: [departureEnd.runwayId] });
  const chosen = departureHoldingPoint(layout, graph, departureEnd, hold.node, costFn);
  if (chosen === null) return null;
  const settings = { filletM: options.filletM ?? TAXI_FILLET_M, stepM: options.stepM ?? TAXI_STEP_M };
  const taxi = taxiPath(layout, chosen.route, settings);
  const lineUp = lineUpPath(layout, graph, chosen.hold, departureEnd, settings);
  return Object.freeze({ pushback: null, taxi, holdingPoint: chosen.hold, lineUp });
}

/**
 * The taxi from where an aircraft is (`point`, heading `headingDeg`) to a node, so a trajectory can resume without a
 * jump: a TaxiPath whose first point is exactly `point`, with the edge it starts on as `startEdge` (`nodeIds` and
 * `edges` begin at the node it leaves that edge by). The point is projected on the nearest edge and the route leaves
 * by the end ahead of the heading, never straight back along that edge; when the end ahead is a dead end (and not the
 * target), or nothing is reachable from it, it leaves by the other end.
 */
export function routeFromPoint(layout, { point, headingDeg = null, toNodeId, activeRunwayIds = [] } = {}, options = {}) {
  const graph = graphFor(layout);
  if (!Array.isArray(point) || !graph.nodes.has(toNodeId)) return null;
  const hit = nearestEdge(graph, point);
  if (hit === null) return null;
  const line = edgeLine(graph, hit.edge);
  const segmentBearing = initialBearing(line[hit.index], line[hit.index + 1]);
  const towardsB = headingDeg === null || !Number.isFinite(headingDeg) || angleBetween(headingDeg, segmentBearing) <= 90;
  const costFn = taxiCostFn({ activeRunwayIds });
  const withoutThisEdge = edge => (edge === hit.edge ? Infinity : costFn(edge));
  const settings = { filletM: options.filletM ?? TAXI_FILLET_M, stepM: options.stepM ?? TAXI_STEP_M };
  for (const side of towardsB ? ['b', 'a'] : ['a', 'b']) {
    const endId = hit.edge[side];
    if (endId !== toNodeId && graph.adjacency.get(endId).length === 1) continue;
    const onward = endId === toNodeId
      ? { nodeIds: [endId], edges: [] }
      : routeBetween(graph, endId, toNodeId, { costFn: withoutThisEdge });
    if (!onward) continue;
    const rest = side === 'b' ? line.slice(hit.index + 1) : line.slice(0, hit.index + 1).reverse();
    const start = hit.distanceM > 1 ? [point, hit.point] : [point];
    const pieces = [{ coords: [...start, ...rest], kind: hit.edge.kind }, ...routePieces(graph, onward)];
    return buildTaxiPath(pieces, {
      nodeIds: onward.nodeIds, edges: onward.edges, ...settings, extra: { startEdge: hit.edge },
    });
  }
  return null;
}
