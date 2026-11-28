import { describe, expect, it } from 'vitest';
import {
  SOURCE_FRAMES, bounds, cleanPart, creaseNormals, determinant3, dropDuplicates, extent, findWingtip, insertPlug,
  resizeNacelles, rotateParts, splitBySide, stretchSpan, weldPositions, wingtipDevice,
} from './mesh.mjs';

// A box as a part: 8 corners, 12 outward triangles.
function box(name, [x0, y0, z0], [x1, y1, z1]) {
  const pos = Float64Array.from([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const tri = Uint32Array.from([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  return { name, mesh: name, material: '', cls: 'body', crease: 35, pos, tri };
}

describe('aircraft model geometry (M5)', () => {
  it('turns every source frame into the app frame with proper rotations', () => {
    const turn = (frame, v) => SOURCE_FRAMES[frame].map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    for (const [frame, nose, right] of [
      ['nose-Z', [0, 0, -1], [1, 0, 0]], ['nose+Z', [0, 0, 1], [-1, 0, 0]], ['nose+X', [1, 0, 0], [0, 0, 1]],
      ['nose-X', [-1, 0, 0], [0, 0, -1]],
    ]) {
      expect(determinant3(SOURCE_FRAMES[frame]), frame).toBe(1);
      expect(turn(frame, nose), frame).toEqual([0, 1, 0]);
      expect(turn(frame, right), frame).toEqual([1, 0, 0]);
      expect(turn(frame, [0, 1, 0]), frame).toEqual([0, 0, 1]);
    }
    const part = box('b', [0, 0, -2], [1, 1, 0]);
    rotateParts([part], SOURCE_FRAMES['nose-Z']);
    expect(bounds([part])).toEqual({ min: [0, 0, 0], max: [1, 2, 1] });
  });

  it('drops degenerate triangles, overlapping duplicates and splits parts that lie on both sides', () => {
    const part = box('b', [0, 0, 0], [1, 1, 1]);
    const withJunk = { ...part, tri: Uint32Array.from([...part.tri, 0, 0, 1, 0, 1, 1]) };
    expect(cleanPart(withJunk).tri.length / 3).toBe(12);
    const copy = box('copy', [0, 0, 0], [1, 1, 1]);
    const other = box('other', [2, 0, 0], [3, 1, 1]);
    const { parts, dropped } = dropDuplicates([part, copy, other]);
    expect(parts.map(p => p.name)).toEqual(['b', 'other']);
    expect(dropped).toEqual([{ name: 'copy', triangles: 12 }]);

    const both = box('engines', [-3, 0, 0], [-2, 1, 1]);
    const right = box('engines', [2, 0, 0], [3, 1, 1]);
    const joined = { ...both, pos: Float64Array.from([...both.pos, ...right.pos]),
      tri: Uint32Array.from([...both.tri, ...right.tri.map(v => v + 8)]) };
    const sides = splitBySide(joined);
    expect(sides.map(p => bounds([p]).min[0])).toEqual([-3, 2]);
    // A part across the plane x = 0 (a fuselage) stays whole.
    expect(splitBySide(box('fuselage', [-1, 0, 0], [1, 5, 1]))).toHaveLength(1);
  });

  it('inserts and removes fuselage plugs in a constant run without moving the wing or the tail', () => {
    // A fuselage 40 m long (nose at y = 20) with a wing behind the forward run and a wingtip that reaches back into
    // the aft run.
    const fuselage = { ...box('fuselage', [-2, -20, 0], [2, 20, 4]) };
    // Split the fuselage into rings every metre so the map has vertices to move.
    const rings = [];
    for (let y = -20; y < 20; y += 1) rings.push(box(`ring${y}`, [-2, y, 0], [2, y + 1, 4]));
    const wing = box('wing', [2.5, -6, 1], [17, 0, 1.5]);
    const tail = box('tail', [-6, -20, 3], [6, -16, 3.3]);
    const parts = [fuselage, ...rings, wing, tail];
    const before = (part, k) => Array.from(part.pos.filter((_, i) => i % 3 === k));
    const wingY = before(wing, 1);
    const tailY = before(tail, 1);
    // Aft run 24–30 m from the nose (y −4…−10), behind the wing root: grows by 2 m; the wing is ahead of it.
    const aft = insertPlug(parts, { fromM: 24, toM: 30, deltaM: 2, bandHalfWidth: 2.4, wing: 'ahead' });
    expect(aft).toMatchObject({ yA: -10, yB: -4, sheared: 0 });
    expect(extent(bounds(parts))[1]).toBeCloseTo(42);
    expect(before(wing, 1)).toEqual(wingY.map(y => y + 2));
    expect(before(tail, 1)).toEqual(tailY);
    // Forward run 6–14 m from the nose, ahead of the wing: shrinks by 3 m; the wing and the tail stay.
    insertPlug(parts, { fromM: 6, toM: 14, deltaM: -3, bandHalfWidth: 2.4, wing: 'behind' });
    expect(extent(bounds(parts))[1]).toBeCloseTo(39);
    expect(before(wing, 1)).toEqual(wingY.map(y => y + 2));
    expect(before(tail, 1)).toEqual(tailY);
    expect(() => insertPlug(parts, { fromM: 6, toM: 7, deltaM: -0.9 })).toThrow(/too little/);
  });

  it('stretches the span outside the fuselage and resizes the nacelles about their axis', () => {
    const fuselage = box('fuselage', [-2, -10, 0], [2, 10, 4]);
    const wing = box('wing', [2, -2, 1], [12, 2, 1.4]);
    const left = box('nacelleL', [-6, 1, -1], [-4, 4, 1]);
    const right = box('nacelleR', [4, 1, -1], [6, 4, 1]);
    const fan = box('fanR', [4.5, 3.5, -0.5], [5.5, 3.8, 0.5]);
    stretchSpan([fuselage, wing], 2, 1.1);
    expect(bounds([fuselage]).max[0]).toBe(2);
    expect(bounds([wing]).max[0]).toBeCloseTo(13);
    const parts = [fuselage, wing, left, right, fan];
    const records = resizeNacelles(parts, { seed: /^nacelle/, diameterM: 3, lengthen: 1.2 });
    expect(records.map(r => r.side)).toEqual([-1, 1]);
    expect(records[1].members).toEqual(['nacelleR', 'fanR']);
    const size = extent(bounds([right]));
    expect(size[0]).toBeCloseTo(3);
    expect(size[2]).toBeCloseTo(3);
    expect(size[1]).toBeCloseTo(3.6);
    expect(() => resizeNacelles([fuselage], { seed: /^nacelle/, diameterM: 3 })).toThrow(/no part/);
  });

  it('lofts sharklets and raked tips out of the wingtips', () => {
    const wing = box('wing', [-17, -2, 1], [17, 0, 1.2]);
    const tip = findWingtip([wing], 1);
    expect(tip).toMatchObject({ x: 17, le: 0, te: -2 });
    const sharklet = wingtipDevice(tip, 1, { kind: 'sharklet', reachM: 0.9, heightM: 2.4, sweepDeg: 38, taper: 0.3,
      name: 'sharklet.R' });
    const s = bounds([sharklet]);
    expect(s.max[0]).toBeGreaterThan(17.85);
    expect(s.max[0]).toBeLessThan(18);
    expect(s.max[2]).toBeGreaterThan(1.1 + 2.3);
    const raked = wingtipDevice(findWingtip([wing], -1), -1, { kind: 'raked', reachM: 2, sweepDeg: 55, taper: 0.25,
      name: 'raked.L' });
    const r = bounds([raked]);
    expect(r.min[0]).toBeCloseTo(-19, 1);
    expect(r.max[2] - 1.1).toBeLessThan(0.4);
    for (const part of [sharklet, raked]) {
      expect(part.pos.every(Number.isFinite)).toBe(true);
      expect(Math.max(...part.tri)).toBeLessThan(part.pos.length / 3);
    }
  });

  it('welds positions and splits normals at creases', () => {
    const cube = box('cube', [0, 0, 0], [1, 1, 1]);
    const soup = new Float64Array(cube.tri.length * 3);
    cube.tri.forEach((v, i) => soup.set(cube.pos.subarray(v * 3, v * 3 + 3), i * 3));
    const welded = weldPositions(soup, Uint32Array.from({ length: cube.tri.length }, (_, i) => i));
    expect(welded.pos.length / 3).toBe(8);
    expect(welded.tri.length / 3).toBe(12);
    const sharp = creaseNormals(cube.pos, cube.tri, 35);
    expect(sharp.pos.length / 3).toBe(24);
    // Each face's normals point out of the cube.
    expect(Array.from(sharp.nor).every(v => [0, 1, -1].includes(Math.round(v)))).toBe(true);
    const smooth = creaseNormals(cube.pos, cube.tri, 100);
    expect(smooth.pos.length / 3).toBe(8);
  });
});
