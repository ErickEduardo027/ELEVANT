import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM, initialBearing, pointInPolygon, toEnu } from '../airport/geo';
import { aircraftFootprint } from './footprint';
import { silhouetteOutline } from './silhouette';
import { AIRCRAFT_TYPES, CATEGORY_FALLBACKS } from './types';

// A stand of the MDPC layout: A1 points its nose almost due south (174.8°).
const A1 = MDPC_LAYOUT.stands.find(stand => stand.code === 'A1');
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// The extent of a footprint along and across a heading, in metres, in the local plane of its centre.
function extentsAt(ring, center, headingTrue) {
  const radians = (headingTrue * Math.PI) / 180;
  const local = ring.map(point => toEnu(center, point));
  const along = local.map(([x, y]) => x * Math.sin(radians) + y * Math.cos(radians));
  const across = local.map(([x, y]) => x * Math.cos(radians) - y * Math.sin(radians));
  return {
    length: Math.max(...along) - Math.min(...along),
    span: Math.max(...across) - Math.min(...across),
    middleAlong: (Math.max(...along) + Math.min(...along)) / 2,
    middleAcross: (Math.max(...across) + Math.min(...across)) / 2,
  };
}

describe('aircraftFootprint', () => {
  it('the box of the footprint is the span by the length within 2 %', () => {
    for (const [code, spec] of Object.entries({ ...AIRCRAFT_TYPES, ...CATEGORY_FALLBACKS })) {
      for (const heading of [0, 74, 174.8, 270]) {
        const ring = aircraftFootprint(spec, A1.center, heading);
        const { length, span, middleAlong, middleAcross } = extentsAt(ring, A1.center, heading);
        expect(Math.abs(length - spec.lengthM) / spec.lengthM, `${code} length at ${heading}°`).toBeLessThan(0.02);
        expect(Math.abs(span - spec.spanM) / spec.spanM, `${code} span at ${heading}°`).toBeLessThan(0.02);
        // Centred on the point it is given.
        expect(Math.abs(middleAlong), `${code} along at ${heading}°`).toBeLessThan(0.05);
        expect(Math.abs(middleAcross), `${code} across at ${heading}°`).toBeLessThan(0.05);
      }
    }
  });

  it('the nose points along the stand heading', () => {
    const spec = AIRCRAFT_TYPES.B38M;
    for (const heading of [0, 45, A1.headingTrue, 266.2]) {
      const ring = aircraftFootprint(spec, A1.center, heading);
      // The first point is the nose, half the length ahead of the centre.
      expect(angle(initialBearing(A1.center, ring[0]), heading), `nose at ${heading}°`).toBeLessThan(0.5);
      expect(haversineM(A1.center, ring[0])).toBeCloseTo(spec.lengthM / 2, 0);
      // The right wing tip is 90° clockwise of the nose.
      const tip = ring.reduce((best, point) => {
        const [x, y] = toEnu(A1.center, point);
        const radians = (heading * Math.PI) / 180;
        const across = x * Math.cos(radians) - y * Math.sin(radians);
        return across > best.across ? { across, point } : best;
      }, { across: -Infinity, point: null });
      expect(angle(initialBearing(A1.center, tip.point), heading + 90)).toBeLessThan(60);
    }
  });

  it('is a closed ring of the silhouette, at about a centimetre, that fits inside the stand it is drawn on', () => {
    const spec = AIRCRAFT_TYPES.A320;
    const ring = aircraftFootprint(spec, A1.center, A1.headingTrue);
    expect(ring).toHaveLength(silhouetteOutline(spec).length + 1);
    expect(ring.at(-1)).toEqual(ring[0]);
    for (const [lng, lat] of ring) {
      expect(Math.round(lng * 1e7) / 1e7).toBe(lng);
      expect(Math.round(lat * 1e7) / 1e7).toBe(lat);
    }
    // An A320 fits a code-D stand: every point of its footprint inside A1's box.
    expect(ring.every(point => pointInPolygon(point, A1.polygon))).toBe(true);
    // A heading that is not a number reads as north.
    expect(aircraftFootprint(spec, A1.center, Number.NaN)).toEqual(aircraftFootprint(spec, A1.center, 0));
  });
});
