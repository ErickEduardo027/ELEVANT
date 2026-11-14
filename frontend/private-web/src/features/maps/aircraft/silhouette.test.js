import { describe, expect, it } from 'vitest';
import { CATEGORY_OUTLINES, outlineBox, silhouetteOutline, silhouettePath } from './silhouette';
import { AIRCRAFT_TYPES, CATEGORY_FALLBACKS, ICON_CATEGORIES } from './types';

// Every airframe the map draws: the twenty types of the table and the generic one of each icon category.
const AIRFRAMES = [
  ...Object.entries(AIRCRAFT_TYPES),
  ...Object.entries(CATEGORY_FALLBACKS).map(([category, spec]) => [`category ${category}`, spec]),
];

const cross = ([ax, ay], [bx, by], [cx, cy]) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const onSegment = ([ax, ay], [bx, by], [px, py]) => Math.min(ax, bx) - 1e-9 <= px && px <= Math.max(ax, bx) + 1e-9
  && Math.min(ay, by) - 1e-9 <= py && py <= Math.max(ay, by) + 1e-9;

// Whether two segments share a point (crossing or touching).
function intersects(p1, p2, q1, q2) {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(q1, q2, p1)) || (d2 === 0 && onSegment(q1, q2, p2))
    || (d3 === 0 && onSegment(p1, p2, q1)) || (d4 === 0 && onSegment(p1, p2, q2));
}

// A ring is simple when no two edges that do not follow each other meet, and no edge has zero length.
function isSimple(ring) {
  const edges = ring.map((point, index) => [point, ring[(index + 1) % ring.length]]);
  if (edges.some(([a, b]) => a[0] === b[0] && a[1] === b[1])) return false;
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === edges.length - 1);
      if (!adjacent && intersects(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) return false;
    }
  }
  return true;
}

const key = ([x, y]) => `${x.toFixed(3)}|${y.toFixed(3)}`;
const numbersOf = path => path.match(/-?\d+(?:\.\d+)?/g).map(Number);

describe('aircraft silhouettes (design E2)', () => {
  it('the outline is a simple symmetric polygon whose box equals span by length within 1 %', () => {
    for (const [name, spec] of AIRFRAMES) {
      const outline = silhouetteOutline(spec);
      expect(outline.length, name).toBeGreaterThanOrEqual(3);
      expect(outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), name).toBe(true);
      expect(isSimple(outline), name).toBe(true);
      // Symmetric about the fuselage axis: every point has its mirror.
      const points = new Set(outline.map(key));
      expect(outline.every(([x, y]) => points.has(key([-x || 0, y]))), name).toBe(true);
      const { minX, maxX, minY, maxY } = outlineBox(outline);
      expect(Math.abs((maxX - minX) / spec.spanM - 1), `${name} span`).toBeLessThan(0.01);
      expect(Math.abs((maxY - minY) / spec.lengthM - 1), `${name} length`).toBeLessThan(0.01);
      expect(maxX + minX, name).toBeCloseTo(0, 6);
    }
    // The icons draw the generic airframe of their category.
    expect(Object.keys(CATEGORY_OUTLINES)).toEqual(ICON_CATEGORIES);
    expect(CATEGORY_OUTLINES.narrow).toEqual(silhouetteOutline(CATEGORY_FALLBACKS.narrow));
    expect(Object.isFrozen(CATEGORY_OUTLINES.heavy4) && Object.isFrozen(CATEGORY_OUTLINES.heavy4[0])).toBe(true);
    // A four-engine airframe shows four nacelles ahead of its wing, a twin two: on each side, the front of a nacelle is
    // the one edge that runs straight outward.
    const nacelleFronts = outline => outline.filter(([x, y], index) => {
      const next = outline[(index + 1) % outline.length];
      return x > 0 && next[1] === y && next[0] > x;
    }).length;
    expect(nacelleFronts(CATEGORY_OUTLINES.heavy4)).toBe(2);
    expect(nacelleFronts(silhouetteOutline(AIRCRAFT_TYPES.A320))).toBe(1);
    expect(() => silhouetteOutline({ family: 'zeppelin' })).toThrow(RangeError);
  });

  it('the nose points up', () => {
    for (const [name, spec] of AIRFRAMES) {
      const outline = silhouetteOutline(spec);
      const { maxY } = outlineBox(outline);
      // The top of the outline is the nose (or the forward rotor blade) on the axis, much narrower than the span.
      const top = outline.filter(([, y]) => y === maxY);
      expect(maxY, name).toBeCloseTo(spec.lengthM / 2, 6);
      expect(top.every(([x]) => Math.abs(x) <= 0.05 * spec.spanM), name).toBe(true);
      // The widest point, the wingtip or the rotor, lies well below it.
      const widest = outline.reduce((best, point) => (point[0] > best[0] ? point : best));
      expect(widest[1], name).toBeLessThan(maxY - 0.2 * spec.lengthM);
      // Drawn as an image, the nose is at the top and in the middle.
      const path = silhouettePath(outline, { size: 40 });
      const numbers = numbersOf(path);
      const ys = numbers.filter((_, index) => index % 2 === 1);
      const topIndex = ys.indexOf(Math.min(...ys));
      expect(numbers[topIndex * 2], name).toBeCloseTo(20, 0);
    }
  });

  it('the path keeps 3 px clear of the image border', () => {
    for (const [name, spec] of AIRFRAMES) {
      for (const [size, inset] of [[24, 3], [40, 3], [34, 4]]) {
        const path = silhouettePath(silhouetteOutline(spec), { size, inset });
        expect(path, name).toMatch(/^M[\d.]+ [\d.]+(?: L[\d.]+ [\d.]+)+ Z$/);
        const numbers = numbersOf(path);
        expect(Math.min(...numbers), `${name} at ${size}`).toBeGreaterThanOrEqual(inset - 1e-6);
        expect(Math.max(...numbers), `${name} at ${size}`).toBeLessThanOrEqual(size - inset + 1e-6);
        // The longer side fills the box less its inset.
        const xs = numbers.filter((_, index) => index % 2 === 0);
        const ys = numbers.filter((_, index) => index % 2 === 1);
        const longest = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        expect(longest, `${name} at ${size}`).toBeCloseTo(size - 2 * inset, 1);
      }
    }
    expect(() => silhouettePath(CATEGORY_OUTLINES.narrow, { size: 6 })).toThrow(RangeError);
  });
});
