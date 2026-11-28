import { TUBE_FRAMES, buildAircraftGeometry } from './aircraftGeometry';
import { liveryName } from './liveries';
import { fuselageHalfWidth, fuselageProfile, nacelles, tailplanePlanform, wingPlanform } from './silhouette';

// The detailed 3D model of one aircraft (CN-30): the one the map follows, or the one chosen up close. The instanced
// models of aircraft/aircraftGeometry.js stay for everything else (one draw call per type); this one is built per
// aircraft, with its airline's livery (aircraft/liveries.js) painted on generated textures, and costs a dozen draw
// calls. Procedural, like the instanced models, from the same dimensions and planforms (aircraft/types.js,
// aircraft/silhouette.js): an oval fuselage with a drooped nose and an upswept tail cone; lofted wings with an airfoil,
// dihedral, the trailing-edge kink of an airliner and the wingtip of its family (sharklet, blended or split winglet,
// raked tip, small winglet); a lofted tailplane and fin; nacelles with their intake lip, fan and exhaust cone on
// pylons (or on the rear fuselage), propellers for a turboprop; the landing gear with its wheels, shown or hidden; the
// navigation lights, the red beacons and the white strobes. Cockpit and cabin windows, doors, the cheatline, the
// airline's name, its code on the fin and the registration are painted on canvases, never taken from artwork.
//
// `three` is a parameter (aircraft/aircraft3dChunk.js: THREE_PARTS), as for the instanced models; the canvases come
// from `createCanvas(width, height)` (none in Node: the model then wears the livery's plain colours). The frame is the
// instanced models': x to the right, y toward the nose, z up, the wheels on the ground at z = 0.

/** The wingtip of each type: its kind and its height as a share of the span (types.js holds the span with it). */
export const WINGTIPS = Object.freeze({
  A319: 'sharklet', A320: 'sharklet', A321: 'sharklet', A20N: 'sharklet', A21N: 'sharklet', A339: 'sharklet',
  A359: 'sharklet', B737: 'blended', B738: 'blended', B739: 'blended', B752: 'blended', B763: 'blended', B38M: 'split',
  B39M: 'split', B772: 'raked', B77W: 'raked', B788: 'raked', B789: 'raked', A332: 'small', A333: 'small', B744: 'small',
  A388: 'small', E190: 'small', E195: 'small', CRJ9: 'small', CL35: 'small', GLF5: 'small', BCS3: 'none',
  AT76: 'none', DH8D: 'none', B350: 'small', B190: 'none',
});

/** The blades of a turboprop's propeller by type (six on the ATR 72-600 and the Dash 8-400). */
export const PROPELLER_BLADES = Object.freeze({ AT76: 6, DH8D: 6, B350: 4, B190: 4 });

// The winglets: height over the span, cant from the horizontal, the radius of the blend into the wing (share of the
// height), the sweep of the leading edge and the tip chord over the root chord.
const WINGLET_SHAPES = Object.freeze({
  sharklet: { height: 0.068, cantDeg: 78, blend: 0.3, sweepDeg: 38, taper: 0.32 },
  blended: { height: 0.07, cantDeg: 72, blend: 0.55, sweepDeg: 40, taper: 0.3 },
  split: { height: 0.068, cantDeg: 75, blend: 0.25, sweepDeg: 40, taper: 0.28 },
  small: { height: 0.045, cantDeg: 82, blend: 0.05, sweepDeg: 35, taper: 0.4 },
});

// Wheels: the main wheel's radius over the fuselage diameter by size, and the nose wheel's over the main one.
const WHEEL = Object.freeze({ narrow: 0.145, wide: 0.12, nose: 0.62, minM: 0.28, maxM: 0.72 });
// The fuselage's section is this much taller than wide; the nose drops its tip this share of the radius below the axis;
// the tail cone's roof drops this share of what the cone loses of its radius.
const SECTION_TALL = 1.04;
const NOSE_DROOP = 0.42;
const TAIL_ROOF_DROP = 0.1;
// The textures: the fuselage's two sides stacked (crown to belly each), the fin's two sides side by side.
export const FUSELAGE_TEXTURE = Object.freeze({ width: 2048, height: 512 });
export const TAIL_TEXTURE = Object.freeze({ width: 1024, height: 512 });

/** The blink of the beacons and strobes (ms): a beacon flashes every second, a strobe twice every 1.2 s. */
export const BLINK = Object.freeze({
  beaconPeriodMs: 1000, beaconOnMs: 120,
  strobePeriodMs: 1200, strobeFlashes: Object.freeze([[0, 60], [160, 220]]),
});

const SEGMENTS = Object.freeze({ fuselage: 40, nacelle: 28, wheel: 18, airfoil: 12 });
const deg = value => (value * Math.PI) / 180;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The size of an airframe for its wheels and gear: wide bodies have bogies. */
const isWide = spec => spec.iconCategory === 'wide2' || spec.iconCategory === 'heavy4';

/** How many wheels each main gear leg carries: two on a narrow body, four on a wide one, six on a 777. */
export function mainWheelsOf(code, spec) {
  if (code === 'B772' || code === 'B77W') return 6;
  return isWide(spec) ? 4 : 2;
}

// ---------------------------------------------------------------------------------------------------------- geometry

// A geometry without an index, with `position`, `normal` and, when `uv` is true and it has one, `uv`.
function flat(three, geometry, { uv = false } = {}) {
  const source = geometry.getIndex() === null ? geometry : geometry.toNonIndexed();
  const part = new three.BufferGeometry();
  part.setAttribute('position', new three.Float32BufferAttribute(Array.from(source.getAttribute('position').array), 3));
  part.setAttribute('normal', new three.Float32BufferAttribute(Array.from(source.getAttribute('normal').array), 3));
  if (uv && source.getAttribute('uv')) {
    part.setAttribute('uv', new three.Float32BufferAttribute(Array.from(source.getAttribute('uv').array), 2));
  }
  return part;
}

// The mirror image of a part across x = 0, still facing outward (the corners of each triangle swap).
function mirrored(three, part) {
  const copy = part.clone();
  copy.applyMatrix4(new three.Matrix4().makeScale(-1, 1, 1));
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = copy.getAttribute(name);
    if (!attribute) continue;
    const size = attribute.itemSize;
    const array = attribute.array;
    for (let at = 0; at < array.length; at += 3 * size) {
      for (let k = 0; k < size; k += 1) {
        const second = array[at + size + k];
        array[at + size + k] = array[at + 2 * size + k];
        array[at + 2 * size + k] = second;
      }
    }
  }
  return copy;
}

const translate = (three, x, y, z) => new three.Matrix4().makeTranslation(x, y, z);

function cylinder(three, { radius, back = radius, length, x = 0, y = 0, z = 0, axis = 'y', segments = 16 }) {
  const geometry = new three.CylinderGeometry(radius, back, length, segments, 1, false);
  if (axis === 'x') geometry.applyMatrix4(new three.Matrix4().makeRotationZ(-Math.PI / 2));
  if (axis === 'z') geometry.applyMatrix4(new three.Matrix4().makeRotationX(Math.PI / 2));
  geometry.applyMatrix4(translate(three, x, y, z));
  return flat(three, geometry);
}

function box(three, { width, depth, height, x = 0, y = 0, z = 0 }) {
  const geometry = new three.BoxGeometry(width, depth, height);
  geometry.applyMatrix4(translate(three, x, y, z));
  return flat(three, geometry);
}

// A NACA four-digit symmetric half thickness at x (0 to 1 of the chord) for a thickness ratio t, closed trailing edge.
const halfThickness = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3
  - 0.1036 * x ** 4);

/**
 * A lifting surface lofted through `stations` (`{ lead: [x, y, z], chord, thickness, span: [sx, sz] }`: the leading
 * edge, the chord running toward −y, the thickness ratio and the direction the surface spans in the x–z plane), with an
 * airfoil of `upper` and `lower` shares of the symmetric thickness, a cap on its last station. Outward normals.
 */
function loft(three, stations, { upper = 1.1, lower = 0.9, points = SEGMENTS.airfoil, capEnd = true } = {}) {
  const xs = Array.from({ length: points + 1 }, (_, k) => 0.5 * (1 - Math.cos((Math.PI * k) / points)));
  // The ring: the upper surface from the leading to the trailing edge, then the lower one back.
  const ring = [...xs.map(x => [x, upper]), ...xs.slice(1, -1).reverse().map(x => [x, -lower])];
  const size = ring.length;
  const positions = [];
  for (const station of stations) {
    const [sx, sz] = station.span;
    const normal = [-sz, sx];
    for (const [x, side] of ring) {
      const offset = side * station.chord * halfThickness(x, station.thickness);
      positions.push(station.lead[0] + normal[0] * offset, station.lead[1] - station.chord * x,
        station.lead[2] + normal[1] * offset);
    }
  }
  const index = [];
  for (let s = 0; s < stations.length - 1; s += 1) {
    for (let k = 0; k < size; k += 1) {
      const a = s * size + k;
      const b = s * size + ((k + 1) % size);
      const c = (s + 1) * size + k;
      const d = (s + 1) * size + ((k + 1) % size);
      index.push(a, c, b, b, c, d);
    }
  }
  if (capEnd) {
    const last = stations[stations.length - 1];
    const centre = positions.length / 3;
    positions.push(last.lead[0], last.lead[1] - last.chord * 0.4, last.lead[2]);
    const base = (stations.length - 1) * size;
    for (let k = 0; k < size; k += 1) index.push(base + k, centre, base + ((k + 1) % size));
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  // The upper surface must face along the station's normal: flip the winding when it does not.
  const p = i => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const k = Math.floor(points / 2);
  const [a, b, c] = [p(k), p(size + k), p(k + 1)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const [sx, sz] = stations[0].span;
  if (face[0] * -sz + face[2] * sx < 0) {
    for (let at = 0; at < index.length; at += 3) [index[at + 1], index[at + 2]] = [index[at + 2], index[at + 1]];
    geometry.setIndex(index);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// The leading edge, the trailing edge and the chord of a planform half at station x (straight between its corners).
function edgesAt(planform, x) {
  const [rootLeading, tipLeading, tipTrailing, rootTrailing] = planform;
  const along = (from, to) => from[1] + (to[1] - from[1]) * clamp((x - from[0]) / (to[0] - from[0]), 0, 1);
  const leading = along(rootLeading, tipLeading);
  const trailing = along(rootTrailing, tipTrailing);
  return { leading, trailing, chord: leading - trailing };
}

// ---------------------------------------------------------------------------------------------------------- airframe

/** Everything of the airframe that two parts share: its frame, its heights and where its parts stand. */
function airframeOf(spec) {
  const frame = TUBE_FRAMES[spec.family];
  const L = spec.lengthM;
  const D = spec.fuselageDiaM;
  const R = D / 2;
  const top = L / 2;
  const bottom = -L / 2;
  const belly = frame.belly * D;
  const axisZ = belly + SECTION_TALL * R;
  const profile = fuselageProfile(spec);
  const taperStart = profile[profile.length - 2][1];
  const noseEnd = profile[profile.length - 3][1];
  const width = y => fuselageHalfWidth(spec, y);
  const rise = y => (y < taperStart ? (1 - TAIL_ROOF_DROP) * (R - width(y)) : 0);
  const droop = y => (y > noseEnd ? -NOSE_DROOP * R * (1 - width(y) / R) : 0);
  const axisAt = y => axisZ + rise(y) + droop(y);
  const roofAt = y => axisAt(y) + SECTION_TALL * width(y);
  const floorAt = y => axisAt(y) - SECTION_TALL * width(y);
  return { frame, L, D, R, top, bottom, belly, axisZ, taperStart, noseEnd, width, axisAt, roofAt, floorAt };
}

// The fuselage as two half lathes (right, then left), so each side carries its own half of the texture: u along the
// body (toward the nose on the right side, toward the tail on the left, so words read on both), v around it.
function fuselageGeometry(three, spec, air) {
  const { L, bottom, top, taperStart, noseEnd, width } = air;
  const ys = new Set([bottom, taperStart, noseEnd, top]);
  for (let k = 1; k < 16; k += 1) ys.add(bottom + ((taperStart - bottom) * k) / 16);
  for (let k = 1; k < 6; k += 1) ys.add(taperStart + ((noseEnd - taperStart) * k) / 6);
  for (let k = 1; k < 22; k += 1) ys.add(noseEnd + (top - noseEnd) * (1 - (1 - k / 22) ** 1.6));
  const rows = [...ys].sort((a, b) => a - b).map(y => [y >= top ? 0 : width(y), y]);
  rows.unshift([0, bottom]);
  const halves = [];
  for (const [phiStart, right] of [[0, true], [Math.PI, false]]) {
    const geometry = new three.LatheGeometry(rows.map(([r, y]) => new three.Vector2(r, y)), SEGMENTS.fuselage / 2,
      phiStart, Math.PI);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let index = 0; index < position.count; index += 1) {
      const row = index % rows.length;
      const segment = Math.floor(index / rows.length);
      const phi = phiStart + (Math.PI * segment) / (SEGMENTS.fuselage / 2);
      const [r, y] = rows[row];
      position.setXYZ(index, r * Math.sin(phi), y, air.axisAt(y) + SECTION_TALL * r * Math.cos(phi));
      const along = (y - bottom) / L;
      const around = (Math.cos(phi) + 1) / 2;
      uv.setXY(index, right ? along : 1 - along, right ? 0.5 + 0.5 * around : 0.5 * around);
    }
    geometry.computeVertexNormals();
    halves.push(flat(three, geometry, { uv: true }));
  }
  return three.mergeGeometries(halves, false);
}

// The wing's stations: root inside the fuselage, the kink of an airliner's trailing edge, the tip and its wingtip.
function wingParts(three, spec, air, code) {
  const { frame, R } = air;
  const planform = wingPlanform(spec);
  const halfSpan = spec.spanM / 2;
  const tip = WINGTIPS[code] ?? (spec.family === 'twinUnderwing' || spec.family === 'quadUnderwing' ? 'small' : 'none');
  const winglet = WINGLET_SHAPES[tip] ?? null;
  const wingletHeight = winglet ? winglet.height * spec.spanM : 0;
  // The winglet leans out: the wing ends short of the span by what the winglet and its blend reach sideways.
  const reach = winglet ? wingletHeight * (Math.cos(deg(winglet.cantDeg)) + winglet.blend * 0.4) : 0;
  const tipX = halfSpan - reach;
  const turboprop = spec.family === 'turbopropHigh' || spec.family === 'turbopropLow';
  const rootThickness = turboprop ? 0.17 : 0.145;
  const tipThickness = turboprop ? 0.13 : 0.105;
  const dihedral = deg(frame.dihedral);
  const rootChord = edgesAt(planform, 0).chord;
  const wingZ = frame.wing === 'high' ? air.roofAt(planform[0][1]) - 0.25 * rootThickness * rootChord
    : air.belly + 0.22 * air.D;
  const kinked = !turboprop && (spec.family === 'twinUnderwing' || spec.family === 'quadUnderwing');
  const kinkX = R + 0.33 * (halfSpan - R);
  const trailingAt = x => {
    if (kinked && x < kinkX) return edgesAt(planform, kinkX).trailing;
    return edgesAt(planform, x).trailing;
  };
  const station = (x, { chordScale = 1, leadShift = 0 } = {}) => {
    const leading = edgesAt(planform, x).leading - leadShift;
    const chord = (leading + leadShift - trailingAt(x)) * chordScale;
    const share = clamp(x / halfSpan, 0, 1);
    return {
      lead: [x, leading, wingZ + x * Math.tan(dihedral)], chord,
      thickness: rootThickness + (tipThickness - rootThickness) * share, span: [Math.cos(dihedral), Math.sin(dihedral)],
    };
  };
  const xs = [0, 0.7 * R, R, kinked ? kinkX : (R + tipX) / 2, ...[0.5, 0.65, 0.8, 0.92].map(s => R + s * (tipX - R)), tipX];
  const stations = [...new Set(xs)].sort((a, b) => a - b).map(x => station(x));
  if (tip === 'raked') {
    // A raked tip: the last tenth of the span sweeps its leading edge back and narrows to a point-like tip.
    const last = stations[stations.length - 1];
    const before = station(halfSpan - 0.1 * halfSpan);
    stations.splice(stations.length - 1, 1, before, {
      ...last, lead: [last.lead[0], last.lead[1] - 0.55 * last.chord, last.lead[2]], chord: 0.4 * last.chord,
    });
  }
  const parts = [loft(three, stations, { capEnd: winglet === null })];
  const tipStation = stations[stations.length - 1];
  let wingletTop = null;
  if (winglet) {
    // The blend turns the surface from the wing's dihedral up to the winglet's cant over a few stations, then the
    // winglet rises straight to its tip, swept back and narrowing.
    const blendR = Math.max(0.05, winglet.blend * wingletHeight);
    const start = Math.atan2(tipStation.span[1], tipStation.span[0]);
    const end = deg(winglet.cantDeg);
    const sections = [tipStation];
    let point = [...tipStation.lead];
    const steps = 4;
    for (let k = 1; k <= steps; k += 1) {
      const angle = start + ((end - start) * k) / steps;
      const arc = (blendR * (end - start)) / steps;
      point = [point[0] + arc * Math.cos(angle), point[1] - arc * Math.tan(deg(winglet.sweepDeg)) * 0.5,
        point[2] + arc * Math.sin(angle)];
      sections.push({ lead: [...point], chord: tipStation.chord * (1 - (0.25 * k) / steps), thickness: 0.1,
        span: [Math.cos(angle), Math.sin(angle)] });
    }
    const rest = Math.max(0.1, wingletHeight - blendR * (end - start));
    const tipLead = [point[0] + rest * Math.cos(end), point[1] - rest * Math.tan(deg(winglet.sweepDeg)),
      point[2] + rest * Math.sin(end)];
    sections.push({ lead: tipLead, chord: tipStation.chord * winglet.taper, thickness: 0.09,
      span: [Math.cos(end), Math.sin(end)] });
    parts.push(loft(three, sections));
    wingletTop = tipLead;
    if (tip === 'split') {
      // The 737 MAX's lower blade: down and out under the tip.
      const down = deg(-58);
      const lowerLength = 0.032 * spec.spanM;
      parts.push(loft(three, [
        { ...tipStation, chord: tipStation.chord * 0.7, span: [Math.cos(down), Math.sin(down)] },
        { lead: [tipStation.lead[0] + lowerLength * Math.cos(down), tipStation.lead[1] - 0.25 * tipStation.chord,
          tipStation.lead[2] + lowerLength * Math.sin(down)], chord: tipStation.chord * 0.3, thickness: 0.09,
        span: [Math.cos(down), Math.sin(down)] },
      ]));
    }
  }
  const wing = three.mergeGeometries(parts.map(part => flat(three, part)), false);
  const middleAt = x => wingZ + x * Math.tan(dihedral);
  const chordAt = x => edgesAt(planform, x).leading - trailingAt(x);
  const thicknessAt = x => rootThickness + (tipThickness - rootThickness) * clamp(x / halfSpan, 0, 1);
  return {
    geometry: wing,
    tip: { x: tipStation.lead[0], y: tipStation.lead[1] - 0.35 * tipStation.chord, z: tipStation.lead[2],
      wingletTop, kind: tip },
    undersideAt: x => middleAt(x) - 0.45 * thicknessAt(x) * chordAt(x),
    leadingAt: x => edgesAt(planform, x).leading,
    chordAt,
  };
}

function tailParts(three, spec, air) {
  const { frame, L, D, bottom } = air;
  const planform = tailplanePlanform(spec);
  const stabRoot = edgesAt(planform, 0);
  const sink = 0.06 * D;
  let stabZ;
  const finRootTrailing = bottom + 0.012 * L;
  const roofAtFin = air.roofAt(finRootTrailing + 0.02 * L);
  let finProfile;
  if (frame.tTail) {
    stabZ = spec.heightM - 0.06 * stabRoot.chord;
    const [stabLeading, , , stabTrailing] = planform;
    finProfile = {
      rootTrailing: finRootTrailing, rootLeading: stabLeading[1] + (stabZ - roofAtFin) * Math.tan(deg(frame.finSweep)),
      tipLeading: stabLeading[1] + 0.05 * stabRoot.chord, tipTrailing: stabTrailing[1] + 0.05 * stabRoot.chord,
      rootZ: roofAtFin - sink, tipZ: stabZ,
    };
  } else {
    stabZ = air.axisAt((planform[0][1] + planform[3][1]) / 2) + 0.05 * D;
    const rise = spec.heightM - roofAtFin;
    const tipTrailing = Math.max(bottom + 0.004 * L, finRootTrailing - rise * Math.tan(deg(15)));
    const tipLeading = tipTrailing + frame.finTip * L;
    finProfile = {
      rootTrailing: finRootTrailing, rootLeading: tipLeading + rise * Math.tan(deg(frame.finSweep)), tipLeading,
      tipTrailing, rootZ: roofAtFin - sink, tipZ: spec.heightM,
    };
  }
  const stabDihedral = deg(frame.tTail ? 0 : frame.stabDihedral);
  const halfSpan = planform[1][0];
  const stabStations = [0, 0.35, 0.7, 1].map(share => {
    const x = share * halfSpan;
    const edges = edgesAt(planform, x);
    return { lead: [x, edges.leading, stabZ + x * Math.tan(stabDihedral)], chord: edges.chord,
      thickness: 0.11 - 0.02 * share, span: [Math.cos(stabDihedral), Math.sin(stabDihedral)] };
  });
  const stab = flat(three, loft(three, stabStations, { upper: 1, lower: 1 }));
  const tailplane = three.mergeGeometries([stab, mirrored(three, stab)], false);

  // The fin, vertical: its stations climb from inside the tail cone to its tip.
  const { rootTrailing, rootLeading, tipLeading, tipTrailing, rootZ, tipZ } = finProfile;
  const finStations = [0, 0.3, 0.65, 1].map(share => {
    const lead = rootLeading + (tipLeading - rootLeading) * share;
    const trail = rootTrailing + (tipTrailing - rootTrailing) * share;
    return { lead: [0, lead, rootZ + (tipZ - rootZ) * share], chord: lead - trail, thickness: 0.11 - 0.02 * share,
      span: [0, 1] };
  });
  const finGeometry = flat(three, loft(three, finStations, { upper: 1, lower: 1 }), {});
  // The fin's texture: the right side on the left half, the left side on the right half, each with u along the chord
  // toward the nose on its own side, so the code reads on both.
  const yMin = Math.min(rootTrailing, tipTrailing);
  const yMax = Math.max(rootLeading, tipLeading);
  const position = finGeometry.getAttribute('position');
  const normal = finGeometry.getAttribute('normal');
  const uvs = new Float32Array(2 * position.count);
  for (let at = 0; at < position.count; at += 3) {
    const right = normal.getX(at) + normal.getX(at + 1) + normal.getX(at + 2) >= 0;
    for (let k = 0; k < 3; k += 1) {
      const u = (position.getY(at + k) - yMin) / (yMax - yMin);
      const v = clamp((position.getZ(at + k) - rootZ) / (tipZ - rootZ), 0, 1);
      uvs[2 * (at + k)] = right ? 0.5 * u : 1 - 0.5 * u;
      uvs[2 * (at + k) + 1] = v;
    }
  }
  finGeometry.setAttribute('uv', new three.Float32BufferAttribute(uvs, 2));
  const shape = {
    // Where the fin's leading and trailing edges are, in its u (0 to 1 of its chord range), at a height v (0 to 1).
    leading: v => (rootLeading + (tipLeading - rootLeading) * v - yMin) / (yMax - yMin),
    trailing: v => (rootTrailing + (tipTrailing - rootTrailing) * v - yMin) / (yMax - yMin),
    chordRangeM: yMax - yMin, heightM: tipZ - rootZ,
  };
  return {
    tailplane, fin: finGeometry, shape, finTop: { y: tipTrailing + 0.1 * (tipLeading - tipTrailing), z: tipZ },
    tailTip: { y: bottom, z: air.axisAt(bottom + 0.01 * L) },
  };
}

// A turbofan nacelle around the y axis, its front at `frontY`: the skin with its intake lip, the dark fan and intake,
// the exhaust cone. Three geometries, merged later per material.
function turbofan(three, { x, z, frontY, lengthM, radius }) {
  const backY = frontY - lengthM;
  const skin = [
    [0.62 * radius, backY + 0.02 * lengthM], [0.72 * radius, backY + 0.08 * lengthM], [0.9 * radius, backY + 0.3 * lengthM],
    [radius, backY + 0.62 * lengthM], [0.99 * radius, frontY - 0.08 * lengthM], [0.95 * radius, frontY - 0.015 * lengthM],
    [0.88 * radius, frontY], [0.82 * radius, frontY - 0.01 * lengthM], [0.8 * radius, frontY - 0.06 * lengthM],
  ];
  const fan = [[0.8 * radius, frontY - 0.06 * lengthM], [0.78 * radius, frontY - 0.13 * lengthM],
    [0.22 * radius, frontY - 0.14 * lengthM], [0.2 * radius, frontY - 0.12 * lengthM], [0.06 * radius, frontY - 0.06 * lengthM],
    [0, frontY - 0.045 * lengthM]];
  const exhaust = [[0, backY - 0.18 * lengthM], [0.18 * radius, backY - 0.12 * lengthM], [0.38 * radius, backY],
    [0.46 * radius, backY + 0.06 * lengthM], [0.6 * radius, backY + 0.05 * lengthM], [0.62 * radius, backY + 0.02 * lengthM]];
  const turned = (rows, reverse) => {
    const ordered = reverse ? [...rows].reverse() : rows;
    const geometry = new three.LatheGeometry(ordered.map(([r, y]) => new three.Vector2(r, y)), SEGMENTS.nacelle);
    geometry.computeVertexNormals();
    geometry.applyMatrix4(translate(three, x, 0, z));
    return flat(three, geometry);
  };
  // A lathe's normal faces outward while its rows run toward +y and forward while they run toward the axis: the skin
  // folds back into the intake, the fan face runs inward to its spinner.
  return { skin: turned(skin, false), dark: turned(fan, false), metal: turned(exhaust, false) };
}

// A turboprop nacelle: long, with its spinner in front and the propeller's blades on a hub that turns.
function turboprop(three, { x, z, frontY, lengthM, radius }) {
  const backY = frontY - lengthM;
  const skin = [[0.05 * radius, backY], [0.45 * radius, backY + 0.12 * lengthM], [0.95 * radius, backY + 0.55 * lengthM],
    [radius, backY + 0.8 * lengthM], [0.78 * radius, frontY - 0.03 * lengthM], [0.55 * radius, frontY]];
  const spinner = [[0.55 * radius, frontY], [0.5 * radius, frontY + 0.05 * lengthM], [0.3 * radius, frontY + 0.11 * lengthM],
    [0, frontY + 0.15 * lengthM]];
  const turned = rows => {
    const geometry = new three.LatheGeometry(rows.map(([r, y]) => new three.Vector2(r, y)), SEGMENTS.nacelle);
    geometry.computeVertexNormals();
    geometry.applyMatrix4(translate(three, x, 0, z));
    return flat(three, geometry);
  };
  return { skin: turned(skin), spinner: turned(spinner), hub: { x, y: frontY + 0.04 * lengthM, z } };
}

// The blades of a propeller around its hub (its own origin): `blades` thin twisted blades of `radius`.
function propellerGeometry(three, { blades, radius }) {
  const parts = [];
  for (let k = 0; k < blades; k += 1) {
    const blade = new three.BoxGeometry(0.06 * radius + 0.12, 0.05, radius * 0.92);
    blade.applyMatrix4(translate(three, 0, 0, radius * 0.5));
    blade.applyMatrix4(new three.Matrix4().makeRotationZ(deg(18)));
    blade.applyMatrix4(new three.Matrix4().makeRotationY((2 * Math.PI * k) / blades));
    parts.push(flat(three, blade));
  }
  return three.mergeGeometries(parts, false);
}

// The landing gear: the nose leg with two wheels and the main legs, on bogies for a wide body, each wheel on the ground.
function gearParts(three, spec, air, wing, code) {
  const { frame, D, L, top } = air;
  const wide = isWide(spec);
  const main = clamp((wide ? WHEEL.wide : WHEEL.narrow) * D, WHEEL.minM, WHEEL.maxM);
  const nose = main * WHEEL.nose;
  const metal = [];
  const tyres = [];
  const wheel = (x, y, radius) => tyres.push(cylinder(three, { radius, length: 0.32 * radius + 0.1, x, y, z: radius,
    axis: 'x', segments: SEGMENTS.wheel }));
  // The nose leg.
  const noseY = top - frame.noseGear * L;
  const noseTop = air.floorAt(noseY) + 0.05 * D;
  metal.push(cylinder(three, { radius: 0.03 * D + 0.03, length: noseTop - nose, y: noseY, z: (noseTop + nose) / 2,
    axis: 'z', segments: 10 }));
  for (const side of [-1, 1]) wheel(side * (0.045 * D + 0.1), noseY, nose);
  // The main legs, under the wing or under the fuselage (a high wing).
  const legs = [];
  if (typeof frame.mainGear === 'number') {
    const x = frame.mainGear * (spec.spanM / 2);
    const y = wing.leadingAt(x) - 0.62 * wing.chordAt(x);
    legs.push({ x, y, top: wing.undersideAt(x) + 0.05 * D });
  } else {
    const y = -0.04 * L;
    legs.push({ x: 0.75 * air.R, y, top: air.floorAt(y) + 0.1 * D });
  }
  if (spec.family === 'quadUnderwing') {
    // The body gear of a 747 or an A380, under the fuselage behind the wing gear.
    legs.push({ x: 0.28 * D, y: legs[0].y - 0.06 * L, top: air.floorAt(legs[0].y) + 0.05 * D });
  }
  const wheels = mainWheelsOf(code, spec);
  for (const leg of legs) {
    for (const side of [-1, 1]) {
      const x = side * leg.x;
      metal.push(cylinder(three, { radius: 0.035 * D + 0.04, length: leg.top - main, x, y: leg.y, z: (leg.top + main) / 2,
        axis: 'z', segments: 10 }));
      const rows = wheels / 2;
      const pitch = 2.3 * main;
      for (let row = 0; row < rows; row += 1) {
        const y = leg.y + (row - (rows - 1) / 2) * pitch;
        for (const across of [-1, 1]) wheel(x + across * (0.28 * main + 0.12), y, main);
      }
      if (rows > 1) {
        metal.push(box(three, { width: 0.12, depth: (rows - 1) * pitch + 0.3, height: 0.14, x, y: leg.y, z: main }));
      }
    }
  }
  return {
    metal: three.mergeGeometries(metal, false), tyres: three.mergeGeometries(tyres, false), mainWheelM: main,
    pivotY: legs[0].y,
  };
}

/**
 * The landing gear of a type on its own (PR M5), for a 3D model that has none (public/models/aircraft/manifest.json:
 * `hasGear: false`): `{ metal, tyres, mainWheelM, pivotY }`, the legs and the tyres as two geometries in the models'
 * frame, the wheels on the ground at z = 0, sized and placed from the type's dimensions as the detailed model's own
 * gear; null for a family without a tube (helicopters, light singles, the dart).
 */
export function buildGearGeometry(three, spec, code = null) {
  if (!(spec?.lengthM > 0) || !(spec?.spanM > 0) || !(spec?.fuselageDiaM > 0)) return null;
  if (!Object.hasOwn(TUBE_FRAMES, spec.family) || spec.family === 'pistonSingle') return null;
  const air = airframeOf(spec);
  const wing = wingParts(three, spec, air, code);
  const gear = gearParts(three, spec, air, wing, code);
  wing.geometry.dispose();
  return gear;
}

// --------------------------------------------------------------------------------------------------------- textures

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * Paints a fuselage texture (FUSELAGE_TEXTURE): the right side on the upper half, the left side on the lower half,
 * each from the crown (its top row) to the belly; along the body toward the nose on the right side and toward the tail
 * on the left. The livery's body and belly colours, its cheatlines, the cabin windows and the doors, the cockpit
 * windows, the airline's name and the registration near the tail. Pure drawing on the given 2D context.
 */
export function paintFuselage(context, { width, height, livery, registration = null, spec, wingRootAlong = 0.6 }) {
  const panel = height / 2;
  const L = spec.lengthM;
  const R = spec.fuselageDiaM / 2;
  // Metres per pixel along the body and around it (the side of the half circumference).
  const along = L / width;
  const around = (Math.PI * R * SECTION_TALL) / panel;
  // A height on the side (−1 belly to 1 crown, the cosine of the angle around the body) as a row of the panel.
  const rowOf = c => ((1 - c) / 2) * panel;
  const name = liveryName(livery);
  for (const right of [true, false]) {
    const offset = right ? 0 : panel;
    const xOf = a => (right ? a : 1 - a) * width;
    context.save();
    context.beginPath();
    context.rect(0, offset, width, panel);
    context.clip();
    context.fillStyle = livery.fuselage;
    context.fillRect(0, offset, width, panel);
    context.fillStyle = livery.belly;
    context.fillRect(0, offset + rowOf(-0.22), width, panel - rowOf(-0.22));
    if (livery.cheatline) {
      context.fillStyle = livery.cheatline;
      context.fillRect(0, offset + rowOf(-0.05), width, rowOf(-0.2) - rowOf(-0.05));
    }
    if (livery.cheatline2) {
      context.fillStyle = livery.cheatline2;
      context.fillRect(0, offset + rowOf(-0.22), width, rowOf(-0.34) - rowOf(-0.22));
    }
    // Cabin windows: about 0.25 m × 0.36 m every 0.53 m, from behind the forward door to before the aft one.
    const windowRow = offset + rowOf(0.3);
    const windowH = 0.36 / around;
    const windowW = 0.25 / along;
    const pitch = 0.53 / along;
    context.fillStyle = '#1b222b';
    const doors = [0.875, 0.115];
    const exits = [wingRootAlong - 0.07, wingRootAlong - 0.03];
    for (let a = 0.15; a < 0.86; a += pitch / width) {
      if (doors.some(door => Math.abs(a - door) < 0.025) || exits.some(exit => Math.abs(a - exit) < 0.01)) continue;
      roundedRect(context, xOf(a) - windowW / 2, windowRow - windowH / 2, windowW, windowH, windowW * 0.45);
      context.fill();
    }
    // Doors and over-wing exits: outlines.
    context.strokeStyle = 'rgba(30, 38, 48, 0.55)';
    context.lineWidth = 2;
    for (const door of doors) {
      const w = 0.82 / along;
      const h = 1.85 / around;
      roundedRect(context, xOf(door) - w / 2, offset + rowOf(0.48), w, h, w * 0.12);
      context.stroke();
    }
    for (const exit of exits) {
      const w = 0.5 / along;
      const h = 0.95 / around;
      roundedRect(context, xOf(exit) - w / 2, offset + rowOf(0.42), w, h, w * 0.15);
      context.stroke();
    }
    // The cockpit windows: four dark panes over the nose, the front pair raked.
    context.fillStyle = '#141a21';
    const paneTop = offset + rowOf(0.66);
    const paneBottom = offset + rowOf(0.38);
    const panes = [[0.944, 0.954], [0.932, 0.942], [0.92, 0.93]];
    for (const [from, to] of panes) {
      context.beginPath();
      context.moveTo(xOf(from), paneBottom);
      context.lineTo(xOf(to), paneBottom);
      context.lineTo(xOf(to - 0.002), paneTop);
      context.lineTo(xOf(from + 0.002), paneTop);
      context.closePath();
      context.fill();
    }
    // The airline's name above the windows, ahead of the wing, set in our own type: compensated for the texture's
    // metres per pixel so the letters keep their shape on the body.
    if (name !== '') {
      const letterM = Math.min(1.8, 0.42 * spec.fuselageDiaM);
      const rows = letterM / around;
      context.save();
      context.translate(xOf(0.47), offset + rowOf(0.6));
      context.scale(around / along, 1);
      context.font = `800 ${Math.round(rows)}px ${FONT}`;
      context.textBaseline = 'middle';
      context.textAlign = right ? 'left' : 'right';
      context.fillStyle = livery.text;
      // On the left side the name still runs from 0.47 of the body toward the nose: drawn from its right end.
      context.fillText(name, 0, 0);
      context.restore();
    }
    if (registration) {
      const rows = 0.42 / around;
      context.save();
      context.translate(xOf(0.1), offset + rowOf(0.36));
      context.scale(around / along, 1);
      context.font = `700 ${Math.round(rows)}px ${FONT}`;
      context.textBaseline = 'middle';
      context.textAlign = 'center';
      context.fillStyle = livery.fuselage === livery.text ? '#1d2833' : livery.text;
      context.fillText(registration, 0, 0);
      context.restore();
    }
    context.restore();
  }
}

/**
 * Paints a fin texture (TAIL_TEXTURE): the right side on the left half and the left side on the right half, each with
 * u along the chord toward the nose of its side and v up the fin: the livery's fin colour, its accent swept across the
 * lower trailing corner and the airline's IATA code (or the owner's licensed logo, `logo`) at the fin's middle.
 */
export function paintTail(context, { width, height, livery, shape, logo = null }) {
  const half = width / 2;
  const sx = shape.chordRangeM / half;
  const sy = shape.heightM / height;
  for (const right of [true, false]) {
    const x0 = right ? 0 : half;
    const xOf = u => (right ? u : 1 - u) * half + x0;
    const yOf = v => (1 - v) * height;
    context.save();
    context.beginPath();
    context.rect(x0, 0, half, height);
    context.clip();
    context.fillStyle = livery.tail;
    context.fillRect(x0, 0, half, height);
    if (livery.tailAccent) {
      context.fillStyle = livery.tailAccent;
      context.beginPath();
      context.moveTo(xOf(shape.trailing(0) - 0.05), yOf(0));
      context.lineTo(xOf(shape.leading(0) * 0.55 + shape.trailing(0) * 0.45), yOf(0));
      context.lineTo(xOf(shape.trailing(0.55) + 0.02), yOf(0.55));
      context.lineTo(xOf(shape.trailing(0.55) - 0.05), yOf(0.55));
      context.closePath();
      context.fill();
    }
    const v = 0.55;
    const middle = (shape.leading(v) + shape.trailing(v)) / 2;
    if (logo) {
      const size = 0.42 * shape.heightM;
      const w = size / sx;
      const h = size / sy;
      context.drawImage(logo, xOf(middle) - w / 2, yOf(v) - h / 2, w, h);
    } else if (livery.iata) {
      const letterM = 0.3 * shape.heightM;
      context.save();
      context.translate(xOf(middle), yOf(v));
      context.scale(sy / sx, 1);
      context.font = `800 ${Math.round(letterM / sy)}px ${FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = livery.tailText;
      context.fillText(livery.iata, 0, 0);
      context.restore();
    }
    context.restore();
  }
}

function canvasTexture(three, createCanvas, { width, height }, paint) {
  const canvas = typeof createCanvas === 'function' ? createCanvas(width, height) : null;
  const context = canvas?.getContext?.('2d') ?? null;
  if (!canvas || !context) return null;
  paint(context);
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  texture.anisotropy = 2;
  return { texture, canvas, context };
}

// ------------------------------------------------------------------------------------------------------------ lights

const LIGHT_COLOURS = Object.freeze({ red: '#ff2a1f', green: '#1fff5a', white: '#ffffff', beacon: '#ff3b2e' });

/** Whether a beacon flashes at `timeMs` (the bottom one half a period after the top one). */
export function beaconOn(timeMs, phase = 0) {
  const t = (((timeMs + phase * BLINK.beaconPeriodMs) % BLINK.beaconPeriodMs) + BLINK.beaconPeriodMs) % BLINK.beaconPeriodMs;
  return t < BLINK.beaconOnMs;
}

/** Whether the strobes flash at `timeMs` (twice in each period). */
export function strobeOn(timeMs) {
  const t = ((timeMs % BLINK.strobePeriodMs) + BLINK.strobePeriodMs) % BLINK.strobePeriodMs;
  return BLINK.strobeFlashes.some(([from, to]) => t >= from && t < to);
}

/** How long until the next blink starts or ends after `timeMs`, for the lights that are on: Infinity for none. */
export function nextBlinkInMs(timeMs, { beacon = false, strobes = false } = {}) {
  const changes = [];
  if (beacon) {
    for (const phase of [0, 0.5]) {
      const t = (((timeMs + phase * BLINK.beaconPeriodMs) % BLINK.beaconPeriodMs) + BLINK.beaconPeriodMs) % BLINK.beaconPeriodMs;
      changes.push(t < BLINK.beaconOnMs ? BLINK.beaconOnMs - t : BLINK.beaconPeriodMs - t);
    }
  }
  if (strobes) {
    const t = ((timeMs % BLINK.strobePeriodMs) + BLINK.strobePeriodMs) % BLINK.strobePeriodMs;
    const edges = [...BLINK.strobeFlashes.flat(), BLINK.strobePeriodMs].filter(edge => edge > t);
    changes.push(Math.min(...edges) - t);
  }
  return changes.length === 0 ? Infinity : Math.max(1, Math.min(...changes));
}

// ------------------------------------------------------------------------------------------------------------- model

/**
 * The key of a detailed aircraft's plain material in a cache of shared materials (buildDetailedAircraft: `materials`):
 * its kind and its options, the same for the same part of the same livery, whatever the aircraft.
 */
export function detailMaterialKey(options, basic = false) {
  const entries = Object.entries(options ?? {}).sort(([a], [b]) => (a < b ? -1 : Number(a > b)));
  return `detail:${basic ? 'basic' : 'standard'}:${JSON.stringify(entries)}`;
}

/**
 * The detailed model of one aircraft: `{ object, gear, lights, propellers, pivot, triangles, drawCalls, textured,
 * setState, refreshLogo, dispose }`.
 * - `spec` from aircraft/types.js, `code` its designator (its wingtip, wheels and propeller blades), `livery` from
 *   aircraft/liveries.js, `registration` painted near the tail, `createCanvas(width, height)` the canvases of the
 *   textures (without one the model wears the livery's colours), `logo` a loaded image for the fin, `night` for brighter
 *   light halos.
 * - `object` is a three Group in the frame of the instanced models; `gear` the landing gear's group; `pivot` `{ y, z }`
 *   where the model pitches (over its main wheels) and banks (its fuselage axis).
 * - `setState({ gearDown, lights: { beacon, strobes }, timeMs, propellerRpm })` shows or hides the gear, blinks the
 *   lights at `timeMs` and turns the propellers.
 * - PR M5: `airframe` `{ meshes, dispose, refreshLogo }` (aircraft/modelAircraft.js) is the type's 3D model in its
 *   livery, drawn instead of the procedural airframe; the gear (the model has none) and the lights stay the app's own.
 * - HOTFIX-3D: `materials(key, make)` answers the shared material of a key (detailMaterialKey), made by `make()` the
 *   first time: the materials without a texture of their own come from it and dispose() leaves them to their cache.
 * A family without a tube (helicopters, light singles, the dart) is its instanced model in the livery's colour.
 */
export function buildDetailedAircraft(three, spec, {
  code = null, livery, registration = null, createCanvas = null, logo = null, night = false, airframe = null,
  materials = null,
} = {}) {
  if (!(spec?.lengthM > 0) || !(spec?.spanM > 0) || !(spec?.fuselageDiaM > 0)) {
    throw new RangeError('A detailed aircraft needs the dimensions of its type');
  }
  const object = new three.Group();
  object.name = 'detailed-aircraft';
  const geometries = [];
  const owned = [];
  const textures = [];
  // A material without a texture of its own comes from the caller's cache when it gives one (`materials`), so a
  // detailed aircraft built again (another aircraft followed, its L2 model loaded) makes no new material and three keeps
  // its programs; a textured one (the painted fuselage and fin) is its own, freed with the model.
  const material = (options, { basic = false } = {}) => {
    const make = () => (basic ? new three.MeshBasicMaterial(options) : new three.MeshStandardMaterial(options));
    if (typeof materials === 'function' && options.map == null) return materials(detailMaterialKey(options, basic), make);
    const made = make();
    owned.push(made);
    return made;
  };
  const add = (parent, geometry, mat, name) => {
    geometries.push(geometry);
    const mesh = new three.Mesh(geometry, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  };
  const gear = new three.Group();
  gear.name = 'gear';
  const lights = { nav: [], beacons: [], strobes: [], halos: [] };
  const propellers = [];

  if (!Object.hasOwn(TUBE_FRAMES, spec.family) || spec.family === 'pistonSingle') {
    add(object, buildAircraftGeometry(three, spec), material({ color: livery.fuselage, roughness: 0.5, metalness: 0.1 }),
      'airframe');
    return finish();
  }

  const air = airframeOf(spec);
  const wing = wingParts(three, spec, air, code);
  const tail = tailParts(three, spec, air);
  const gearGeometry = gearParts(three, spec, air, wing, code);

  if (airframe !== null) {
    // PR M5: the type's 3D model (aircraft/modelAircraft.js) instead of the procedural airframe; the gear and the
    // lights stay the app's own, placed from the type's dimensions as the model is.
    for (const part of [wing.geometry, tail.fin, tail.tailplane]) part.dispose();
    for (const mesh of airframe.meshes) {
      mesh.frustumCulled = false;
      object.add(mesh);
    }
    addGearAndLights();
    return finish({ air, gearGeometry, engineCount: (nacelles(spec) ?? []).length * 2, refresh: null });
  }

  // The fuselage and the fin wear their painted textures; without a canvas, the livery's colours.
  const wingRootAlong = (wingPlanform(spec)[0][1] - air.bottom) / air.L;
  const body = canvasTexture(three, createCanvas, FUSELAGE_TEXTURE, context => paintFuselage(context, {
    ...FUSELAGE_TEXTURE, livery, registration, spec, wingRootAlong,
  }));
  const fin = canvasTexture(three, createCanvas, TAIL_TEXTURE, context => paintTail(context, {
    ...TAIL_TEXTURE, livery, shape: tail.shape, logo,
  }));
  if (body) textures.push(body.texture);
  if (fin) textures.push(fin.texture);
  // The fuselage and the fin are closed: their back faces never show. The wings, the tailplane and the nacelles are
  // open where they meet the fuselage or fold into their intakes: both sides.
  const paint = { roughness: 0.38, metalness: 0.08 };
  add(object, fuselageGeometry(three, spec, air),
    material(body ? { ...paint, map: body.texture } : { ...paint, color: livery.fuselage }), 'fuselage');
  add(object, tail.fin, material(fin ? { ...paint, map: fin.texture } : { ...paint, color: livery.tail }), 'fin');
  const wingMaterial = material({ color: livery.wing, roughness: 0.5, metalness: 0.18, side: three.DoubleSide });
  const wingGeometry = wing.geometry;
  add(object, three.mergeGeometries([wingGeometry, mirrored(three, wingGeometry)], false), wingMaterial, 'wing');
  add(object, tail.tailplane, wingMaterial, 'tailplane');

  // The engines.
  const engineSkins = [];
  const darks = [];
  const metals = [];
  const pylons = [];
  const spinners = [];
  const isProp = spec.family === 'turbopropHigh' || spec.family === 'turbopropLow';
  let engineCount = 0;
  for (const nacelle of nacelles(spec)) {
    const radius = nacelle.diameterM / 2;
    const lengthM = (nacelle.frontY - nacelle.backY) * (isProp ? 1 : 1.05);
    let z;
    if (nacelle.mount === 'rear') {
      const middle = (nacelle.frontY + nacelle.backY) / 2;
      z = air.axisAt(middle) + 0.3 * air.width(middle);
    } else if (isProp) {
      z = spec.family === 'turbopropHigh' ? wing.undersideAt(nacelle.x) - 0.15 * nacelle.diameterM
        : wing.undersideAt(nacelle.x) + 0.35 * nacelle.diameterM;
    } else {
      z = Math.max(wing.undersideAt(nacelle.x) - 0.55 * nacelle.diameterM, radius + 0.42);
    }
    for (const side of [1, -1]) {
      const x = side * nacelle.x;
      engineCount += 1;
      if (isProp) {
        const made = turboprop(three, { x, z, frontY: nacelle.frontY, lengthM, radius });
        engineSkins.push(made.skin);
        spinners.push(made.spinner);
        const blades = PROPELLER_BLADES[code] ?? 4;
        const discRadius = 0.145 * spec.spanM / 2;
        const propeller = new three.Mesh(propellerGeometry(three, { blades, radius: discRadius }),
          owned.find(item => item.name === 'propeller') ?? Object.assign(material({ color: '#22262b', roughness: 0.6,
            metalness: 0.3 }), { name: 'propeller' }));
        geometries.push(propeller.geometry);
        propeller.position.set(made.hub.x, made.hub.y, made.hub.z);
        propeller.frustumCulled = false;
        propeller.name = 'propeller';
        object.add(propeller);
        propellers.push({ mesh: propeller, direction: side });
      } else {
        const made = turbofan(three, { x, z, frontY: nacelle.frontY, lengthM, radius });
        engineSkins.push(made.skin);
        darks.push(made.dark);
        metals.push(made.metal);
      }
      if (nacelle.mount === 'rear') {
        const middle = (nacelle.frontY + nacelle.backY) / 2;
        const inner = side * 0.6 * air.width(middle);
        const outer = x - side * 0.4 * radius;
        pylons.push(box(three, { width: Math.abs(outer - inner), depth: 0.45 * lengthM, height: 0.35 * radius,
          x: (inner + outer) / 2, y: middle, z }));
      } else if (!isProp) {
        const pylonTop = wing.undersideAt(nacelle.x) + 0.1;
        const pylonBottom = z + 0.75 * radius;
        pylons.push(box(three, { width: Math.max(0.18, 0.1 * nacelle.diameterM), depth: 0.7 * lengthM,
          height: Math.max(0.2, pylonTop - pylonBottom), x, y: nacelle.frontY - 0.55 * lengthM,
          z: (pylonTop + pylonBottom) / 2 }));
      }
    }
  }
  const engineMaterial = material({ color: livery.engine, roughness: 0.35, metalness: 0.2, side: three.DoubleSide });
  if (engineSkins.length) add(object, three.mergeGeometries(engineSkins, false), engineMaterial, 'nacelle');
  if (spinners.length) add(object, three.mergeGeometries(spinners, false), material({ color: '#d9dce0', roughness: 0.4,
    metalness: 0.3 }), 'spinner');
  if (darks.length) add(object, three.mergeGeometries(darks, false), material({ color: '#15181c', roughness: 0.7,
    metalness: 0.4 }), 'fan');
  if (metals.length) add(object, three.mergeGeometries(metals, false), material({ color: '#6c7178', roughness: 0.45,
    metalness: 0.7 }), 'exhaust');
  if (pylons.length) add(object, three.mergeGeometries(pylons, false), wingMaterial, 'pylon');

  addGearAndLights();
  return finish({ air, gearGeometry, engineCount, refresh: { fin, tail, livery } });

  function addGearAndLights() {
    // The gear.
    add(gear, gearGeometry.metal, material({ color: '#8a9099', roughness: 0.45, metalness: 0.6 }), 'gear');
    add(gear, gearGeometry.tyres, material({ color: '#141414', roughness: 0.9, metalness: 0 }), 'tyres');
    object.add(gear);

    // The lights: steady red and green at the wingtips and white at the tail, red beacons on the crown and the belly,
    // white strobes at the wingtips and the tail; each with a faint halo while it shines.
    const lightRadius = Math.max(0.12, 0.04 * air.D);
    const sphere = new three.SphereGeometry(lightRadius, 10, 8);
    const halo = new three.SphereGeometry(lightRadius * 5, 12, 10);
    geometries.push(sphere, halo);
    const lamp = (colour, [x, y, z], kind, phase = 0) => {
      const mesh = new three.Mesh(sphere, material({ color: colour }, { basic: true }));
      mesh.name = 'light';
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      const glow = new three.Mesh(halo, material({ color: colour, transparent: true, opacity: night ? 0.5 : 0.28,
        blending: three.AdditiveBlending, depthWrite: false }, { basic: true }));
      glow.name = 'halo';
      glow.position.set(x, y, z);
      glow.frustumCulled = false;
      object.add(mesh, glow);
      lights.halos.push(glow);
      lights[kind].push({ mesh, glow, phase });
      return mesh;
    };
    const tipPoint = side => [side * (wing.tip.x + 0.05), wing.tip.y, wing.tip.z + 0.05];
    lamp(LIGHT_COLOURS.green, tipPoint(1), 'nav');
    lamp(LIGHT_COLOURS.red, tipPoint(-1), 'nav');
    lamp(LIGHT_COLOURS.white, [0, tail.tailTip.y - 0.1, tail.tailTip.z], 'nav');
    lamp(LIGHT_COLOURS.beacon, [0, -0.08 * air.L, air.roofAt(-0.08 * air.L) + lightRadius], 'beacons', 0);
    lamp(LIGHT_COLOURS.beacon, [0, 0.04 * air.L, air.floorAt(0.04 * air.L) - lightRadius], 'beacons', 0.5);
    for (const side of [1, -1]) {
      const [x, y, z] = tipPoint(side);
      lamp(LIGHT_COLOURS.white, [x, y - 0.5, z], 'strobes');
  }
  lamp(LIGHT_COLOURS.white, [0, tail.tailTip.y - 0.25, tail.tailTip.z + 0.1], 'strobes');
  }

  function finish({ air: frame = null, gearGeometry: gearInfo = null, engineCount: engines = 0, refresh = null } = {}) {
    let triangles = 0;
    let drawCalls = 0;
    object.traverse(node => {
      if (node.isMesh) {
        const position = node.geometry.getAttribute('position');
        const index = node.geometry.getIndex();
        triangles += (index === null ? position.count : index.count) / 3;
        drawCalls += 1;
      }
    });
    let propellerAngle = 0;
    let lastTimeMs = null;
    return {
      object,
      gear,
      lights,
      propellers,
      engines,
      pivot: { y: gearInfo?.pivotY ?? -0.08 * spec.lengthM, z: frame?.axisZ ?? 0.9 * spec.fuselageDiaM },
      triangles,
      drawCalls,
      textured: textures.length > 0,
      modelled: airframe !== null,
      setState({ gearDown: down = true, lights: on = {}, timeMs = 0, propellerRpm = 0, night: dark = night } = {}) {
        gear.visible = down !== false;
        for (const { mesh, glow } of lights.nav) {
          mesh.visible = true;
          glow.visible = dark === true;
        }
        for (const { mesh, glow, phase } of lights.beacons) {
          const shining = on.beacon === true && beaconOn(timeMs, phase);
          mesh.visible = shining;
          glow.visible = shining;
        }
        for (const { mesh, glow } of lights.strobes) {
          const shining = on.strobes === true && strobeOn(timeMs);
          mesh.visible = shining;
          glow.visible = shining;
        }
        if (propellers.length > 0 && finite(timeMs)) {
          const dt = lastTimeMs === null ? 0 : Math.max(0, Math.min(0.2, (timeMs - lastTimeMs) / 1000));
          propellerAngle = (propellerAngle + (2 * Math.PI * (finite(propellerRpm) ? propellerRpm : 0) * dt) / 60) % (2 * Math.PI);
          for (const { mesh, direction } of propellers) mesh.rotation.y = direction * propellerAngle;
        }
        lastTimeMs = timeMs;
      },
      /** Paints the fin again with a logo that loaded after the model was built. */
      refreshLogo(image) {
        if (airframe !== null) return airframe.refreshLogo?.(image) === true;
        if (!refresh?.fin || !image) return false;
        paintTail(refresh.fin.context, { ...TAIL_TEXTURE, livery: refresh.livery, shape: refresh.tail.shape, logo: image });
        refresh.fin.texture.needsUpdate = true;
        return true;
      },
      dispose() {
        object.removeFromParent();
        airframe?.dispose?.();
        for (const geometry of new Set(geometries)) geometry.dispose();
        for (const item of owned) item.dispose();
        for (const texture of textures) texture.dispose();
      },
    };
  }
}
