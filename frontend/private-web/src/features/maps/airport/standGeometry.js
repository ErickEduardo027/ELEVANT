import { destinationPoint, haversineM, initialBearing, toLocal } from './geo.js';
import { buildTaxiGraph, edgeLine, nearestEdge } from './taxiGraph.js';

// The shape of a stand on the airport layout (PR M3): a box sized by the ICAO code letter of the largest aircraft it
// takes, centred on the stand point (owner decision 20: the point is the centre of the stand), its depth along the
// heading the parked aircraft's nose points to, and the lead-in line from the taxilane to that centre. Pure and
// Node-safe like geo.js. Where a stand is drawn once OCC saved a location for it (resolveStandGeometry, at the end of
// this file) is PR M4.

/** Span limit plus Annex 14 clearance (width) and the length of the longest common type (depth), in metres. */
export const STAND_BOX = Object.freeze({
  C: Object.freeze({ widthM: 41, depthM: 50 }),
  D: Object.freeze({ widthM: 60, depthM: 66 }),
  E: Object.freeze({ widthM: 73, depthM: 80 }),
  F: Object.freeze({ widthM: 88, depthM: 82 }),
});

export const SIZE_LETTERS = Object.freeze(Object.keys(STAND_BOX));

/**
 * How far behind a stand's centre an aircraft of its code letter lines up on the stand axis when no taxi edge lies
 * straight behind it: half the box's depth plus half its width. Taxiing across the row there, its wingtips clear the
 * tails of the stands beside it.
 */
export function lineUpDistanceM(sizeLetter) {
  const size = STAND_BOX[sizeLetter];
  if (!size) throw new Error(`Unknown stand size letter: ${sizeLetter}`);
  return (size.depthM + size.widthM) / 2;
}

const normalizeBearing = degrees => ((degrees % 360) + 360) % 360;
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * The closed 5-point ring `[lng, lat]` of a stand box: nose-left, nose-right, tail-right, tail-left, nose-left.
 * `maxWidthM` narrows the box (never widens it) where the row spacing is tighter than the code letter.
 */
export function standBox(center, headingTrue, sizeLetter, { maxWidthM = Infinity } = {}) {
  const size = STAND_BOX[sizeLetter];
  if (!size) throw new Error(`Unknown stand size letter: ${sizeLetter}`);
  const width = Math.min(size.widthM, maxWidthM);
  const plane = toLocal(center);
  const radians = (headingTrue * Math.PI) / 180;
  const nose = [Math.sin(radians), Math.cos(radians)];
  const right = [Math.cos(radians), -Math.sin(radians)];
  const corner = (along, across) => plane.inverse([
    nose[0] * along + right[0] * across,
    nose[1] * along + right[1] * across,
  ]);
  const halfDepth = size.depthM / 2;
  const halfWidth = width / 2;
  const ring = [
    corner(halfDepth, -halfWidth),
    corner(halfDepth, halfWidth),
    corner(-halfDepth, halfWidth),
    corner(-halfDepth, -halfWidth),
  ];
  return [...ring, ring[0]];
}

/**
 * Picks the direction of an axis (`axisDeg` or its opposite) that points towards `target` (`towards: true`, the
 * terminal for a contact stand) or away from it (`towards: false`, the taxilane for a remote stand). The result is in
 * [0, 360).
 */
export function headingFromAxis(axisDeg, center, target, { towards = true } = {}) {
  const forward = normalizeBearing(axisDeg);
  const backward = normalizeBearing(axisDeg + 180);
  const bearing = initialBearing(center, target);
  const forwardCloser = angleBetween(forward, bearing) <= angleBetween(backward, bearing);
  return forwardCloser === towards ? forward : backward;
}

/**
 * The lead-in line from the taxi network to the stand centre: `[snapPoint, center]` when the snap point lies on the
 * stand's tail axis, otherwise `[snapPoint, alignPoint, center]`, where the aircraft lines up behind the stand on its
 * axis before rolling in nose first. The align point sits abreast of the snap point, and at least `minAlignM` metres
 * behind the centre (`lineUpDistanceM`, so the aircraft lines up clear of its row instead of crossing it).
 */
export function leadIn(center, headingTrue, snapPoint, { minAlignM = 0 } = {}) {
  const plane = toLocal(center);
  const [x, y] = plane.forward(snapPoint);
  const back = normalizeBearing(headingTrue + 180);
  const radians = (back * Math.PI) / 180;
  const alongBack = Math.max(minAlignM, x * Math.sin(radians) + y * Math.cos(radians));
  const align = destinationPoint(center, back, alongBack);
  const line = [snapPoint];
  if (haversineM(align, snapPoint) > 1 && haversineM(align, center) > 1) line.push(align);
  line.push(center);
  return line;
}

// ---------------------------------------------------------------------------------------------------------------
// Where a stand is drawn (PR M4, design C5). The owner decided on 2026-11-13 that his coordinate document wins over
// OpenStreetMap, which is out of date at the airport: the layout's stands are drawn as the layout has them, and a stand
// moves only when OCC places it («Ubicar en el mapa»). Nothing here reads OpenStreetMap or the layout's QA tables.

/** Up to this distance from the layout's centre, a location OCC saved moves the layout's box rigidly. */
export const MAX_TRANSLATION_M = 80;
/** A box of its own takes the heading of the nearest active stand of the layout within this distance. */
export const NEIGHBOUR_HEADING_RADIUS_M = 150;
/** The code letter of a box of its own by the largest aircraft the stand takes; D when that is unknown. */
export const SIZE_FROM_AIRCRAFT = Object.freeze({ Widebody: 'E', Narrowbody: 'C' });

const DEFAULT_SIZE_LETTER = 'D';
// Lead-ins are drawn as the layout generator draws them: straight in from a taxi edge that lies behind the stand
// within this range, otherwise from where the aircraft lines up behind its box.
const LEAD_IN_RANGE_M = 150;
const TAXI_KINDS = Object.freeze(['taxiway', 'taxilane']);
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

/** A location as `[lng, lat]`, from `[lng, lat]`, `{ longitude, latitude }` or `{ lon, lat }`; `null` without one. */
export function locationPoint(location) {
  const lng = Array.isArray(location) ? location[0] : location?.longitude ?? location?.lon;
  const lat = Array.isArray(location) ? location[1] : location?.latitude ?? location?.lat;
  return isFiniteNumber(lng) && isFiniteNumber(lat) ? [lng, lat] : null;
}

/**
 * Moves `points` (`[lng, lat]`) rigidly by the shift from `from` to `to`, in the local plane of `from`: the shape,
 * every distance and every bearing between the points are kept (to well under a centimetre across the airfield).
 */
export function translateRigid(points, from, to) {
  const plane = toLocal(from);
  const [dx, dy] = plane.forward(to);
  return points.map(point => {
    const [x, y] = plane.forward(point);
    return plane.inverse([x + dx, y + dy]);
  });
}

// A layout stand that can be drawn as the layout has it: a centre, a ring, a heading and a known code letter.
function surveyedStand(stand) {
  return locationPoint(stand?.center) !== null && Array.isArray(stand.polygon) && stand.polygon.length >= 4
    && isFiniteNumber(stand.headingTrue) && Object.hasOwn(STAND_BOX, stand.sizeLetter ?? '') ? stand : null;
}

// The heading of the nearest active stand of the layout within NEIGHBOUR_HEADING_RADIUS_M (ties by code), or null.
function neighbourHeading(layout, center) {
  let best = null;
  for (const stand of layout?.stands ?? []) {
    const point = locationPoint(stand?.center);
    if (stand?.retired === true || point === null || !isFiniteNumber(stand.headingTrue)) continue;
    const distanceM = haversineM(center, point);
    if (distanceM > NEIGHBOUR_HEADING_RADIUS_M) continue;
    const closer = best === null || distanceM < best.distanceM - 1e-9
      || (Math.abs(distanceM - best.distanceM) <= 1e-9 && String(stand.code) < String(best.stand.code));
    if (closer) best = { stand, distanceM };
  }
  return best === null ? null : normalizeBearing(best.stand.headingTrue);
}

// Perpendicular to the taxiway or taxilane nearest to `center`, the nose away from it (the tail to the taxi edge, as
// a remote stand parks), or null when the graph has no taxi edge.
function awayFromTaxiEdge(graph, center) {
  const hit = nearestEdge(graph, center, { kinds: TAXI_KINDS });
  if (hit === null) return null;
  const line = edgeLine(graph, hit.edge);
  const along = initialBearing(line[hit.index], line[Math.min(hit.index + 1, line.length - 1)]);
  const options = [normalizeBearing(along + 90), normalizeBearing(along + 270)];
  if (hit.distanceM < 0.01) return options[0];
  const away = initialBearing(hit.point, center);
  return angleBetween(options[0], away) <= angleBetween(options[1], away) ? options[0] : options[1];
}

// Where the ray from `center` opposite to the heading first meets a taxi edge within LEAD_IN_RANGE_M:
// `{ t (metres from the centre), point }`, or null.
function backRayHit(graph, center, headingTrue) {
  const plane = toLocal(center);
  const back = ((headingTrue + 180) * Math.PI) / 180;
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

// The lead-in of a box of its own, snapped to the taxi graph as the generator snaps the layout's: straight in from the
// taxi edge behind the stand; otherwise from the taxi edge nearest to where the aircraft lines up behind its box, then
// along the axis (or straight from that edge when it lies in front of the stand). Null without a taxi edge.
function derivedLeadIn(graph, center, headingTrue, sizeLetter) {
  const ray = backRayHit(graph, center, headingTrue);
  if (ray !== null) return leadIn(center, headingTrue, ray.point);
  const lineUpM = lineUpDistanceM(sizeLetter);
  const lineUp = destinationPoint(center, normalizeBearing(headingTrue + 180), lineUpM);
  const target = nearestEdge(graph, lineUp, { kinds: TAXI_KINDS })?.point ?? null;
  if (target === null) return null;
  const behind = angleBetween(headingTrue, initialBearing(center, target)) > 90;
  return leadIn(center, headingTrue, target, { minAlignM: behind ? lineUpM : 0 });
}

/**
 * Where a stand is drawn, from the layout's stand (`layoutStand`, `null` when the layout does not know it) and the
 * location OCC saved for it (`dbLocation`, `[lng, lat]` or `{ latitude, longitude }`; `null` when OCC placed nothing):
 * 1. the layout's stand and no saved location: the layout's geometry as it is, centred on the point of the owner's
 *    coordinate document (`reference`, `surveyed`);
 * 2. a saved location up to MAX_TRANSLATION_M from the layout's centre: the layout's polygon and lead-in moved rigidly
 *    so the centre is the saved point, with the same heading and code letter (`occ`, `translated`);
 * 3. a saved location farther away, or a stand the layout does not know: a box of its own at the saved point
 *    (`occ`, `derived`) with the heading of the nearest active stand of the layout within
 *    NEIGHBOUR_HEADING_RADIUS_M, else perpendicular to the nearest taxiway or taxilane with the nose away from it
 *    (north without either); the code letter of `sizeHint`, the stand's largest aircraft (SIZE_FROM_AIRCRAFT, D when
 *    unknown); and a lead-in snapped to the taxi graph (`null` without one);
 * 4. neither: `null`, the stand is not drawn and is listed as «Sin ubicar».
 * `index` (layoutIndex.js: indexLayout) saves building the taxi graph of `layout` on every call. The result is
 * `{ center, headingTrue, sizeLetter, polygon (closed ring), leadIn, locationSource, geometrySource }`.
 */
export function resolveStandGeometry({ layoutStand = null, dbLocation = null, sizeHint = null, layout = null,
  index = null } = {}) {
  const surveyed = surveyedStand(layoutStand);
  const saved = locationPoint(dbLocation);
  if (saved === null) {
    if (surveyed === null) return null;
    return {
      center: surveyed.center,
      headingTrue: surveyed.headingTrue,
      sizeLetter: surveyed.sizeLetter,
      polygon: surveyed.polygon,
      leadIn: Array.isArray(surveyed.leadIn) ? surveyed.leadIn : null,
      locationSource: 'reference',
      geometrySource: 'surveyed',
    };
  }
  if (surveyed !== null && haversineM(surveyed.center, saved) <= MAX_TRANSLATION_M) {
    return {
      center: saved,
      headingTrue: surveyed.headingTrue,
      sizeLetter: surveyed.sizeLetter,
      polygon: translateRigid(surveyed.polygon, surveyed.center, saved),
      leadIn: Array.isArray(surveyed.leadIn) ? translateRigid(surveyed.leadIn, surveyed.center, saved) : null,
      locationSource: 'occ',
      geometrySource: 'translated',
    };
  }
  const graph = index?.graph ?? (layout?.taxiGraph ? buildTaxiGraph(layout.taxiGraph) : null);
  const sizeLetter = Object.hasOwn(SIZE_FROM_AIRCRAFT, sizeHint ?? '') ? SIZE_FROM_AIRCRAFT[sizeHint] : DEFAULT_SIZE_LETTER;
  const headingTrue = neighbourHeading(layout, saved) ?? (graph === null ? null : awayFromTaxiEdge(graph, saved)) ?? 0;
  return {
    center: saved,
    headingTrue,
    sizeLetter,
    polygon: standBox(saved, headingTrue, sizeLetter),
    leadIn: graph === null ? null : derivedLeadIn(graph, saved, headingTrue, sizeLetter),
    locationSource: 'occ',
    geometrySource: 'derived',
  };
}
