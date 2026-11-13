import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_M,
  METRES_PER_NM,
  convexIntersectionAreaM2,
  destinationPoint,
  haversineM,
  initialBearing,
  minimumBoundingRectangle,
  pointInPolygon,
  pointToPolylineM,
  pointToSegmentM,
  polygonAreaM2,
  polygonCentroid,
  roundCoord,
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
