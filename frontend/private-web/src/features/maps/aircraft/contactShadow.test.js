import { describe, expect, it } from 'vitest';
import {
  CONTACT_SHADOW, contactDisc, contactShadowMatrix, contactShadowSize, contactShadowStrength,
} from './contactShadow';
import { AIRCRAFT_TYPES } from './types';

// Applies a column-major 4 × 4 matrix to a point.
const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

describe('the contact shadow of a 3D aircraft (M4, 2026-11-28)', () => {
  it('is full on the ground and fades smoothly to nothing at fadeM', () => {
    expect(CONTACT_SHADOW.fadeM).toBe(45);
    expect(contactShadowStrength(0)).toBe(1);
    expect(contactShadowStrength(-3)).toBe(1);
    expect(contactShadowStrength(undefined)).toBe(1);
    expect(contactShadowStrength(Number.NaN)).toBe(1);
    expect(contactShadowStrength(CONTACT_SHADOW.fadeM / 2)).toBeCloseTo(0.5, 12);
    expect(contactShadowStrength(CONTACT_SHADOW.fadeM)).toBe(0);
    expect(contactShadowStrength(300)).toBe(0);
    // It only falls as the aircraft climbs, and gently at both ends (no edge where it starts or stops).
    const heights = Array.from({ length: 46 }, (_, index) => index);
    const strengths = heights.map(contactShadowStrength);
    strengths.slice(1).forEach((value, index) => expect(value).toBeLessThanOrEqual(strengths[index]));
    expect(1 - contactShadowStrength(1)).toBeLessThan(0.01);
    expect(contactShadowStrength(CONTACT_SHADOW.fadeM - 1)).toBeLessThan(0.01);
  });

  it('is scaled by the type and spreads as the aircraft climbs', () => {
    const a320 = contactShadowSize(AIRCRAFT_TYPES.A320);
    expect(a320.alongM).toBeCloseTo(CONTACT_SHADOW.alongShare * AIRCRAFT_TYPES.A320.lengthM, 12);
    expect(a320.acrossM).toBeCloseTo(CONTACT_SHADOW.acrossShare * AIRCRAFT_TYPES.A320.spanM, 12);
    const b77w = contactShadowSize(AIRCRAFT_TYPES.B77W);
    expect(b77w.alongM).toBeGreaterThan(a320.alongM);
    expect(b77w.acrossM).toBeGreaterThan(a320.acrossM);
    // Within the aircraft's own outline on the ground: never longer than the fuselage nor wider than the wings.
    expect(2 * a320.alongM).toBeLessThan(1.2 * AIRCRAFT_TYPES.A320.lengthM);
    expect(2 * a320.acrossM).toBeLessThan(AIRCRAFT_TYPES.A320.spanM);
    const high = contactShadowSize(AIRCRAFT_TYPES.A320, CONTACT_SHADOW.fadeM);
    expect(high.alongM / a320.alongM).toBeCloseTo(CONTACT_SHADOW.spreadAtFade, 12);
    expect(contactShadowSize(AIRCRAFT_TYPES.A320, 10 * CONTACT_SHADOW.fadeM)).toEqual(high);
    expect(contactShadowSize(null)).toEqual({ alongM: 0, acrossM: 0 });
  });

  it('lays the unit disc along the heading, just above the ground', () => {
    const matrix = contactShadowMatrix({ x: 100, y: -50, headingDeg: 90, alongM: 20, acrossM: 10 });
    // The disc's +y (along) points east at a heading of 90°, its +x (across) south.
    const nose = apply(matrix, [0, 1, 0]);
    const side = apply(matrix, [1, 0, 0]);
    expect(nose[0]).toBeCloseTo(120, 9);
    expect(nose[1]).toBeCloseTo(-50, 9);
    expect(side[0]).toBeCloseTo(100, 9);
    expect(side[1]).toBeCloseTo(-60, 9);
    expect(nose[2]).toBeCloseTo(CONTACT_SHADOW.heightM, 12);
    // North-up without a heading, and nothing for sizes that are not.
    const north = contactShadowMatrix({ alongM: 5, acrossM: 2 });
    expect(apply(north, [0, 1, 0])).toEqual([0, 5, CONTACT_SHADOW.heightM]);
    expect(contactShadowMatrix({ alongM: Number.NaN, acrossM: -1 }).slice(0, 8).every(value => value === 0)).toBe(true);
  });

  it('builds a disc darkest in its middle and clear at its rim', () => {
    const disc = contactDisc(16);
    const rings = CONTACT_SHADOW.rings.length - 1;
    expect(disc.positions).toHaveLength(3 * (1 + rings * 16));
    expect(disc.colors).toHaveLength(disc.positions.length);
    // One fan round the centre and two triangles per segment between rings.
    expect(disc.indices).toHaveLength(3 * 16 + 6 * 16 * (rings - 1));
    expect(Math.max(...disc.indices)).toBe(rings * 16);
    expect(disc.colors[0]).toBeCloseTo(CONTACT_SHADOW.darkness, 6);
    const rim = 3 * (1 + (rings - 1) * 16);
    expect([...disc.colors.slice(rim)].every(value => value === 0)).toBe(true);
    const rimPoint = [disc.positions[rim], disc.positions[rim + 1], disc.positions[rim + 2]];
    expect(Math.hypot(...rimPoint)).toBeCloseTo(1, 6);
    // Counter-clockwise seen from above: the first triangle's normal points up.
    const [a, b, c] = [disc.indices[0], disc.indices[1], disc.indices[2]].map(index => [
      disc.positions[3 * index], disc.positions[3 * index + 1]]);
    expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    // Never fewer than eight segments.
    expect(contactDisc(3).positions).toHaveLength(3 * (1 + rings * 8));
  });
});
