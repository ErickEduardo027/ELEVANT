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
