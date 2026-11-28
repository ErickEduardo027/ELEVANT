import { describe, expect, it } from 'vitest';
import { THREE_PARTS } from './aircraft3dChunk';
import { buildAircraftGeometry, TRIANGLE_BUDGET, triangleCount } from './aircraftGeometry';
import { fuselageProfile, outlineBox, silhouetteOutline } from './silhouette';
import { AIRCRAFT_TYPES, CATEGORY_FALLBACKS } from './types';

// The real three, in Node: the geometry classes need no WebGL. Every airframe the map draws is built once, with the
// parts of three the 3D chunk hands to the layer.
const AIRFRAMES = [
  ...Object.entries(AIRCRAFT_TYPES),
  ...Object.entries(CATEGORY_FALLBACKS).map(([category, spec]) => [`category ${category}`, spec]),
];
const MODELS = new Map(AIRFRAMES.map(([name, spec]) => [name, buildAircraftGeometry(THREE_PARTS, spec)]));
const TUBE_FAMILIES = ['twinUnderwing', 'quadUnderwing', 'rearTwinT', 'bizjet', 'turbopropHigh', 'turbopropLow', 'pistonSingle'];

const millimetre = value => Math.round(value * 1000) / 1000;
const partsOf = (geometry, name) => geometry.userData.parts.filter(part => part.name === name);

// The box of some vertices of a geometry: all of them, or the range of one part.
function boxOf(geometry, { start = 0, count = geometry.getAttribute('position').count } = {}) {
  const position = geometry.getAttribute('position');
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let index = start; index < start + count; index += 1) {
    box.minX = Math.min(box.minX, position.getX(index));
    box.maxX = Math.max(box.maxX, position.getX(index));
    box.minY = Math.min(box.minY, position.getY(index));
    box.maxY = Math.max(box.maxY, position.getY(index));
    box.minZ = Math.min(box.minZ, position.getZ(index));
    box.maxZ = Math.max(box.maxZ, position.getZ(index));
  }
  return box;
}

// The vertices of a part as [x, y, z].
function verticesOf(geometry, { start, count }) {
  const position = geometry.getAttribute('position');
  return Array.from({ length: count }, (_, offset) => [position.getX(start + offset), position.getY(start + offset),
    position.getZ(start + offset)]);
}

const within = (actual, expected, share) => Math.abs(actual / expected - 1) <= share;

// The right wing: of the two wing parts, the one that reaches +x.
const rightWingOf = geometry => partsOf(geometry, 'wing')
  .reduce((best, part) => (boxOf(geometry, part).maxX > boxOf(geometry, best).maxX ? part : best));

// The right wing's middle plane as a function of x, from its root (on the axis) and its tip.
function wingMiddleOf(geometry, halfSpan) {
  const vertices = verticesOf(geometry, rightWingOf(geometry));
  const middle = list => (Math.min(...list.map(([, , z]) => z)) + Math.max(...list.map(([, , z]) => z))) / 2;
  const root = middle(vertices.filter(([x]) => Math.abs(x) < 0.1));
  const tip = middle(vertices.filter(([x]) => x > halfSpan - 0.05));
  return x => root + ((tip - root) * x) / halfSpan;
}

describe('procedural aircraft geometry (design G2)', () => {
  it('every type of the table and every category builds within 1 500 to 3 000 triangles', () => {
    expect(TRIANGLE_BUDGET).toEqual({ min: 1500, max: 3000 });
    expect(Object.isFrozen(TRIANGLE_BUDGET)).toBe(true);
    expect(MODELS.size).toBe(44);
    for (const [name, geometry] of MODELS) {
      const triangles = triangleCount(geometry);
      expect(Number.isInteger(triangles), name).toBe(true);
      expect(triangles, name).toBeGreaterThanOrEqual(TRIANGLE_BUDGET.min);
      expect(triangles, name).toBeLessThanOrEqual(TRIANGLE_BUDGET.max);
    }
    // Sixty aircraft stay well inside the scene's budget of 250 000 triangles (design G4).
    expect(60 * Math.max(...[...MODELS.values()].map(triangleCount))).toBeLessThan(250_000);
    // The count reads indexed geometry too.
    expect(triangleCount(new THREE_PARTS.BoxGeometry(1, 1, 1))).toBe(12);
  });

  it('the bounding box equals span, length and height within 2 %, wheels on the ground and the nose toward +y', () => {
    for (const [name, spec] of AIRFRAMES) {
      const geometry = MODELS.get(name);
      const box = boxOf(geometry);
      expect(geometry.boundingBox.max.toArray(), name).toEqual([box.maxX, box.maxY, box.maxZ]);
      expect(within(box.maxX - box.minX, spec.spanM, 0.02), `${name} span`).toBe(true);
      expect(within(box.maxY - box.minY, spec.lengthM, 0.02), `${name} length`).toBe(true);
      expect(within(box.maxZ - box.minZ, spec.heightM, 0.02), `${name} height`).toBe(true);
      // Centred across, the nose at +length/2 and the tail at −length/2.
      expect(Math.abs(box.maxX + box.minX), name).toBeLessThan(1e-4);
      expect(box.maxY, name).toBeCloseTo(spec.lengthM / 2, 3);
      expect(box.minY, name).toBeCloseTo(-spec.lengthM / 2, 3);
      // The wheels (or the skids) stand on the ground and nothing goes below it.
      expect(box.minZ, name).toBeCloseTo(0, 6);
      const landing = geometry.userData.parts.filter(part => part.name === 'gear' || part.name === 'skid');
      expect(Math.min(...landing.map(part => boxOf(geometry, part).minZ)), name).toBeCloseTo(0, 6);
      // The nose points to +y: the foremost vertices lie on the axis (a helicopter's forward blade, as wide as the
      // silhouette draws it), the wingtips (or the rotor's tips across) and the top of a fixed-wing airframe lie behind.
      const vertices = verticesOf(geometry, { start: 0, count: geometry.getAttribute('position').count });
      const foremost = vertices.filter(([, y]) => y > box.maxY - 1e-4);
      expect(foremost.every(([x]) => Math.abs(x) <= 0.05 * spec.spanM), name).toBe(true);
      const tips = vertices.filter(([x]) => x > box.maxX - 1e-3);
      expect(Math.max(...tips.map(([, y]) => y)), name).toBeLessThan(box.maxY - 0.2 * spec.lengthM);
      if (spec.family !== 'helicopter') {
        const highest = vertices.filter(([, , z]) => z > box.maxZ - 1e-4);
        expect(highest.every(([, y]) => y < 0), `${name} fin at the tail`).toBe(true);
      }
    }
  });

  it('the 3D model and the 2D silhouette come from the same numbers: the same plan box within 1 %, the wingtip and the nacelle fronts where the outline puts them', () => {
    for (const [name, spec] of AIRFRAMES) {
      const geometry = MODELS.get(name);
      const outline = silhouetteOutline(spec);
      const plan = outlineBox(outline);
      const box = boxOf(geometry);
      expect(Math.abs(box.maxX - plan.maxX) / spec.spanM, `${name} right`).toBeLessThan(0.01);
      expect(Math.abs(box.minX - plan.minX) / spec.spanM, `${name} left`).toBeLessThan(0.01);
      expect(Math.abs(box.maxY - plan.maxY) / spec.lengthM, `${name} nose`).toBeLessThan(0.01);
      expect(Math.abs(box.minY - plan.minY) / spec.lengthM, `${name} tail`).toBeLessThan(0.01);
      if (!TUBE_FAMILIES.includes(spec.family)) continue;

      // The wingtip: the outline's tip leading and trailing edge are the right wing's outermost chord.
      const halfSpan = spec.spanM / 2;
      const outlineTip = outline.filter(([x]) => x === millimetre(halfSpan)).map(([, y]) => y);
      expect(outlineTip, name).toHaveLength(2);
      const tip = verticesOf(geometry, rightWingOf(geometry)).filter(([x]) => x > halfSpan - 0.05).map(([, y]) => y);
      expect(Math.max(...tip), `${name} tip leading edge`).toBeCloseTo(Math.max(...outlineTip), 2);
      expect(Math.min(...tip), `${name} tip trailing edge`).toBeCloseTo(Math.min(...outlineTip), 2);

      // The nacelle fronts: each right nacelle's front is an edge of the outline at its y, between its sides, and its
      // outer side is the outline's.
      for (const part of partsOf(geometry, 'nacelle').filter(entry => boxOf(geometry, entry).minX > 0)) {
        const nacelle = boxOf(geometry, part);
        const front = outline.filter(([x, y]) => Math.abs(y - nacelle.maxY) < 2e-3
          && x >= nacelle.minX - 2e-3 && x <= nacelle.maxX + 2e-3);
        expect(front.length, `${name} nacelle front at ${nacelle.maxY}`).toBeGreaterThanOrEqual(1);
        expect(outline.some(([x]) => Math.abs(x - nacelle.maxX) < 2e-3), `${name} nacelle side`).toBe(true);
      }

      // The fuselage turns the outline's half-width: at each station of the nose its widest vertex is the outline's.
      const [fuselage] = partsOf(geometry, 'fuselage');
      const vertices = verticesOf(geometry, fuselage);
      for (const [halfWidth, y] of fuselageProfile(spec).slice(1, -2)) {
        const ring = vertices.filter(([, vy]) => Math.abs(vy - y) < 1e-4);
        expect(ring.length, `${name} ring at ${y}`).toBeGreaterThan(0);
        expect(Math.max(...ring.map(([x]) => x)), `${name} at ${y}`).toBeCloseTo(halfWidth, 4);
        expect(outline.some(([x, oy]) => x === millimetre(halfWidth) && oy === millimetre(y)), `${name} at ${y}`).toBe(true);
      }
    }
  });

  it('each family builds its own airframe: four nacelles on a quad, rear pods and a T-tail on rearTwinT and bizjet, propeller discs on turboprops, a rotor on a helicopter', () => {
    for (const [name, spec] of AIRFRAMES) {
      const geometry = MODELS.get(name);
      const names = geometry.userData.parts.map(part => part.name);
      const count = partName => names.filter(entry => entry === partName).length;
      const boxes = partName => partsOf(geometry, partName).map(part => boxOf(geometry, part));
      const H = spec.heightM;
      const nacelleCount = { twinUnderwing: 2, quadUnderwing: 4, rearTwinT: 2, bizjet: 2, turbopropHigh: 2, turbopropLow: 2 };
      expect(count('nacelle'), name).toBe(nacelleCount[spec.family] ?? 0);
      expect(boxes('nacelle').filter(nacelle => nacelle.minX > 0).length, `${name} one side`).toBe(count('nacelle') / 2);

      if (spec.family === 'helicopter') {
        // A rotor across the whole span at the height, a tail rotor, a cabin and two skids; no wing.
        const rotor = boxes('rotor');
        expect(Math.max(...rotor.map(part => part.maxX)), name).toBeCloseTo(spec.spanM / 2, 4);
        expect(Math.min(...rotor.map(part => part.minX)), name).toBeCloseTo(-spec.spanM / 2, 4);
        expect(Math.max(...rotor.map(part => part.maxZ)), name).toBeCloseTo(H, 4);
        expect([count('tailRotor'), count('cabin'), count('skid'), count('wing')], name).toEqual([1, 1, 2, 0]);
        expect(Math.max(...boxes('skid').map(skid => skid.minZ)), name).toBeCloseTo(0, 6);
        continue;
      }
      expect(count('rotor'), name).toBe(0);
      expect(count('wing'), name).toBe(spec.family === 'dart' ? 1 : 2);

      const tailplane = boxes('tailplane');
      const tTail = ['rearTwinT', 'bizjet', 'turbopropHigh', 'turbopropLow'].includes(spec.family);
      if (tTail) {
        // A T-tail: the tailplane on top of the fin, its root reaching the height.
        expect(tailplane, name).toHaveLength(2);
        expect(Math.min(...tailplane.map(part => part.minZ)), name).toBeGreaterThan(0.85 * H);
        expect(Math.max(...tailplane.map(part => part.maxZ)), name).toBeCloseTo(H, 4);
        expect(Math.max(...boxes('fin').map(part => part.maxZ)), name).toBeLessThan(H);
      } else if (spec.family !== 'dart') {
        // A tailplane on the tail cone, well below the fin's tip, which reaches the height.
        expect(Math.max(...tailplane.map(part => part.maxZ)), name).toBeLessThan(0.7 * H);
        expect(Math.max(...boxes('fin').map(part => part.maxZ)), name).toBeCloseTo(H, 4);
      }

      if (spec.family === 'rearTwinT' || spec.family === 'bizjet') {
        // Two pods on pylons beside the rear fuselage, above its axis there.
        expect(count('pylon'), name).toBe(2);
        for (const pod of boxes('nacelle')) {
          expect(pod.maxY, name).toBeLessThan(0);
          expect(Math.max(Math.abs(pod.minX), Math.abs(pod.maxX)), name).toBeLessThan(0.3 * spec.spanM / 2);
        }
      }
      if (spec.family === 'twinUnderwing' || spec.family === 'quadUnderwing' || spec.family === 'turbopropHigh') {
        // Hung under the wing: each right nacelle's axis is below the wing's middle plane at its station.
        const wingMiddle = wingMiddleOf(geometry, spec.spanM / 2);
        for (const pod of boxes('nacelle').filter(entry => entry.minX > 0)) {
          expect((pod.minZ + pod.maxZ) / 2, name).toBeLessThan(wingMiddle((pod.minX + pod.maxX) / 2));
        }
      }

      const propellers = boxes('propeller');
      if (spec.family === 'turbopropHigh' || spec.family === 'turbopropLow') {
        // A thin disc in front of each nacelle, 0.145 of the span across.
        expect(propellers, name).toHaveLength(2);
        const nacelleFronts = boxes('nacelle').map(pod => pod.maxY);
        for (const disc of propellers) {
          expect(disc.maxX - disc.minX, name).toBeCloseTo(0.145 * spec.spanM, 3);
          expect(disc.maxY - disc.minY, name).toBeLessThan(0.1);
          expect(nacelleFronts.some(front => disc.maxY <= front && disc.maxY > front - 0.5 * spec.engineDiaM), name).toBe(true);
        }
      } else if (spec.family === 'pistonSingle') {
        expect(propellers, name).toHaveLength(1);
        expect(Math.abs(propellers[0].maxX + propellers[0].minX), name).toBeLessThan(1e-4);
        expect(propellers[0].maxY, name).toBeGreaterThan(spec.lengthM / 2 - 0.05 * spec.lengthM);
      } else {
        expect(propellers, name).toHaveLength(0);
      }
    }
  });

  it('the geometry is non-indexed with position and normal only, and an unknown family throws a RangeError', () => {
    for (const [name, geometry] of MODELS) {
      expect(geometry.getIndex(), name).toBeNull();
      expect(Object.keys(geometry.attributes).sort(), name).toEqual(['normal', 'position']);
      const position = geometry.getAttribute('position').array;
      const normal = geometry.getAttribute('normal').array;
      expect(position.length % 9, name).toBe(0);
      // The parts tile the vertices in order, and every triangle faces where its normals point.
      const parts = geometry.userData.parts;
      expect(Object.isFrozen(parts), name).toBe(true);
      expect(parts.reduce((start, part) => (part.start === start ? start + part.count : NaN), 0), name)
        .toBe(position.length / 3);
      let worst = Infinity;
      let notUnit = 0;
      for (let at = 0; at < position.length; at += 9) {
        const [ax, ay, az] = [position[at + 3] - position[at], position[at + 4] - position[at + 1], position[at + 5] - position[at + 2]];
        const [bx, by, bz] = [position[at + 6] - position[at], position[at + 7] - position[at + 1], position[at + 8] - position[at + 2]];
        const face = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
        for (let corner = at; corner < at + 9; corner += 3) {
          notUnit = Math.max(notUnit, Math.abs(Math.hypot(normal[corner], normal[corner + 1], normal[corner + 2]) - 1));
          worst = Math.min(worst, face[0] * normal[corner] + face[1] * normal[corner + 1] + face[2] * normal[corner + 2]);
        }
      }
      expect(notUnit, `${name} unit normals`).toBeLessThan(1e-5);
      expect(worst, `${name} winding`).toBeGreaterThan(0);
    }
    // The same type builds the same model.
    const again = buildAircraftGeometry(THREE_PARTS, AIRCRAFT_TYPES.A320);
    expect(again.getAttribute('position').array).toEqual(MODELS.get('A320').getAttribute('position').array);

    for (const family of ['zeppelin', 'constructor', undefined]) {
      expect(() => buildAircraftGeometry(THREE_PARTS, { ...AIRCRAFT_TYPES.A320, family }), String(family)).toThrow(RangeError);
    }
    for (const spanM of [0, -1, Number.NaN, undefined]) {
      expect(() => buildAircraftGeometry(THREE_PARTS, { ...AIRCRAFT_TYPES.A320, spanM }), String(spanM)).toThrow(RangeError);
    }
    expect(() => buildAircraftGeometry(THREE_PARTS, null)).toThrow(RangeError);
  });
});
