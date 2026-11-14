import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_M,
  METRES_PER_NM,
  convexIntersectionAreaM2,
  destinationPoint,
  easePolyline,
  enuBearingDeg,
  filletPath,
  filletPolyline,
  fromEnu,
  greatCirclePath,
  haversineM,
  initialBearing,
  lineEntersPolygon,
  measurePolyline,
  minimumBoundingRectangle,
  nearestOnPolyline,
  pointAlong,
  pointInPolygon,
  pointToPolylineM,
  pointToSegmentM,
  polygonAreaM2,
  polygonCentroid,
  polylineLengthM,
  resampleEnu,
  resampleFilletPath,
  roundCoord,
  slicePolyline,
  toEnu,
  toLocal,
} from './geo.js';

const ARP = [-68.3634, 18.5674];

/** A rectangle of `widthM` × `lengthM` centred on `center`, its long side along `axisDeg`. */
function box(center, axisDeg, widthM, lengthM) {
  const plane = toLocal(center);
  const radians = (axisDeg * Math.PI) / 180;
  const along = [Math.sin(radians), Math.cos(radians)];
  const across = [Math.cos(radians), -Math.sin(radians)];
  const corner = (u, v) => plane.inverse([
    along[0] * u + across[0] * v,
    along[1] * u + across[1] * v,
  ]);
  const ring = [
    corner(-lengthM / 2, -widthM / 2), corner(lengthM / 2, -widthM / 2),
    corner(lengthM / 2, widthM / 2), corner(-lengthM / 2, widthM / 2),
  ];
  return [...ring, ring[0]];
}

describe('distances and bearings', () => {
  it('destinationPoint and initialBearing round-trip; haversine matches 1 NM = 1852 m within 0.1 %', () => {
    for (const bearing of [0, 37, 90, 163, 255, 359]) {
      for (const distance of [12, 850, 4000]) {
        const target = destinationPoint(ARP, bearing, distance);
        expect(haversineM(ARP, target)).toBeCloseTo(distance, 6);
        expect(Math.abs(((initialBearing(ARP, target) - bearing + 540) % 360) - 180)).toBeLessThan(1e-6);
      }
    }
    // One minute of latitude is one nautical mile.
    const oneMinuteNorth = [ARP[0], ARP[1] + 1 / 60];
    expect(Math.abs(haversineM(ARP, oneMinuteNorth) - METRES_PER_NM) / METRES_PER_NM).toBeLessThan(0.001);
    expect(EARTH_RADIUS_M).toBeCloseTo(6371008.8, 1);
    expect(initialBearing(ARP, [ARP[0] + 0.01, ARP[1]])).toBeCloseTo(90, 1);
    expect(initialBearing(ARP, [ARP[0], ARP[1] - 0.01])).toBeCloseTo(180, 6);
  });

  it('the local projection errs under 1 m within 5 km of the ARP', () => {
    const plane = toLocal(ARP);
    const samples = [];
    for (let bearing = 0; bearing < 360; bearing += 30) {
      for (const distance of [0, 400, 2500, 5000]) samples.push(destinationPoint(ARP, bearing, distance));
    }
    for (const point of samples) {
      const back = plane.inverse(plane.forward(point));
      expect(haversineM(point, back)).toBeLessThan(0.001);
    }
    // Planar distances between any two samples agree with the sphere.
    for (const a of samples) {
      for (const b of samples) {
        const [ax, ay] = plane.forward(a);
        const [bx, by] = plane.forward(b);
        expect(Math.abs(Math.hypot(bx - ax, by - ay) - haversineM(a, b))).toBeLessThan(1);
      }
    }
  });

  it('measures the distance to a segment and to a polyline', () => {
    const a = destinationPoint(ARP, 270, 100);
    const b = destinationPoint(ARP, 90, 100);
    const north = destinationPoint(ARP, 0, 30);
    const hit = pointToSegmentM(north, a, b);
    expect(hit.distanceM).toBeCloseTo(30, 1);
    expect(hit.t).toBeCloseTo(0.5, 3);
    expect(haversineM(hit.point, ARP)).toBeLessThan(0.05);
    // Beyond an end the nearest point is the end.
    const east = destinationPoint(ARP, 90, 150);
    expect(pointToSegmentM(east, a, b).t).toBe(1);
    expect(pointToSegmentM(east, a, b).distanceM).toBeCloseTo(50, 1);
    const line = [a, ARP, destinationPoint(ARP, 0, 200)];
    const onLine = pointToPolylineM(destinationPoint(destinationPoint(ARP, 0, 50), 90, 20), line);
    expect(onLine.index).toBe(1);
    expect(onLine.distanceM).toBeCloseTo(20, 1);
    expect(pointToPolylineM(ARP, [])).toBeNull();
  });
});

describe('polygons', () => {
  it('measures area, centroid and containment of a box', () => {
    const ring = box(ARP, 30, 40, 60);
    expect(polygonAreaM2(ring)).toBeCloseTo(2400, 0);
    expect(haversineM(polygonCentroid(ring), ARP)).toBeLessThan(0.01);
    expect(pointInPolygon(ARP, ring)).toBe(true);
    expect(pointInPolygon(destinationPoint(ARP, 120, 25), ring)).toBe(false);
  });

  it('the minimum bounding rectangle of a rotated 40×60 m box has that size and axis', () => {
    const ring = box(ARP, 30, 40, 60);
    const rectangle = minimumBoundingRectangle(ring);
    expect(rectangle.lengthM).toBeCloseTo(60, 2);
    expect(rectangle.widthM).toBeCloseTo(40, 2);
    expect(rectangle.axisDeg).toBeCloseTo(30, 3);
    expect(haversineM(rectangle.center, ARP)).toBeLessThan(0.01);
    expect(rectangle.corners).toHaveLength(5);
    expect(rectangle.corners[4]).toEqual(rectangle.corners[0]);
    // An axis past 180° reads as its opposite direction.
    expect(minimumBoundingRectangle(box(ARP, 200, 10, 50)).axisDeg).toBeCloseTo(20, 3);
    // A straight open line (OSM stand marks) has no width and its own bearing.
    const mark = [destinationPoint(ARP, 175, 20), ARP, destinationPoint(ARP, 355, 20)];
    const lineRectangle = minimumBoundingRectangle(mark);
    expect(lineRectangle.lengthM).toBeCloseTo(40, 2);
    expect(lineRectangle.widthM).toBeCloseTo(0, 3);
    expect(lineRectangle.axisDeg).toBeCloseTo(175, 3);
  });

  it('a line enters a box through it, by ending inside or by clipping a corner, never by passing beside it', () => {
    const plane = toLocal(ARP);
    const at = (x, y) => plane.inverse([x, y]);
    // 20 m wide (x from −10 to 10) and 40 m long (y from −20 to 20).
    const ring = box(ARP, 0, 20, 40);
    expect(lineEntersPolygon([at(-30, 0), at(30, 0)], ring)).toBe(true);
    expect(lineEntersPolygon([at(0, 60), at(0, 5)], ring)).toBe(true);
    // Both ends outside: in through the top edge, out through the right one.
    expect(lineEntersPolygon([at(-3, 30), at(27, 0)], ring)).toBe(true);
    expect(lineEntersPolygon([at(-30, 30), at(0, 35), at(30, 30)], ring)).toBe(false);
    expect(lineEntersPolygon([at(15, -40), at(15, 40)], ring)).toBe(false);
    // An open ring has the same outline.
    expect(lineEntersPolygon([at(-3, 30), at(27, 0)], ring.slice(0, 4))).toBe(true);
  });

  it('convex intersection area of two half-overlapping squares is half of one', () => {
    const square = box(ARP, 0, 50, 50);
    const shifted = box(destinationPoint(ARP, 90, 25), 0, 50, 50);
    expect(convexIntersectionAreaM2(square, shifted)).toBeCloseTo(1250, 0);
    expect(convexIntersectionAreaM2(square, square)).toBeCloseTo(2500, 0);
    expect(convexIntersectionAreaM2(square, box(destinationPoint(ARP, 90, 80), 0, 50, 50))).toBe(0);
    // Orientation does not matter.
    expect(convexIntersectionAreaM2([...square].reverse(), shifted)).toBeCloseTo(1250, 0);
  });

  it('rounds coordinates to 6 decimals without negative zero', () => {
    expect(roundCoord([-68.36340049, 18.56740051])).toEqual([-68.3634, 18.567401]);
    expect(Object.is(roundCoord([-0.0000001, 0])[0], 0)).toBe(true);
    expect(roundCoord([1.23456, 2], 2)).toEqual([1.23, 2]);
  });
});

// PR M6: paths for the map kinematics.
const MIA = [-80.287, 25.7959];
const PUJ = ARP;
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const planarDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Distance from a planar point to a planar polyline. */
function toPlanarLine(point, line) {
  let best = Infinity;
  for (let at = 0; at < line.length - 1; at += 1) {
    const [a, b] = [line[at], line[at + 1]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
  }
  return best;
}

describe('great circles and the local east-north frame', () => {
  it('a great circle from MIA to PUJ has a point every 10 km or less and its length equals the haversine distance within 0.01 percent', () => {
    const path = greatCirclePath(MIA, PUJ);
    expect(path[0]).toEqual(MIA);
    expect(path[path.length - 1]).toEqual(PUJ);
    for (let at = 1; at < path.length; at += 1) expect(haversineM(path[at - 1], path[at])).toBeLessThanOrEqual(10_000);
    const direct = haversineM(MIA, PUJ);
    expect(direct).toBeGreaterThan(1_400_000);
    expect(Math.abs(polylineLengthM(path) - direct) / direct).toBeLessThan(0.0001);
    // Every point lies on the great circle: the bearing from MIA to it is the initial bearing to PUJ.
    for (const point of path.slice(1, -1)) expect(angleBetween(initialBearing(MIA, point), initialBearing(MIA, PUJ))).toBeLessThan(1e-6);
    // A shorter step gives more points; equal ends give the point itself. Results are frozen.
    expect(greatCirclePath(MIA, PUJ, 2_000).length).toBeGreaterThan(path.length * 4);
    expect(greatCirclePath(PUJ, PUJ)).toEqual([PUJ]);
    expect(Object.isFrozen(path)).toBe(true);
    expect(Object.isFrozen(path[3])).toBe(true);
  });

  it('toEnu and fromEnu round-trip under 1 cm within 50 km of the ARP', () => {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      for (const distance of [0, 3, 950, 12_000, 50_000]) {
        const point = destinationPoint(ARP, bearing, distance);
        const [x, y] = toEnu(ARP, point);
        expect(Math.hypot(x, y)).toBeCloseTo(distance, 6);
        expect(haversineM(fromEnu(ARP, [x, y]), point)).toBeLessThan(0.01);
      }
    }
    expect(toEnu(ARP, ARP)).toEqual([0, 0]);
    expect(fromEnu(ARP, [0, 0])).toEqual(ARP);
    expect(enuBearingDeg([0, 5])).toBe(0);
    expect(enuBearingDeg([3, 0])).toBe(90);
    expect(enuBearingDeg([-2, -2])).toBeCloseTo(225, 9);
    expect(enuBearingDeg([0, 0])).toBeNull();
  });
});

describe('measured polylines', () => {
  const east = destinationPoint(ARP, 90, 100);
  const corner = destinationPoint(east, 0, 50);
  const bend = [ARP, east, corner];

  it('pointAlong clamps to the ends and gives the bearing of its segment', () => {
    const measured = measurePolyline(bend);
    expect(measured.lengthM).toBeCloseTo(150, 6);
    expect(measured.cumM.map(value => Math.round(value))).toEqual([0, 100, 150]);
    expect(Object.isFrozen(measured.cumM)).toBe(true);
    expect(measurePolyline(measured)).toBe(measured);

    const before = pointAlong(measured, -20);
    expect(before.p).toEqual(ARP);
    expect(before.index).toBe(0);
    expect(before.bearingDeg).toBeCloseTo(90, 2);
    const middle = pointAlong(bend, 40);
    expect(haversineM(middle.p, destinationPoint(ARP, 90, 40))).toBeLessThan(0.001);
    expect(middle.bearingDeg).toBeCloseTo(90, 2);
    // At the vertex the next segment's bearing wins; past the end the point is the end on the last bearing.
    const atVertex = pointAlong(measured, measured.cumM[1]);
    expect(atVertex.p).toEqual(east);
    expect(atVertex.index).toBe(1);
    expect(atVertex.bearingDeg).toBeCloseTo(0, 6);
    const after = pointAlong(measured, 1_000);
    expect(after.p).toEqual(corner);
    expect(after.index).toBe(1);
    expect(after.bearingDeg).toBeCloseTo(0, 6);
    // A path of length 0 has no bearing; an empty one has no point.
    expect(pointAlong([ARP], 10)).toEqual({ p: ARP, bearingDeg: null, index: 0 });
    expect(pointAlong([ARP, ARP], 10).bearingDeg).toBeNull();
    expect(pointAlong([], 10)).toBeNull();
    // A repeated vertex does not stop the walk.
    expect(pointAlong([ARP, east, east, corner], 100).bearingDeg).toBeCloseTo(0, 6);
  });

  it('nearestOnPolyline gives the distance along the line', () => {
    const beside = destinationPoint(destinationPoint(east, 0, 20), 90, 7);
    const hit = nearestOnPolyline(bend, beside);
    expect(hit.index).toBe(1);
    expect(hit.distanceM).toBeCloseTo(7, 2);
    expect(hit.alongM).toBeCloseTo(120, 2);
    expect(hit.t).toBeCloseTo(0.4, 3);
    expect(haversineM(hit.point, destinationPoint(east, 0, 20))).toBeLessThan(0.05);
    // Before the start the nearest point is the start.
    expect(nearestOnPolyline(bend, destinationPoint(ARP, 270, 30)).alongM).toBe(0);
    expect(nearestOnPolyline([ARP], east)).toMatchObject({ alongM: 0, index: 0 });
    expect(nearestOnPolyline([], east)).toBeNull();
  });

  it('slicePolyline cuts a line between two distances, keeping the vertices between them', () => {
    const measured = measurePolyline(bend);
    // From 40 m along the first segment to 20 m along the second: the cut points and the corner between them.
    const slice = slicePolyline(measured, 40, 120);
    expect(slice).toHaveLength(3);
    expect(haversineM(slice[0], destinationPoint(ARP, 90, 40))).toBeLessThan(0.001);
    expect(slice[1]).toEqual(east);
    expect(haversineM(slice[2], destinationPoint(east, 0, 20))).toBeLessThan(0.001);
    expect(measurePolyline(slice).lengthM).toBeCloseTo(80, 6);
    // Clamped to the ends; equal distances give the point twice; an empty line gives nothing.
    expect(slicePolyline(bend, -50, 1_000)).toEqual([ARP, east, corner]);
    expect(measurePolyline(slicePolyline(bend, 60, 60)).lengthM).toBe(0);
    expect(slicePolyline(bend, 60, 60)).toHaveLength(2);
    expect(slicePolyline([], 0, 10)).toEqual([]);
    expect(Object.isFrozen(slice) && Object.isFrozen(slice[0])).toBe(true);
  });
});

describe('rounded planar paths', () => {
  const R = 30;

  it('a 90° corner filleted at 30 m is tangent at both ends and stays within R(√2−1) of the corner', () => {
    const corner = [0, 100];
    const line = [[0, 0], corner, [100, 100]];
    const path = filletPath(line, R);
    expect(path.radiiM).toHaveLength(1);
    expect(path.radiiM[0]).toBeCloseTo(R, 9);
    // The arc starts and ends R·tan(45°) = 30 m from the corner, on each leg.
    const start = path.coords.findIndex(point => planarDistance(point, [0, 70]) < 1e-9);
    const end = path.coords.findIndex(point => planarDistance(point, [30, 100]) < 1e-9);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const arc = path.coords.slice(start, end + 1);
    for (const point of arc) expect(planarDistance(point, [30, 70])).toBeCloseTo(R, 6);
    // Tangent at both ends: the exact bearing is the incoming leg's at the start and the outgoing leg's at the end,
    // and the first and last chords of the arc leave the legs by less than one arc step.
    expect(path.tangentsDeg[start]).toBeCloseTo(0, 9);
    expect(path.tangentsDeg[end]).toBeCloseTo(90, 9);
    const step = toDegrees2(2 / R);
    expect(angleBetween(enuBearingDeg([arc[1][0] - arc[0][0], arc[1][1] - arc[0][1]]), 0)).toBeLessThan(step);
    const lastChord = [arc[arc.length - 1][0] - arc[arc.length - 2][0], arc[arc.length - 1][1] - arc[arc.length - 2][1]];
    expect(angleBetween(enuBearingDeg(lastChord), 90)).toBeLessThan(step);
    // It never strays more than R(√2−1) from the corner's legs and passes exactly that far from the corner.
    const bound = R * (Math.SQRT2 - 1);
    for (const point of path.coords) expect(toPlanarLine(point, line)).toBeLessThanOrEqual(bound);
    const closest = Math.min(...path.coords.map(point => planarDistance(point, corner)));
    expect(closest).toBeCloseTo(bound, 1);
    expect(filletPolyline(line, R)).toEqual(path.coords);
    expect(Object.isFrozen(path.coords)).toBe(true);
  });

  it('a fillet shrinks to fit short segments and leaves straight lines and cusps alone', () => {
    // Two 90° corners 8 m apart (a jog): each gets half of the shared segment, so both radii shrink to 4 m.
    const jog = filletPath([[0, -60], [0, 0], [8, 0], [8, 60]], R);
    expect(jog.radiiM.map(radius => Number(radius.toFixed(6)))).toEqual([4, 4]);
    // A short corner next to a gentle one takes what the gentle one leaves: more than half of the shared segment.
    const shared = filletPath([[0, -60], [0, 0], [10, 0], [60, 3]], R);
    expect(shared.radiiM[0]).toBeGreaterThan(5);
    // An end segment is wholly available: a 90° corner with 10 m legs becomes one 10 m arc.
    expect(filletPath([[0, 0], [0, 10], [10, 10]], R).radiiM[0]).toBeCloseTo(10, 9);
    // A straight line (a vertex turning less than 0.5°) is left straight; repeated points are dropped.
    expect(filletPolyline([[0, 0], [50, 0.2], [50, 0.2], [100, 0]], R)).toEqual([[0, 0], [100, 0]]);
    // A cusp (a reversal) stays a vertex, with the next segment's bearing.
    const cusp = filletPath([[0, 0], [50, 0], [0, 0.5]], R);
    expect(cusp.coords).toEqual([[0, 0], [50, 0], [0, 0.5]]);
    expect(cusp.radiiM).toEqual([0]);
    expect(cusp.tangentsDeg[1]).toBeGreaterThan(269);
  });

  it('resampling keeps the length and the spacing', () => {
    const straight = resampleEnu([[0, 0], [23, 0]], 5);
    expect(straight).toEqual([[0, 0], [5, 0], [10, 0], [15, 0], [20, 0], [23, 0]]);
    const rounded = filletPath([[0, 0], [0, 100], [100, 100]], R);
    const roundedLength = rounded.coords.slice(1).reduce((sum, point, at) => sum + planarDistance(rounded.coords[at], point), 0);
    const samples = resampleFilletPath(rounded, 5);
    expect(samples.coords[0]).toEqual([0, 0]);
    expect(samples.coords[samples.coords.length - 1]).toEqual([100, 100]);
    expect(samples.alongM[samples.alongM.length - 1]).toBeCloseTo(roundedLength, 9);
    // Every step is 5 m along the path (the last one shorter); the chords lose under 0.2 % on the 30 m arc.
    for (let at = 1; at < samples.alongM.length - 1; at += 1) expect(samples.alongM[at] - samples.alongM[at - 1]).toBeCloseTo(5, 9);
    const chords = samples.coords.slice(1).reduce((sum, point, at) => sum + planarDistance(samples.coords[at], point), 0);
    expect(chords / roundedLength).toBeGreaterThan(0.998);
    expect(chords).toBeLessThanOrEqual(roundedLength + 1e-9);
    // The bearing turns smoothly: 5 m on a 30 m arc is 9.55° (2 m chords are 0.02 % shorter than their arcs).
    for (let at = 1; at < samples.tangentsDeg.length; at += 1) {
      expect(angleBetween(samples.tangentsDeg[at], samples.tangentsDeg[at - 1])).toBeLessThanOrEqual(toDegrees2(5 / R) * 1.001);
    }
    expect(resampleEnu([[0, 0]], 5)).toEqual([[0, 0]]);
  });

  it('easing widens a corner the fillet cannot fit and keeps the first and last legs', () => {
    // A taxilane that bends 4° every 6 m before a 90° turn into a lead-in: the turn alone would get only 3 m.
    const bent = [[-200, 0], [-12, 0], [-6, 0.42], [0, 0], [0, -80]];
    expect(Math.min(...filletPath(bent, R).radiiM)).toBeLessThan(20);
    const eased = easePolyline(bent, { radiusM: R, minRadiusM: 20, maxShiftM: 15 });
    expect(Math.min(...filletPath(eased, R).radiiM)).toBeGreaterThanOrEqual(20);
    expect(eased[0]).toEqual([-200, 0]);
    expect(eased[eased.length - 1]).toEqual([0, -80]);
    expect(enuBearingDeg([eased[1][0] - eased[0][0], eased[1][1] - eased[0][1]])).toBeCloseTo(90, 6);
    const last = eased.length - 1;
    expect(enuBearingDeg([eased[last][0] - eased[last - 1][0], eased[last][1] - eased[last - 1][1]])).toBeCloseTo(180, 6);
    for (const point of eased) expect(toPlanarLine(point, bent)).toBeLessThanOrEqual(15);
    // A U-turn 23 m wide cannot be widened past 11.5 m within 15 m of the line: easing leaves what fits.
    const hook = [[-20, 120], [-20, 0], [3, 0], [3, 40]];
    const unchanged = easePolyline(hook, { radiusM: R, minRadiusM: 20, maxShiftM: 15 });
    expect(unchanged).toEqual(hook);
  });
});

function toDegrees2(radians) {
  return (radians * 180) / Math.PI;
}
