// Spherical geometry for the airport layout of Punta Cana (PR M3). Pure and dependency-free, because the layout
// generator under scripts/maps runs these same functions in plain Node: modules of this folder import each other with
// an explicit '.js' extension and never import JSON, CSS, React or path aliases.
// Coordinates are [longitude, latitude]; distances are metres; bearings are degrees true, clockwise from north.
// Everything that measures areas or shapes works in a local plane around one origin: an azimuthal equidistant
// projection, exact for distances and bearings from its origin and well under a centimetre off for any pair of points
// within a few kilometres, which is the whole airfield.

export const EARTH_RADIUS_M = 6371008.8;
export const METRES_PER_NM = 1852;

const toRadians = degrees => (degrees * Math.PI) / 180;
const toDegrees = radians => (radians * 180) / Math.PI;
const normalizeBearing = degrees => ((degrees % 360) + 360) % 360;

/** Great-circle distance in metres between two `[lng, lat]` points. */
export function haversineM([fromLng, fromLat], [toLng, toLat]) {
  const fromPhi = toRadians(fromLat);
  const toPhi = toRadians(toLat);
  const halfChord = Math.sin(toRadians(toLat - fromLat) / 2) ** 2
    + Math.cos(fromPhi) * Math.cos(toPhi) * Math.sin(toRadians(toLng - fromLng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(halfChord)));
}

/** The initial great-circle bearing from `a` to `b`, in degrees true within [0, 360). */
export function initialBearing([fromLng, fromLat], [toLng, toLat]) {
  const fromPhi = toRadians(fromLat);
  const toPhi = toRadians(toLat);
  const deltaLambda = toRadians(toLng - fromLng);
  const y = Math.sin(deltaLambda) * Math.cos(toPhi);
  const x = Math.cos(fromPhi) * Math.sin(toPhi) - Math.sin(fromPhi) * Math.cos(toPhi) * Math.cos(deltaLambda);
  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

/** The point `distanceM` metres from `origin` along the initial bearing `bearingDeg`. */
export function destinationPoint([lng, lat], bearingDeg, distanceM) {
  const angle = distanceM / EARTH_RADIUS_M;
  const theta = toRadians(bearingDeg);
  const phi = toRadians(lat);
  const sinPhi = Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(theta);
  const lambda = toRadians(lng) + Math.atan2(
    Math.sin(theta) * Math.sin(angle) * Math.cos(phi),
    Math.cos(angle) - Math.sin(phi) * sinPhi,
  );
  return [toDegrees(lambda), toDegrees(Math.asin(Math.max(-1, Math.min(1, sinPhi))))];
}

/**
 * A local plane centred on `origin`: x east and y north in metres. `forward([lng, lat])` → `[x, y]` and
 * `inverse([x, y])` → `[lng, lat]` invert each other.
 */
export function toLocal(origin) {
  return {
    forward(point) {
      const distance = haversineM(origin, point);
      if (distance === 0) return [0, 0];
      const bearing = toRadians(initialBearing(origin, point));
      return [distance * Math.sin(bearing), distance * Math.cos(bearing)];
    },
    inverse([x, y]) {
      const distance = Math.hypot(x, y);
      if (distance === 0) return [origin[0], origin[1]];
      return destinationPoint(origin, toDegrees(Math.atan2(x, y)), distance);
    },
  };
}

function projectOntoSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { t, x, y, distance: Math.hypot(px - x, py - y) };
}

/** The point of segment `a`–`b` nearest to `p`: `{ distanceM, t (0 at a, 1 at b), point: [lng, lat] }`. */
export function pointToSegmentM(p, a, b) {
  const plane = toLocal(p);
  const hit = projectOntoSegment([0, 0], plane.forward(a), plane.forward(b));
  return { distanceM: hit.distance, t: hit.t, point: plane.inverse([hit.x, hit.y]) };
}

/** The point of a polyline nearest to `p`: `{ distanceM, index (segment), t, point }`, or `null` for an empty line. */
export function pointToPolylineM(p, line) {
  if (!Array.isArray(line) || line.length === 0) return null;
  if (line.length === 1) return { distanceM: haversineM(p, line[0]), index: 0, t: 0, point: [...line[0]] };
  let best = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const hit = pointToSegmentM(p, line[index], line[index + 1]);
    if (best === null || hit.distanceM < best.distanceM) best = { ...hit, index };
  }
  return best;
}

const openRing = ring => {
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  }
  return ring;
};

const ringOrigin = ring => {
  const points = openRing(ring);
  const lng = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const lat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [lng, lat];
};

const signedArea = points => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
};

/** The area in square metres of a ring (closed or open). */
export function polygonAreaM2(ring) {
  const points = openRing(ring);
  if (points.length < 3) return 0;
  const plane = toLocal(ringOrigin(points));
  return Math.abs(signedArea(points.map(plane.forward)));
}

/** The area centroid of a ring as `[lng, lat]`; the mean of its points when the ring has no area. */
export function polygonCentroid(ring) {
  const points = openRing(ring);
  const origin = ringOrigin(points);
  if (points.length < 3) return origin;
  const plane = toLocal(origin);
  const local = points.map(plane.forward);
  const area = signedArea(local);
  if (Math.abs(area) < 1e-9) return origin;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < local.length; index += 1) {
    const [x1, y1] = local[index];
    const [x2, y2] = local[(index + 1) % local.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return plane.inverse([cx / (6 * area), cy / (6 * area)]);
}

/** Whether `p` lies inside the ring (even-odd rule; a point on an edge may fall either way). */
export function pointInPolygon([x, y], ring) {
  const points = openRing(ring);
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether segments p–q and r–s of a local plane cross or touch (parallel segments never count). */
function segmentsCross([px, py], [qx, qy], [rx, ry], [sx, sy]) {
  const denominator = (qx - px) * (sy - ry) - (qy - py) * (sx - rx);
  if (Math.abs(denominator) < 1e-12) return false;
  const t = ((rx - px) * (sy - ry) - (ry - py) * (sx - rx)) / denominator;
  const u = ((rx - px) * (qy - py) - (ry - py) * (qx - px)) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Whether a line (`[lng, lat]` points) enters a ring (closed or open): a point of the line inside it, or a segment that
 * crosses or touches its outline (a segment parallel to an edge never crosses that edge).
 */
export function lineEntersPolygon(line, ring) {
  if (line.some(point => pointInPolygon(point, ring))) return true;
  const points = openRing(ring);
  const plane = toLocal(points[0]);
  const outline = points.map(plane.forward);
  const path = line.map(plane.forward);
  for (let at = 0; at < path.length - 1; at += 1) {
    for (let side = 0; side < outline.length; side += 1) {
      if (segmentsCross(path[at], path[at + 1], outline[side], outline[(side + 1) % outline.length])) return true;
    }
  }
  return false;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull of planar points, counter-clockwise, without repeating the first point (monotone chain). */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The smallest-area rectangle around a ring or a line, by rotating calipers over its convex hull:
 * `{ center, lengthM (long side), widthM, axisDeg (bearing of the long side in [0, 180)), corners (closed ring) }`.
 * A straight line gives a rectangle of width 0 along it.
 */
export function minimumBoundingRectangle(ring) {
  const points = openRing(ring);
  const plane = toLocal(ringOrigin(points));
  const local = points.map(plane.forward);
  const hull = convexHull(local);
  const edges = hull.length < 2 ? [] : hull.map((point, index) => [point, hull[(index + 1) % hull.length]]);
  let best = null;
  for (const [a, b] of edges) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best === null || area < best.area - 1e-9) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  if (best === null) {
    const center = ringOrigin(points);
    return { center, lengthM: 0, widthM: 0, axisDeg: 0, corners: [center, center, center, center, center] };
  }
  const { ux, uy, minU, maxU, minV, maxV } = best;
  const toXY = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  // The long side gives the axis: along u when it is the longer span, else along v.
  const axis = spanU >= spanV ? [ux, uy] : [-uy, ux];
  const axisDeg = normalizeBearing(toDegrees(Math.atan2(axis[0], axis[1]))) % 180;
  const cornersXY = [toXY(minU, minV), toXY(maxU, minV), toXY(maxU, maxV), toXY(minU, maxV)];
  const corners = cornersXY.map(plane.inverse);
  return {
    center: plane.inverse(toXY((minU + maxU) / 2, (minV + maxV) / 2)),
    lengthM: Math.max(spanU, spanV),
    widthM: Math.min(spanU, spanV),
    axisDeg,
    corners: [...corners, corners[0]],
  };
}

const counterClockwise = points => (signedArea(points) < 0 ? [...points].reverse() : points);

/**
 * The area in square metres shared by two convex rings, by Sutherland–Hodgman clipping in a local plane. Rings that
 * are not convex give an approximation (the clip ring is treated as convex).
 */
export function convexIntersectionAreaM2(ringA, ringB) {
  const pointsA = openRing(ringA);
  const pointsB = openRing(ringB);
  if (pointsA.length < 3 || pointsB.length < 3) return 0;
  const plane = toLocal(ringOrigin(pointsA));
  let subject = counterClockwise(pointsA.map(plane.forward));
  const clip = counterClockwise(pointsB.map(plane.forward));
  for (let index = 0; index < clip.length && subject.length > 0; index += 1) {
    const edgeStart = clip[index];
    const edgeEnd = clip[(index + 1) % clip.length];
    const inside = point => cross(edgeStart, edgeEnd, point) >= 0;
    const intersect = (from, to) => {
      const fromSide = cross(edgeStart, edgeEnd, from);
      const toSide = cross(edgeStart, edgeEnd, to);
      const t = fromSide / (fromSide - toSide);
      return [from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])];
    };
    const input = subject;
    subject = [];
    for (let at = 0; at < input.length; at += 1) {
      const current = input[at];
      const previous = input[(at + input.length - 1) % input.length];
      if (inside(current)) {
        if (!inside(previous)) subject.push(intersect(previous, current));
        subject.push(current);
      } else if (inside(previous)) {
        subject.push(intersect(previous, current));
      }
    }
  }
  return subject.length < 3 ? 0 : Math.abs(signedArea(subject));
}

/** `[lng, lat]` rounded to `digits` decimals (6 by default, about 0.1 m), without negative zero. */
export function roundCoord(point, digits = 6) {
  const factor = 10 ** digits;
  return point.map(value => {
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Paths (PR M6): great circles, the local east-north frame, polylines measured by distance, and the rounded paths the
// map kinematics draws. Results are frozen. Lengths are metres; the planar functions take `[x, y]` metres east and
// north of an origin (see `toEnu`), the spherical ones `[lng, lat]`.

const freezePoint = point => Object.freeze([point[0], point[1]]);
const freezePoints = points => Object.freeze(points.map(freezePoint));

/**
 * The great circle from `a` to `b` as `[[lng, lat], …]` by spherical interpolation: both ends included and no
 * segment longer than `stepM`. Equal ends give `[a]`.
 */
export function greatCirclePath(a, b, stepM = 10_000) {
  const distance = haversineM(a, b);
  if (distance === 0) return freezePoints([a]);
  const angle = distance / EARTH_RADIUS_M;
  const sinAngle = Math.sin(angle);
  if (sinAngle < 1e-12) return freezePoints([a, b]);
  const toVector = ([lng, lat]) => {
    const phi = toRadians(lat);
    const lambda = toRadians(lng);
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  };
  const from = toVector(a);
  const to = toVector(b);
  const count = Math.max(1, Math.ceil(distance / stepM));
  const points = [a];
  for (let at = 1; at < count; at += 1) {
    const fraction = at / count;
    const weightFrom = Math.sin((1 - fraction) * angle) / sinAngle;
    const weightTo = Math.sin(fraction * angle) / sinAngle;
    const x = weightFrom * from[0] + weightTo * to[0];
    const y = weightFrom * from[1] + weightTo * to[1];
    const z = weightFrom * from[2] + weightTo * to[2];
    points.push([toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))]);
  }
  points.push(b);
  return freezePoints(points);
}

/** `p` in the local plane of `origin` (the azimuthal equidistant plane of `toLocal`): `[x east, y north]` metres. */
export function toEnu(origin, p) {
  return freezePoint(toLocal(origin).forward(p));
}

/** The `[lng, lat]` of `[x east, y north]` metres in the local plane of `origin`; it inverts `toEnu`. */
export function fromEnu(origin, xy) {
  return freezePoint(toLocal(origin).inverse(xy));
}

const isMeasured = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Array.isArray(value.coords) && Array.isArray(value.cumM);

/**
 * A polyline measured for lookups by distance: `{ coords, cumM, lengthM }`, where `cumM[i]` is the distance in
 * metres from the first point to `coords[i]`. A measured polyline is returned as it is.
 */
export function measurePolyline(path) {
  if (isMeasured(path)) return path;
  const coords = freezePoints(Array.isArray(path) ? path : []);
  const cumM = [];
  let total = 0;
  for (let at = 0; at < coords.length; at += 1) {
    if (at > 0) total += haversineM(coords[at - 1], coords[at]);
    cumM.push(total);
  }
  return Object.freeze({ coords, cumM: Object.freeze(cumM), lengthM: total });
}

/** The length in metres of a `[lng, lat]` polyline (or of a measured one). */
export function polylineLengthM(path) {
  return measurePolyline(path).lengthM;
}

/**
 * The point `distM` metres along a polyline (clamped to its ends): `{ p: [lng, lat], bearingDeg, index }`, where
 * `index` is the segment it lies on. At a vertex the bearing is the next segment's; at the last point, the last
 * segment's. A polyline of length 0 gives `bearingDeg: null`; an empty one gives `null`. O(log n) on a measured line.
 */
export function pointAlong(pathOrMeasured, distM) {
  const { coords, cumM, lengthM } = measurePolyline(pathOrMeasured);
  if (coords.length === 0) return null;
  if (coords.length === 1 || lengthM === 0) return Object.freeze({ p: coords[0], bearingDeg: null, index: 0 });
  const target = Math.min(lengthM, Math.max(0, Number.isFinite(distM) ? distM : 0));
  const last = coords.length - 2;
  let low = 0;
  let high = last;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (cumM[middle] <= target) low = middle;
    else high = middle - 1;
  }
  let index = low;
  while (index < last && cumM[index + 1] === cumM[index]) index += 1;
  while (index > 0 && cumM[index + 1] === cumM[index]) index -= 1;
  const from = coords[index];
  const to = coords[index + 1];
  const offset = target - cumM[index];
  const segment = cumM[index + 1] - cumM[index];
  let p = from;
  if (offset >= segment) p = to;
  else if (offset > 0) p = freezePoint(destinationPoint(from, initialBearing(from, to), offset));
  const bearingDeg = p === to ? normalizeBearing(initialBearing(to, from) + 180) : initialBearing(p, to);
  return Object.freeze({ p, bearingDeg, index });
}

/**
 * The point of a polyline nearest to `p`: `{ point, distanceM, alongM, index, t }`, where `alongM` is the distance
 * along the line to that point and `index`, `t` locate it on its segment; `null` for an empty line.
 */
export function nearestOnPolyline(path, p) {
  const { coords, cumM } = measurePolyline(path);
  const hit = pointToPolylineM(p, coords);
  if (hit === null) return null;
  let alongM = 0;
  if (coords.length > 1) {
    if (hit.t <= 0) alongM = cumM[hit.index];
    else if (hit.t >= 1) alongM = cumM[hit.index + 1];
    else alongM = cumM[hit.index] + haversineM(coords[hit.index], hit.point);
  }
  return Object.freeze({ point: freezePoint(hit.point), distanceM: hit.distanceM, alongM, index: hit.index, t: hit.t });
}

/** The bearing in degrees true within [0, 360) of a planar direction `[dx east, dy north]`; `null` for `[0, 0]`. */
export function enuBearingDeg([dx, dy]) {
  if (dx === 0 && dy === 0) return null;
  const bearing = normalizeBearing(toDegrees(Math.atan2(dx, dy)));
  return bearing === 0 ? 0 : bearing;
}

// Planar helpers for the rounded paths. A turn is signed in the plane: positive to the left (counter-clockwise).

const COLLINEAR_RAD = toRadians(0.5);
const CUSP_RAD = toRadians(175);
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];
const norm = vector => Math.hypot(vector[0], vector[1]);
const unitOf = vector => {
  const length = norm(vector);
  return length === 0 ? [0, 0] : [vector[0] / length, vector[1] / length];
};

function turnAt(a, b, c) {
  const u = minus(b, a);
  const v = minus(c, b);
  return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
}

/** Copies the line without repeated points and without the vertices that turn less than 0.5°. */
function cleanLine(coordsEnu) {
  const distinct = [];
  for (const point of Array.isArray(coordsEnu) ? coordsEnu : []) {
    const previous = distinct[distinct.length - 1];
    if (previous === undefined || norm(minus(point, previous)) > 1e-6) distinct.push([point[0], point[1]]);
  }
  if (distinct.length < 3) return distinct;
  const kept = [distinct[0]];
  for (let at = 1; at < distinct.length - 1; at += 1) {
    if (Math.abs(turnAt(kept[kept.length - 1], distinct[at], distinct[at + 1])) >= COLLINEAR_RAD) kept.push(distinct[at]);
  }
  kept.push(distinct[distinct.length - 1]);
  return kept;
}

/**
 * The corners of a cleaned line rounded at `radiusM`: per vertex its signed turn, the tangent length it gets and its
 * effective radius (0 for a cusp, Infinity for none). A corner wants `R·tan(θ/2)` on each side; on a segment shared
 * with another corner it gets half of it, or more when the other corner needs less, and the whole of an end segment.
 */
function cornerPlan(points, radiusM) {
  const count = points.length;
  const lengths = [];
  for (let at = 0; at < count - 1; at += 1) lengths.push(norm(minus(points[at + 1], points[at])));
  const turns = new Array(count).fill(0);
  const wanted = new Array(count).fill(0);
  for (let at = 1; at < count - 1; at += 1) {
    turns[at] = turnAt(points[at - 1], points[at], points[at + 1]);
    const size = Math.abs(turns[at]);
    wanted[at] = size > CUSP_RAD ? 0 : radiusM * Math.tan(size / 2);
  }
  const room = (corner, segment) => {
    const other = segment === corner ? corner + 1 : corner - 1;
    if (other === 0 || other === count - 1) return lengths[segment];
    return Math.max(lengths[segment] / 2, lengths[segment] - wanted[other]);
  };
  const tangents = new Array(count).fill(0);
  const radii = new Array(count).fill(Infinity);
  for (let at = 1; at < count - 1; at += 1) {
    const size = Math.abs(turns[at]);
    if (size > CUSP_RAD) {
      radii[at] = 0;
    } else if (wanted[at] > 0) {
      tangents[at] = Math.min(wanted[at], room(at, at - 1), room(at, at));
      radii[at] = tangents[at] / Math.tan(size / 2);
    }
  }
  return { turns, tangents, radii };
}

/**
 * A planar line rounded at its corners with arcs of `radiusM`: `{ coords: [[x, y], …], tangentsDeg, radiiM }`, the
 * arcs drawn every `arcStepM` metres, `tangentsDeg[i]` the exact bearing of the path at `coords[i]` and `radiiM` the
 * radius of each rounded corner in order. Each interior corner of turn θ gets a tangent of `min(R·tan(θ/2), its
 * room)`: half of each segment it shares with another corner, or more when that corner needs less, and the whole of
 * an end segment; the radius shrinks to what fits. Vertices that turn less than 0.5° are dropped, and cusps (more
 * than 175°) stay as vertices: a reversal (a pushback) is a separate path.
 */
export function filletPath(coordsEnu, radiusM, { arcStepM = 2 } = {}) {
  const points = cleanLine(coordsEnu);
  const coords = [];
  const tangentsDeg = [];
  const radiiM = [];
  const push = (point, bearing) => {
    const previous = coords[coords.length - 1];
    if (previous !== undefined && norm(minus(point, previous)) <= 1e-9) {
      tangentsDeg[tangentsDeg.length - 1] = bearing;
      return;
    }
    coords.push(point);
    tangentsDeg.push(bearing);
  };
  if (points.length === 1) push(points[0], null);
  if (points.length >= 2) {
    const plan = cornerPlan(points, radiusM);
    push(points[0], enuBearingDeg(minus(points[1], points[0])));
    for (let at = 1; at < points.length - 1; at += 1) {
      const incoming = unitOf(minus(points[at], points[at - 1]));
      const outgoing = unitOf(minus(points[at + 1], points[at]));
      const tangent = plan.tangents[at];
      if (!(tangent > 1e-9)) {
        if (plan.radii[at] === 0) radiiM.push(0);
        push(points[at], enuBearingDeg(outgoing));
        continue;
      }
      const size = Math.abs(plan.turns[at]);
      const side = Math.sign(plan.turns[at]);
      const radius = tangent / Math.tan(size / 2);
      const start = [points[at][0] - incoming[0] * tangent, points[at][1] - incoming[1] * tangent];
      const end = [points[at][0] + outgoing[0] * tangent, points[at][1] + outgoing[1] * tangent];
      const centre = [start[0] - incoming[1] * side * radius, start[1] + incoming[0] * side * radius];
      const startAngle = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
      const startBearing = enuBearingDeg(incoming);
      const steps = Math.max(1, Math.ceil((radius * size) / arcStepM));
      for (let step = 0; step <= steps; step += 1) {
        const angle = startAngle + (side * size * step) / steps;
        const point = step === 0 ? start
          : step === steps ? end : [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
        push(point, normalizeBearing(startBearing - (side * toDegrees(size) * step) / steps));
      }
      radiiM.push(radius);
    }
    push(points[points.length - 1], enuBearingDeg(minus(points[points.length - 1], points[points.length - 2])));
  }
  return Object.freeze({
    coords: freezePoints(coords),
    tangentsDeg: Object.freeze(tangentsDeg),
    radiiM: Object.freeze(radiiM),
  });
}

/** The planar line rounded at `radiusM` as `[[x, y], …]` (see `filletPath`, which also gives the exact bearings). */
export function filletPolyline(coordsEnu, radiusM, options = {}) {
  return filletPath(coordsEnu, radiusM, options).coords;
}

const planarCumulative = coords => {
  const cumulative = [0];
  for (let at = 1; at < coords.length; at += 1) {
    cumulative.push(cumulative[at - 1] + norm(minus(coords[at], coords[at - 1])));
  }
  return cumulative;
};

/** The distances at which a line of length `lengthM` is sampled every `stepM`: 0, step, 2·step, … and the end. */
function sampleDistances(lengthM, stepM) {
  const distances = [];
  const count = stepM > 0 ? Math.floor(lengthM / stepM + 1e-9) : 0;
  for (let at = 0; at <= count; at += 1) distances.push(Math.min(lengthM, at * stepM));
  if (lengthM - distances[distances.length - 1] > 1e-6) distances.push(lengthM);
  return distances;
}

/** A planar line resampled every `stepM` metres along it, the first and the last point included. */
export function resampleEnu(coordsEnu, stepM) {
  const coords = Array.isArray(coordsEnu) ? coordsEnu : [];
  if (coords.length < 2) return freezePoints(coords);
  const cumulative = planarCumulative(coords);
  const samples = [];
  let at = 0;
  for (const distance of sampleDistances(cumulative[cumulative.length - 1], stepM)) {
    while (at < coords.length - 2 && cumulative[at + 1] <= distance) at += 1;
    const segment = cumulative[at + 1] - cumulative[at];
    const fraction = segment > 0 ? Math.min(1, Math.max(0, (distance - cumulative[at]) / segment)) : 0;
    samples.push([
      coords[at][0] + fraction * (coords[at + 1][0] - coords[at][0]),
      coords[at][1] + fraction * (coords[at + 1][1] - coords[at][1]),
    ]);
  }
  return freezePoints(samples);
}

/**
 * A `filletPath` result resampled every `stepM` metres: `{ coords, tangentsDeg, alongM }`, the bearings interpolated
 * along each arc (exact on a circle) and held on straight parts; a cusp keeps the bearing of the segment it ends.
 */
export function resampleFilletPath({ coords, tangentsDeg }, stepM) {
  if (coords.length < 2) {
    return Object.freeze({
      coords: freezePoints(coords), tangentsDeg: Object.freeze([...tangentsDeg]), alongM: Object.freeze(coords.map(() => 0)),
    });
  }
  const cumulative = planarCumulative(coords);
  const samples = [];
  const bearings = [];
  const distances = sampleDistances(cumulative[cumulative.length - 1], stepM);
  let at = 0;
  for (const distance of distances) {
    while (at < coords.length - 2 && cumulative[at + 1] <= distance) at += 1;
    const segment = cumulative[at + 1] - cumulative[at];
    const fraction = segment > 0 ? Math.min(1, Math.max(0, (distance - cumulative[at]) / segment)) : 0;
    samples.push([
      coords[at][0] + fraction * (coords[at + 1][0] - coords[at][0]),
      coords[at][1] + fraction * (coords[at + 1][1] - coords[at][1]),
    ]);
    const from = tangentsDeg[at];
    const to = tangentsDeg[at + 1];
    const change = ((to - from + 540) % 360) - 180;
    if (fraction >= 1) bearings.push(to);
    else if (Math.abs(change) > 90) bearings.push(enuBearingDeg(minus(coords[at + 1], coords[at])) ?? from);
    else bearings.push(normalizeBearing(from + fraction * change));
  }
  return Object.freeze({
    coords: freezePoints(samples),
    tangentsDeg: Object.freeze(bearings),
    alongM: Object.freeze(distances),
  });
}

function segmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0
    : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function intersectLines(a1, a2, b1, b2) {
  const d1 = minus(a2, a1);
  const d2 = minus(b2, b1);
  const denominator = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denominator) < 1e-12) return null;
  const offset = minus(b1, a1);
  const t = (offset[0] * d2[1] - offset[1] * d2[0]) / denominator;
  const u = (offset[0] * d1[1] - offset[1] * d1[0]) / denominator;
  return { point: [a1[0] + t * d1[0], a1[1] + t * d1[1]], t, u };
}

/**
 * Eases the corners of a planar line that a fillet of `radiusM` could round only below `minRadiusM`, before
 * `filletPath` rounds it: the tightest corner first, it merges two corners that turn the same way into one at the
 * crossing of their outer legs, or drops the vertex that blocks it (a hairpin, a sideways jog, a corner too close),
 * keeping whichever edit widens the tightest radius within `windowM` of it the most. An edit is kept only while every
 * new segment stays within `maxShiftM` of the original line; the first and the last segment keep their direction. A
 * corner that no edit widens stays as it is (its fillet then shrinks to fit). Returns `[[x, y], …]`.
 */
export function easePolyline(coordsEnu, { radiusM = 30, minRadiusM = 20, maxShiftM = 15, windowM = 200 } = {}) {
  const original = cleanLine(coordsEnu);
  if (original.length < 4) return freezePoints(original);
  const boxes = [];
  for (let at = 0; at < original.length - 1; at += 1) {
    const [a, b] = [original[at], original[at + 1]];
    boxes.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  }
  const nearOriginal = point => {
    for (let at = 0; at < boxes.length; at += 1) {
      const box = boxes[at];
      if (point[0] < box[0] - maxShiftM || point[0] > box[2] + maxShiftM
        || point[1] < box[1] - maxShiftM || point[1] > box[3] + maxShiftM) continue;
      if (segmentDistance(point, original[at], original[at + 1]) <= maxShiftM) return true;
    }
    return false;
  };
  const segmentNearOriginal = (a, b) => {
    const length = norm(minus(b, a));
    const steps = Math.max(1, Math.ceil(length));
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      if (!nearOriginal([a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])])) return false;
    }
    return true;
  };
  let points = original.map(point => [...point]);
  // Corners no edit could widen; an edit that leaves them as they were is judged on the other corners.
  const stuck = new Map();
  const key = point => `${point[0]},${point[1]}`;
  const localMinimum = (candidate, radii, centre) => {
    let minimum = Infinity;
    for (let at = 1; at < candidate.length - 1; at += 1) {
      if (norm(minus(candidate[at], centre)) > windowM) continue;
      const kept = stuck.get(key(candidate[at]));
      if (kept !== undefined && Math.abs(kept - radii[at]) <= 1e-9) continue;
      minimum = Math.min(minimum, radii[at]);
    }
    return minimum;
  };
  for (let pass = 0; pass < original.length * 2; pass += 1) {
    const count = points.length;
    if (count < 4) break;
    const plan = cornerPlan(points, radiusM);
    let worst = -1;
    for (let at = 1; at < count - 1; at += 1) {
      if (plan.radii[at] >= minRadiusM || stuck.has(key(points[at]))) continue;
      if (worst === -1 || plan.radii[at] < plan.radii[worst]) worst = at;
    }
    if (worst === -1) break;
    const removable = at => at >= 2 && at <= count - 3;
    const edits = [];
    const remove = at => {
      if (!removable(at)) return;
      edits.push({ next: [...points.slice(0, at), ...points.slice(at + 1)], segments: [[points[at - 1], points[at + 1]]] });
    };
    // Corners a..b (consecutive, turning the same way, less than 175° in all) become one corner where the leg before
    // a and the leg after b cross.
    const merge = (a, b) => {
      if (a < 1 || b > count - 2 || b <= a) return;
      let total = 0;
      for (let at = a; at <= b; at += 1) {
        if (Math.sign(plan.turns[at]) !== Math.sign(plan.turns[a])) return;
        total += plan.turns[at];
      }
      if (Math.abs(total) >= CUSP_RAD) return;
      const crossing = intersectLines(points[a - 1], points[a], points[b], points[b + 1]);
      if (crossing === null || !(crossing.t > 0) || !(crossing.u < 1)) return;
      edits.push({
        next: [...points.slice(0, a), crossing.point, ...points.slice(b + 1)],
        segments: [[points[a - 1], crossing.point], [crossing.point, points[b + 1]]],
      });
    };
    remove(worst);
    for (const side of [-1, 1]) {
      const neighbour = worst + side;
      if (neighbour < 1 || neighbour > count - 2) continue;
      merge(Math.min(worst, neighbour), Math.max(worst, neighbour));
      remove(neighbour);
      // Runs of corners beside the tightest one, without it: a bend drawn with many vertices becomes one corner,
      // which leaves the tightest corner the whole leg between them.
      for (let beyond = neighbour + side; beyond >= 1 && beyond <= count - 2; beyond += side) {
        if (Math.sign(plan.turns[beyond]) !== Math.sign(plan.turns[neighbour])) break;
        merge(Math.min(neighbour, beyond), Math.max(neighbour, beyond));
      }
    }
    const centre = points[worst];
    const before = plan.radii[worst];
    let best = null;
    for (const edit of edits) {
      if (!edit.segments.every(([a, b]) => segmentNearOriginal(a, b))) continue;
      const after = localMinimum(edit.next, cornerPlan(edit.next, radiusM).radii, centre);
      if (after > before + 1e-6 && (best === null || after > best.after + 1e-9)) best = { next: edit.next, after };
    }
    if (best === null) stuck.set(key(points[worst]), before);
    else points = best.next;
  }
  return freezePoints(points);
}

/**
 * The part of a polyline between two distances along it, clamped to its ends (PR M6), as `[[lng, lat], …]`, frozen:
 * the point at `fromM`, the vertices strictly between, and the point at `toM`. Equal distances give that point twice.
 */
export function slicePolyline(pathOrMeasured, fromM, toM) {
  const measured = measurePolyline(pathOrMeasured);
  if (measured.coords.length === 0) return freezePoints([]);
  const from = Math.max(0, Math.min(measured.lengthM, Number.isFinite(fromM) ? fromM : 0));
  const to = Math.max(from, Math.min(measured.lengthM, Number.isFinite(toM) ? toM : measured.lengthM));
  const points = [pointAlong(measured, from).p];
  measured.coords.forEach((point, at) => {
    if (measured.cumM[at] > from + 1e-6 && measured.cumM[at] < to - 1e-6) points.push(point);
  });
  points.push(pointAlong(measured, to).p);
  return freezePoints(points);
}
