import {
  fuselageHalfWidth, fuselageProfile, nacelles, silhouetteOutline, tailplanePlanform, wingPlanform,
} from './silhouette';

// The 3D model of an aircraft type, built from its dimensions (aircraft/types.js) and its plan view
// (aircraft/silhouette.js), so the model and the 2D silhouette share their numbers (design G2): the fuselage turns the
// outline's half-width, the wings and the tailplane are extruded from the outline's planforms, the nacelles stand
// where the outline draws their fronts. No model files and no third-party shapes.
//
// `three` is a parameter (the classes of aircraft/aircraft3dChunk.js: THREE_PARTS): this module imports neither three
// nor maplibre-gl, so it runs in Node with the real three in the tests and ships inside the 3D chunk. It keeps no state.
//
// Frame: x to the right (across the span), y toward the nose (as the silhouette, and north at heading 0), z up, the
// ground at z = 0. A model's box is x in ±span/2, y in ±length/2 and z in [0, height]: the wingtips (or the rotor)
// reach the span, the nose and the tail the length, the fin (or the T-tail, or the rotor) the height, the wheels (or
// the skids) the ground.

/** The triangles of one type's model (design G2): enough to read at ramp zoom, few enough for sixty aircraft. */
export const TRIANGLE_BUDGET = Object.freeze({ min: 1500, max: 3000 });

const deg = value => (value * Math.PI) / 180;

// How each tube-and-wing family stands in 3D; lengths are shares of the fuselage diameter D unless said otherwise.
// - belly: the fuselage's underside above the ground.
// - wing: `low` (its middle plane a fifth of D above the belly) or `high` (on the fuselage's roof); `dihedral` in
//   degrees; `thickness` of the wing and of the tailplane over their chord.
// - tTail: the tailplane on top of the fin; otherwise it sits on the tail cone with `stabDihedral` degrees, and the
//   fin's tip chord is `finTip` (share of the length). `finSweep`: the fin's leading edge, in degrees.
// - mainGear: the main legs under the wing at that share of the half span, `fuselage` (under the belly) or `nacelle`.
//   noseGear: the nose leg's distance from the nose, as a share of the length.
// - radial and nacelleRadial: segments around the fuselage and a nacelle, chosen so every type stays in the budget.
export const TUBE_FRAMES = Object.freeze({
  twinUnderwing: {
    belly: 0.4, wing: 'low', dihedral: 5, thickness: 0.11, tTail: false, stabDihedral: 6, finTip: 0.065, finSweep: 38,
    mainGear: 0.2, noseGear: 0.12, radial: 64, nacelleRadial: 24,
  },
  quadUnderwing: {
    belly: 0.4, wing: 'low', dihedral: 6, thickness: 0.1, tTail: false, stabDihedral: 7, finTip: 0.065, finSweep: 42,
    mainGear: 0.17, noseGear: 0.1, radial: 56, nacelleRadial: 24,
  },
  rearTwinT: {
    belly: 0.3, wing: 'low', dihedral: 3, thickness: 0.11, tTail: true, finSweep: 40, mainGear: 0.17, noseGear: 0.1,
    radial: 64, nacelleRadial: 24,
  },
  bizjet: {
    belly: 0.3, wing: 'low', dihedral: 3, thickness: 0.1, tTail: true, finSweep: 45, mainGear: 0.15, noseGear: 0.1,
    radial: 64, nacelleRadial: 24,
  },
  turbopropHigh: {
    belly: 0.3, wing: 'high', dihedral: 2, thickness: 0.15, tTail: true, finSweep: 35, mainGear: 'fuselage',
    noseGear: 0.09, radial: 56, nacelleRadial: 20,
  },
  turbopropLow: {
    belly: 0.55, wing: 'low', dihedral: 6, thickness: 0.15, tTail: true, finSweep: 40, mainGear: 'nacelle',
    noseGear: 0.1, radial: 56, nacelleRadial: 20,
  },
  pistonSingle: {
    belly: 0.5, wing: 'high', dihedral: 1.7, thickness: 0.13, tTail: false, stabDihedral: 0, finTip: 0.09, finSweep: 35,
    mainGear: 'fuselage', noseGear: 0.1, radial: 72,
  },
});

// The neutral dart: a narrow body's fuselage under the dart's own wing, a fin and a tricycle gear.
const DART_FRAME = Object.freeze({
  belly: 0.4, plate: 0.02, finTip: 0.065, finSweep: 40, mainGear: 0.18, noseGear: 0.11, radial: 80,
  fuselageFamily: 'twinUnderwing',
});

// A helicopter: the skids lift the cabin `belly` (share of the height) above the ground; the cabin is `cabinTall` times
// as tall as it is wide; the tail rotor's radius is a share of the main rotor's diameter.
const HELICOPTER_FRAME = Object.freeze({ belly: 0.15, cabinTall: 1.15, tailRotor: 0.09, radial: 80 });

// Shared proportions: the fin and the gear sink this share of D into what they meet, so no seam shows; a fin is this
// thick over its chord and, on a tail cone, its trailing edge sweeps back this many degrees; the tail cone gets this
// many rows of the lathe; a propeller disc's diameter is this share of the span (turboprops) and of the span of a light
// single; propeller discs and rotor blades are this many metres thick.
const SINK = 0.06;
const FIN_THICKNESS = 0.1;
const FIN_TRAILING_SWEEP = 15;
const TAIL_CONE_ROWS = 4;
const TURBOPROP_DISC = 0.145;
const PISTON_DISC = 0.17;
const DISC_THICKNESS = 0.06;
// A triangle smaller than this (twice its area squared, m⁴) is a lathe's pole and is dropped.
const MIN_DOUBLE_AREA_SQUARED = 1e-12;

const point2 = (three, [x, y]) => new three.Vector2(x, y);
const translation = (three, x, y, z) => new three.Matrix4().makeTranslation(x, y, z);

// A part as the merge needs it: non-indexed, with `position` and `normal` only, without the zero-area triangles a
// lathe leaves at its poles.
function prepared(three, geometry) {
  const flat = geometry.getIndex() === null ? geometry : geometry.toNonIndexed();
  const position = flat.getAttribute('position').array;
  const normal = flat.getAttribute('normal').array;
  const positions = [];
  const normals = [];
  for (let at = 0; at < position.length; at += 9) {
    const ax = position[at + 3] - position[at];
    const ay = position[at + 4] - position[at + 1];
    const az = position[at + 5] - position[at + 2];
    const bx = position[at + 6] - position[at];
    const by = position[at + 7] - position[at + 1];
    const bz = position[at + 8] - position[at + 2];
    const doubleAreaSquared = (ay * bz - az * by) ** 2 + (az * bx - ax * bz) ** 2 + (ax * by - ay * bx) ** 2;
    if (doubleAreaSquared <= MIN_DOUBLE_AREA_SQUARED) continue;
    for (let k = 0; k < 9; k += 1) {
      positions.push(position[at + k]);
      normals.push(normal[at + k]);
    }
  }
  const part = new three.BufferGeometry();
  part.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  part.setAttribute('normal', new three.Float32BufferAttribute(normals, 3));
  return part;
}

// The mirror image of a prepared part across x = 0, still facing outward: mirroring turns the triangles inside out, so
// the second and third corner of each one swap.
function mirrored(three, part) {
  const copy = part.clone();
  copy.applyMatrix4(new three.Matrix4().makeScale(-1, 1, 1));
  for (const name of ['position', 'normal']) {
    const array = copy.getAttribute(name).array;
    for (let at = 0; at < array.length; at += 9) {
      for (let k = 3; k < 6; k += 1) {
        const second = array[at + k];
        array[at + k] = array[at + k + 3];
        array[at + k + 3] = second;
      }
    }
  }
  return copy;
}

// A box `width` (x) × `depth` (y) × `height` (z) whose bottom face is at `z`.
function box(three, { width, depth, height, x = 0, y = 0, z = 0 }) {
  const geometry = new three.BoxGeometry(width, depth, height);
  geometry.applyMatrix4(translation(three, x, y, z + height / 2));
  return prepared(three, geometry);
}

// A cylinder or cone `length` long around an axis through (x, y, z): along y by default (`front` radius toward +y),
// along x or z for rotors.
function cylinder(three, { front, back = front, length, radial, x = 0, y = 0, z = 0, axis = 'y' }) {
  const geometry = new three.CylinderGeometry(front, back, length, radial, 1, false);
  if (axis === 'z') geometry.applyMatrix4(new three.Matrix4().makeRotationX(Math.PI / 2));
  if (axis === 'x') geometry.applyMatrix4(new three.Matrix4().makeRotationZ(-Math.PI / 2));
  geometry.applyMatrix4(translation(three, x, y, z));
  return prepared(three, geometry);
}

// The leading edge, the trailing edge and the chord of a planform half (root leading, tip leading, tip trailing, root
// trailing) at station x; inside the root the edges run straight in to the axis.
function edgesAt(planform, x) {
  const [rootLeading, tipLeading, tipTrailing, rootTrailing] = planform;
  const along = (from, to) => {
    const share = Math.min(Math.max((x - from[0]) / (to[0] - from[0]), 0), 1);
    return from[1] + (to[1] - from[1]) * share;
  };
  const leading = along(rootLeading, tipLeading);
  const trailing = along(rootTrailing, tipTrailing);
  return { leading, trailing, chord: leading - trailing };
}

// A wing or a tailplane from the right half of its planform: the root is carried in to the axis, so it meets the
// fuselage (or the fin) without a gap; the thickness follows the chord, never thicker than at the root; the dihedral
// lifts the tip about the axis at height z while the projected span stays the planform's (x is stretched by
// 1 / cos(dihedral) before the turn).
function liftingSurface(three, planform, { thickness, dihedralDeg, z }) {
  const [rootLeading, tipLeading, tipTrailing, rootTrailing] = planform;
  const outline = [[0, rootLeading[1]], rootLeading, tipLeading, tipTrailing, rootTrailing, [0, rootTrailing[1]]];
  const rootChord = edgesAt(planform, 0).chord;
  const depth = thickness * rootChord;
  const geometry = new three.ExtrudeGeometry(new three.Shape(outline.map(corner => point2(three, corner))), {
    depth, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const share = Math.min(edgesAt(planform, position.getX(index)).chord / rootChord, 1);
    position.setZ(index, (position.getZ(index) - depth / 2) * share);
  }
  const dihedral = deg(dihedralDeg);
  geometry.applyMatrix4(translation(three, 0, 0, z)
    .multiply(new three.Matrix4().makeRotationY(-dihedral))
    .multiply(new three.Matrix4().makeScale(1 / Math.cos(dihedral), 1, 1)));
  geometry.computeVertexNormals();
  return prepared(three, geometry);
}

// A fin from its side profile (y along the fuselage, z up), extruded across x and centred on x = 0, as thick as a share
// of its chord at each height.
function fin(three, { rootTrailing, rootLeading, tipLeading, tipTrailing, rootZ, tipZ }) {
  const rootChord = rootLeading - rootTrailing;
  const tipChord = tipLeading - tipTrailing;
  const depth = FIN_THICKNESS * rootChord;
  const profile = [[rootTrailing, rootZ], [rootLeading, rootZ], [tipLeading, tipZ], [tipTrailing, tipZ]];
  const geometry = new three.ExtrudeGeometry(new three.Shape(profile.map(corner => point2(three, corner))), {
    depth, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const share = Math.min(Math.max((position.getY(index) - rootZ) / (tipZ - rootZ), 0), 1);
    position.setZ(index, (position.getZ(index) - depth / 2) * ((rootChord + (tipChord - rootChord) * share) / rootChord));
  }
  // The profile's plane (u, v) = (y, z), extruded along w = x: (u, v, w) → (x, y, z) = (w, u, v).
  geometry.applyMatrix4(new three.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.computeVertexNormals();
  return prepared(three, geometry);
}

// The fuselage turned from the outline's half-width (the profile of `profileSpec`), from the tail pole to the nose
// tip, around an axis at axisZ. The tail cone sweeps up: each of its sections rises by what it lost of the radius, so
// the roof stays level to the tail while the underside climbs, and the normals follow the same shear.
function fuselage(three, profileSpec, { axisZ, radial }) {
  const profile = fuselageProfile(profileSpec);
  const [radius, taperStart] = profile[profile.length - 2];
  const [tailRadius, bottom] = profile[profile.length - 1];
  const cone = Array.from({ length: TAIL_CONE_ROWS - 1 }, (_, row) => {
    const y = bottom + ((taperStart - bottom) * (row + 1)) / TAIL_CONE_ROWS;
    return [fuselageHalfWidth(profileSpec, y), y];
  });
  const nose = profile.slice(0, -2).reverse();
  const rows = [[0, bottom], [tailRadius, bottom], ...cone, [radius, taperStart], ...nose];
  const geometry = new three.LatheGeometry(rows.map(row => point2(three, row)), radial, Math.PI);
  const coneSlope = (radius - tailRadius) / (taperStart - bottom);
  const rises = rows.map(([, y]) => (y < taperStart ? radius - fuselageHalfWidth(profileSpec, y) : 0));
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let index = 0; index < position.count; index += 1) {
    const row = index % rows.length;
    position.setZ(index, position.getZ(index) + rises[row] + axisZ);
    if (rows[row][1] < taperStart) {
      const nx = normal.getX(index);
      const ny = normal.getY(index) + coneSlope * normal.getZ(index);
      const nz = normal.getZ(index);
      const length = Math.hypot(nx, ny, nz);
      normal.setXYZ(index, nx / length, ny / length, nz / length);
    }
  }
  return prepared(three, geometry);
}

// The fin of a tail whose tailplane sits on the cone: its trailing edge near the tail, its tip at the height.
function conventionalFin(three, { bottom, length, roofZ, sinkZ, heightM, finTip, finSweep }) {
  const rootTrailing = bottom + 0.015 * length;
  const rise = heightM - roofZ;
  const tipTrailing = Math.max(bottom + 0.002 * length, rootTrailing - rise * Math.tan(deg(FIN_TRAILING_SWEEP)));
  const tipLeading = tipTrailing + finTip * length;
  return fin(three, {
    rootTrailing, rootLeading: tipLeading + rise * Math.tan(deg(finSweep)), tipLeading, tipTrailing, rootZ: sinkZ,
    tipZ: heightM,
  });
}

function tubeParts(three, spec, frame) {
  const L = spec.lengthM;
  const D = spec.fuselageDiaM;
  const R = D / 2;
  const halfSpan = spec.spanM / 2;
  const top = L / 2;
  const bottom = -L / 2;
  const belly = frame.belly * D;
  const axisZ = belly + R;
  const roofZ = belly + D;
  const profile = fuselageProfile(spec);
  const taperStart = profile[profile.length - 2][1];
  const width = y => fuselageHalfWidth(spec, y);
  const axisAt = y => axisZ + (y < taperStart ? R - width(y) : 0);
  const parts = [['fuselage', fuselage(three, spec, { axisZ, radial: frame.radial })]];
  const both = (name, part) => parts.push([name, part], [name, mirrored(three, part)]);

  const wing = wingPlanform(spec);
  const rootThickness = frame.thickness * edgesAt(wing, 0).chord;
  const wingZ = frame.wing === 'high' ? roofZ + 0.1 * rootThickness : belly + 0.2 * D;
  both('wing', liftingSurface(three, wing, { thickness: frame.thickness, dihedralDeg: frame.dihedral, z: wingZ }));
  // The middle plane and the underside of the wing at station x.
  const wingMiddleAt = x => wingZ + x * Math.tan(deg(frame.dihedral));
  const wingUndersideAt = x => wingMiddleAt(x) - (frame.thickness * edgesAt(wing, x).chord) / 2;

  const tailplane = tailplanePlanform(spec);
  const stabRootChord = edgesAt(tailplane, 0).chord;
  const sinkZ = roofZ - SINK * D;
  if (frame.tTail) {
    // The tailplane on top of the fin: its root's upper face at the height, the fin's tip in its middle plane.
    const stabZ = spec.heightM - (frame.thickness * stabRootChord) / 2;
    both('tailplane', liftingSurface(three, tailplane, { thickness: frame.thickness, dihedralDeg: 0, z: stabZ }));
    const [stabLeading, , , stabTrailing] = tailplane;
    parts.push(['fin', fin(three, {
      rootTrailing: bottom + 0.015 * L, rootLeading: stabLeading[1] + (stabZ - roofZ) * Math.tan(deg(frame.finSweep)),
      tipLeading: stabLeading[1], tipTrailing: stabTrailing[1], rootZ: sinkZ, tipZ: stabZ,
    })]);
  } else {
    const stabZ = axisAt((tailplane[0][1] + tailplane[3][1]) / 2);
    both('tailplane', liftingSurface(three, tailplane, { thickness: frame.thickness, dihedralDeg: frame.stabDihedral,
      z: stabZ }));
    parts.push(['fin', conventionalFin(three, { bottom, length: L, roofZ, sinkZ, heightM: spec.heightM,
      finTip: frame.finTip, finSweep: frame.finSweep })]);
  }

  const turboprop = spec.family === 'turbopropHigh' || spec.family === 'turbopropLow';
  const discRadius = (TURBOPROP_DISC * spec.spanM) / 2;
  let nacelleGear = null;
  for (const nacelle of nacelles(spec)) {
    const radius = nacelle.diameterM / 2;
    const middle = (nacelle.frontY + nacelle.backY) / 2;
    let z;
    if (nacelle.mount === 'rear') z = axisAt(middle) + 0.35 * width(middle);
    else if (frame.wing === 'high') z = wingUndersideAt(nacelle.x) - 0.2 * nacelle.diameterM;
    else if (turboprop) z = Math.max(wingMiddleAt(nacelle.x) + 0.2 * nacelle.diameterM, discRadius + 0.15 * D);
    else z = Math.max(wingUndersideAt(nacelle.x) - 0.45 * nacelle.diameterM, 1.25 * radius);
    both('nacelle', cylinder(three, {
      front: radius, back: (turboprop ? 0.6 : 0.8) * radius, length: nacelle.frontY - nacelle.backY,
      radial: frame.nacelleRadial, x: nacelle.x, y: middle, z,
    }));
    if (nacelle.mount === 'rear') {
      // The pylon from inside the fuselage to inside the pod.
      const inner = 0.5 * width(middle);
      const outer = nacelle.x - 0.3 * radius;
      both('pylon', box(three, { width: outer - inner, depth: 0.6 * (nacelle.frontY - nacelle.backY),
        height: 0.5 * radius, x: (inner + outer) / 2, y: middle, z: z - 0.25 * radius }));
    }
    if (turboprop) {
      both('propeller', cylinder(three, { front: discRadius, length: DISC_THICKNESS, radial: 32, x: nacelle.x,
        y: nacelle.frontY - 0.3 * nacelle.diameterM, z }));
    }
    nacelleGear ??= { x: nacelle.x, y: nacelle.backY + 0.3 * (nacelle.frontY - nacelle.backY), z: z - radius };
  }
  if (spec.family === 'pistonSingle') {
    parts.push(['propeller', cylinder(three, { front: (PISTON_DISC * spec.spanM) / 2, length: DISC_THICKNESS, radial: 32,
      y: top - 0.02 * L - DISC_THICKNESS / 2, z: axisZ })]);
  }

  // The gear: a nose leg into the fuselage, two main legs into the wing, the belly or the nacelles.
  const legWidth = 0.08 * D;
  const noseY = top - frame.noseGear * L;
  parts.push(['gear', box(three, { width: legWidth, depth: 0.16 * D, height: axisZ - width(noseY) + SINK * D, y: noseY })]);
  let main;
  if (frame.mainGear === 'nacelle' && nacelleGear !== null) {
    main = { x: nacelleGear.x, y: nacelleGear.y, top: nacelleGear.z + SINK * D };
  } else if (typeof frame.mainGear === 'number') {
    const x = frame.mainGear * halfSpan;
    const { leading, chord } = edgesAt(wing, x);
    main = { x, y: leading - 0.62 * chord, top: wingUndersideAt(x) + SINK * D };
  } else {
    const y = wing[0][1] - 0.6 * edgesAt(wing, 0).chord;
    main = { x: 0.6 * width(y), y, top: axisAt(y) - 0.8 * width(y) + SINK * D };
  }
  both('gear', box(three, { width: 1.4 * legWidth, depth: 0.22 * D, height: main.top, x: main.x, y: main.y }));
  return parts;
}

function dartParts(three, spec) {
  const frame = DART_FRAME;
  const L = spec.lengthM;
  const D = spec.fuselageDiaM;
  const halfSpan = spec.spanM / 2;
  const bottom = -L / 2;
  const belly = frame.belly * D;
  const axisZ = belly + D / 2;
  const roofZ = belly + D;
  const profileSpec = { ...spec, family: frame.fuselageFamily };
  const plateDepth = frame.plate * L;
  const plateUnderside = axisZ - plateDepth / 2;
  const plate = new three.ExtrudeGeometry(new three.Shape(silhouetteOutline(spec).map(corner => point2(three, corner))), {
    depth: plateDepth, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  plate.applyMatrix4(translation(three, 0, 0, plateUnderside));
  const noseY = L / 2 - frame.noseGear * L;
  const mainX = frame.mainGear * halfSpan;
  const mainY = -0.15 * L;
  const parts = [
    ['fuselage', fuselage(three, profileSpec, { axisZ, radial: frame.radial })],
    ['wing', prepared(three, plate)],
    ['fin', conventionalFin(three, { bottom, length: L, roofZ, sinkZ: roofZ - SINK * D, heightM: spec.heightM,
      finTip: frame.finTip, finSweep: frame.finSweep })],
    ['gear', box(three, { width: 0.08 * D, depth: 0.16 * D,
      height: axisZ - fuselageHalfWidth(profileSpec, noseY) + SINK * D, y: noseY })],
  ];
  const main = box(three, { width: 0.11 * D, depth: 0.22 * D, height: plateUnderside + SINK * D, x: mainX, y: mainY });
  parts.push(['gear', main], ['gear', mirrored(three, main)]);
  return parts;
}

// A helicopter from the silhouette's numbers: the cabin around the hub, the boom to the tail, the fin and its small
// tailplane, the tail rotor, the mast, two skids, and the main rotor at the height as the silhouette draws it: two
// blades of the span's length, along and across, over a hub. An opaque disc would hide the cabin from above.
function helicopterParts(three, spec) {
  const frame = HELICOPTER_FRAME;
  const L = spec.lengthM;
  const H = spec.heightM;
  const top = L / 2;
  const bottom = -L / 2;
  const halfSpan = spec.spanM / 2;
  const hub = top - halfSpan;
  const blade = 0.045 * spec.spanM;
  const cabin = spec.fuselageDiaM / 2;
  const boom = 0.25 * cabin;
  const cabinFront = Math.min(hub + 0.28 * L, top - 0.5);
  const cabinBack = hub - 0.12 * L;
  const finY = bottom + 0.1 * L;
  const belly = frame.belly * H;
  const tall = frame.cabinTall * cabin;
  const axisZ = belly + tall;
  const roofZ = axisZ + tall;
  const boomZ = axisZ + 0.45 * tall;

  const rows = [
    [0, cabinBack], [0.5 * cabin, cabinBack], [0.85 * cabin, hub - 0.06 * L], [cabin, hub - blade], [cabin, hub + 0.05 * L],
    [0.8 * cabin, hub + 0.12 * L], [0.55 * cabin, (hub + 0.12 * L + cabinFront) / 2], [0.25 * cabin, cabinFront - 0.03 * L],
    [0, cabinFront],
  ];
  const shell = new three.LatheGeometry(rows.map(row => point2(three, row)), frame.radial, Math.PI);
  shell.applyMatrix4(translation(three, 0, 0, axisZ).multiply(new three.Matrix4().makeScale(1, 1, frame.cabinTall)));

  const boomFront = hub - 0.06 * L;
  const boomBack = bottom + 0.03 * L;
  const tailplane = [[boom, finY], [0.11 * spec.spanM, finY], [0.11 * spec.spanM, finY - 0.04 * L], [boom, finY - 0.04 * L]];
  const stabiliser = liftingSurface(three, tailplane, { thickness: 0.12, dihedralDeg: 0, z: boomZ });
  const tailRotor = frame.tailRotor * spec.spanM;
  const discTop = H - DISC_THICKNESS;
  const bladeAt = { height: DISC_THICKNESS, y: hub, z: discTop };
  const skid = box(three, { width: 0.08, depth: 0.3 * L, height: 0.08, x: 1.3 * cabin, y: hub - 0.03 * L });
  const leg = y => box(three, { width: 0.07, depth: 0.07, height: belly, x: 1.25 * cabin, y });
  const legs = [leg(hub - 0.1 * L), leg(hub + 0.06 * L)];
  const crossbar = y => box(three, { width: 2.6 * cabin, depth: 0.07, height: 0.07, y, z: belly - 0.07 });
  return [
    ['cabin', prepared(three, shell)],
    ['boom', cylinder(three, { front: boom, back: 0.7 * boom, length: boomFront - boomBack, radial: 16,
      y: (boomFront + boomBack) / 2, z: boomZ })],
    ['fin', fin(three, { rootTrailing: bottom, rootLeading: bottom + 0.1 * L, tipLeading: bottom + 0.04 * L,
      tipTrailing: bottom, rootZ: boomZ - 0.12 * H, tipZ: boomZ + 0.3 * H })],
    ['tailplane', stabiliser], ['tailplane', mirrored(three, stabiliser)],
    ['tailRotor', cylinder(three, { front: tailRotor, length: DISC_THICKNESS, radial: 24, axis: 'x', x: 1.2 * boom + 0.1,
      y: bottom + tailRotor + 0.01 * L, z: boomZ + 0.1 * H })],
    ['mast', cylinder(three, { front: 0.1 * cabin, length: discTop - (roofZ - 0.1), radial: 12, axis: 'z', y: hub,
      z: (discTop + roofZ - 0.1) / 2 })],
    ['rotor', box(three, { ...bladeAt, width: 2 * blade, depth: spec.spanM })],
    ['rotor', box(three, { ...bladeAt, width: spec.spanM, depth: 2 * blade })],
    ['rotor', cylinder(three, { front: 1.5 * blade, length: 2 * DISC_THICKNESS, radial: 24, axis: 'z', y: hub,
      z: H - DISC_THICKNESS })],
    ['skid', skid], ['skid', mirrored(three, skid)],
    ...legs.flatMap(part => [['gear', part], ['gear', mirrored(three, part)]]),
    ['gear', crossbar(hub - 0.1 * L)], ['gear', crossbar(hub + 0.06 * L)],
  ];
}

function partsOf(three, spec) {
  const family = spec?.family;
  if (family === 'helicopter') return helicopterParts(three, spec);
  if (family === 'dart') return dartParts(three, spec);
  if (typeof family === 'string' && Object.hasOwn(TUBE_FRAMES, family)) return tubeParts(three, spec, TUBE_FRAMES[family]);
  throw new RangeError(`No 3D model for the aircraft family ${String(family)}`);
}

/**
 * The 3D model of an aircraft type (`spec` from aircraft/types.js) as one non-indexed BufferGeometry with `position`
 * and `normal` only, in metres in the frame above, within TRIANGLE_BUDGET. `three` holds the classes it needs
 * (aircraft/aircraft3dChunk.js: THREE_PARTS). `userData.parts` lists the merged parts in order as
 * `{ name, start, count }` in vertices; the names are fuselage, wing, tailplane, fin, nacelle, pylon, propeller, gear,
 * cabin, boom, tailRotor, mast, rotor and skid. An unknown family or a dimension that is not positive throws a
 * RangeError.
 */
export function buildAircraftGeometry(three, spec) {
  for (const key of ['lengthM', 'spanM', 'heightM', 'fuselageDiaM']) {
    if (!(spec?.[key] > 0)) throw new RangeError(`An aircraft model needs a positive ${key}, got ${String(spec?.[key])}`);
  }
  const parts = partsOf(three, spec);
  const merged = three.mergeGeometries(parts.map(([, part]) => part), false);
  if (merged === null) throw new Error(`The parts of the ${spec.family} model could not be merged`);
  let start = 0;
  merged.userData.parts = Object.freeze(parts.map(([name, part]) => {
    const count = part.getAttribute('position').count;
    const entry = Object.freeze({ name, start, count });
    start += count;
    return entry;
  }));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** The triangles of a geometry, indexed or not. */
export function triangleCount(geometry) {
  const index = geometry.getIndex();
  return (index === null ? geometry.getAttribute('position').count : index.count) / 3;
}
