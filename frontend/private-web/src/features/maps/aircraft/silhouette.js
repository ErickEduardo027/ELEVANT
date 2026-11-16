import { CATEGORY_FALLBACKS } from './types';

// The plan view of an aircraft as one simple polygon in metres, nose toward +y, built from its dimensions
// (aircraft/types.js), so the map icons, the footprints at true size and the 3D models (aircraft/aircraftGeometry.js)
// share one shape (design E2): the 3D fuselage turns the outline's half-width, and its wings, tailplane and nacelles
// stand on the planforms exported here. Drawn here from the table's numbers and a few proportions per family; no
// shape is taken from tar1090 or Plane Watch. Pure.
//
// x runs across (right positive), y along the fuselage: the nose is at y = +length/2 and the tail at −length/2, and the
// wingtips reach x = ±span/2, so the polygon's box is span × length. The right half is drawn from the nose down and
// mirrored.

const deg = value => (value * Math.PI) / 180;

// Proportions of the tube-and-wing families. `wingRoot` is the y of the wing root's leading edge as a share of the
// length from the middle; chords are shares of the length; `taper` is tip chord over root chord; `tailCone` is the
// share of the length over which the rear fuselage narrows; the tailplane's `span` is a share of the wingspan and its
// `fromTail` the share of the length between its root leading edge and the tail. Engines hang under the wing at
// `stations` (shares of the half span), reaching `ahead` nacelle diameters in front of the leading edge, or sit on the
// rear fuselage from `top` (share of the length from the tail); `length` is a nacelle's whole length in diameters (the
// outline shows only the part of a wing nacelle ahead of the wing; the 3D model draws all of it).
const TUBE_SHAPES = Object.freeze({
  twinUnderwing: {
    noseR: 3.4, wingRoot: 0.125, rootChord: 0.17, taper: 0.27, tailCone: 0.3,
    stab: { span: 0.35, fromTail: 0.17, rootChord: 0.09, taper: 0.4, extraSweep: 5 },
    engines: { mount: 'wing', stations: [0.34], ahead: 1.15, length: 2.2 },
  },
  quadUnderwing: {
    noseR: 3.4, wingRoot: 0.12, rootChord: 0.17, taper: 0.25, tailCone: 0.3,
    stab: { span: 0.36, fromTail: 0.16, rootChord: 0.08, taper: 0.4, extraSweep: 5 },
    engines: { mount: 'wing', stations: [0.39, 0.66], ahead: 1.1, length: 2.3 },
  },
  rearTwinT: {
    noseR: 3.4, wingRoot: 0.07, rootChord: 0.125, taper: 0.3, tailCone: 0.24,
    stab: { span: 0.34, fromTail: 0.11, rootChord: 0.08, taper: 0.45, extraSweep: 8 },
    engines: { mount: 'rear', top: 0.31, length: 2.4 },
  },
  // A business jet's engines sit behind its wing and its T-tail behind them, inside the overall length.
  bizjet: {
    noseR: 3.2, wingRoot: 0.02, rootChord: 0.17, taper: 0.35, tailCone: 0.3,
    stab: { span: 0.36, fromTail: 0.145, rootChord: 0.08, taper: 0.45, extraSweep: 3 },
    engines: { mount: 'rear', top: 0.29, length: 2.2 },
  },
  turbopropHigh: {
    noseR: 2.4, wingRoot: 0.077, rootChord: 0.095, taper: 0.55, tailCone: 0.3,
    stab: { span: 0.27, fromTail: 0.13, rootChord: 0.09, taper: 0.55, extraSweep: 6 },
    engines: { mount: 'wing', stations: [0.3], ahead: 2.5, length: 4.6 },
  },
  // A low-wing twin turboprop with a T-tail (King Air, Beech 1900): a long pointed nose, the wing near the middle, the
  // nacelles well ahead of it and running past its trailing edge, a swept tailplane on top of the fin.
  turbopropLow: {
    noseR: 2.6, wingRoot: 0.05, rootChord: 0.14, taper: 0.45, tailCone: 0.35,
    stab: { span: 0.32, fromTail: 0.13, rootChord: 0.09, taper: 0.55, extraSweep: 12 },
    engines: { mount: 'wing', stations: [0.3], ahead: 2.4, length: 5.5 },
  },
  pistonSingle: {
    noseR: 1.6, wingRoot: 0.2, rootChord: 0.18, taper: 0.75, tailCone: 0.5,
    stab: { span: 0.31, fromTail: 0.17, rootChord: 0.15, taper: 0.7, extraSweep: 3 },
    engines: null,
  },
});

// The nose as an ogive: shares of the nose length and of the fuselage half-width.
const NOSE = Object.freeze([[0, 0], [0.06, 0.32], [0.18, 0.58], [0.36, 0.8], [0.6, 0.94], [1, 1]]);
// The tail cone ends this wide (share of the fuselage half-width).
const TAIL_END = 0.14;
// The leading edge is swept a little more than the quarter chord the table gives.
const LEADING_EDGE_EXTRA_SWEEP = 2;
// Nothing of the outline ends closer to the tail than this share of the length, but the tail itself.
const TAIL_CLEARANCE = 0.01;
// The corners of a nacelle are cut by this share of its diameter, so it reads as a pod and not as a block.
const NACELLE_CHAMFER = 0.25;

const round = value => Math.round(value * 1000) / 1000;

/**
 * The ring of a symmetric polygon from its right half, drawn from the nose (on the axis) to the tail. The half is
 * rounded to the millimetre first, so each mirrored point is exactly the negation of its pair.
 */
function mirrorHalf(rawHalf) {
  const half = rawHalf.map(([x, y]) => [round(x), round(y)]);
  const [, ...rest] = half;
  const last = half[half.length - 1];
  const mirrored = (last[0] === 0 ? rest.slice(0, -1) : rest).reverse().map(([x, y]) => [-x, y]);
  return [...half, ...mirrored];
}

/**
 * Every number of a tube-and-wing airframe that its outline and its 3D model share, in metres and unrounded: the
 * fuselage's half-width, the right wing, its nacelles, the rear pod and the right tailplane.
 */
function tubeFrame(spec, shape) {
  const L = spec.lengthM;
  const halfSpan = spec.spanM / 2;
  const R = spec.fuselageDiaM / 2;
  const top = L / 2;
  const bottom = -L / 2;
  const noseLength = Math.min(shape.noseR * R, 0.3 * L);
  const taperStart = bottom + shape.tailCone * L;

  // The fuselage's half-width at y: the ogive of the nose, the constant tube, the cone of the tail. At the nose's very
  // start the share can round to just above 1: it is held at 1, so that station reads the tube's width.
  const width = y => {
    if (y >= top - noseLength) {
      const share = Math.min((top - y) / noseLength, 1);
      const at = NOSE.findIndex(([depth]) => depth >= share);
      if (at <= 0) return R * NOSE[Math.max(at, 0)][1];
      const [d0, w0] = NOSE[at - 1];
      const [d1, w1] = NOSE[at];
      return R * (w0 + ((w1 - w0) * (share - d0)) / (d1 - d0));
    }
    if (y >= taperStart) return R;
    return R * (1 - ((1 - TAIL_END) * (taperStart - y)) / (taperStart - bottom));
  };

  const nose = NOSE.map(([depth, share]) => [R * share, top - depth * noseLength]);

  // The wing: root leading edge, nacelles under it, tip, trailing edge back to the fuselage.
  const rootY = shape.wingRoot * L;
  const rootChord = shape.rootChord * L;
  const tipChord = shape.taper * rootChord;
  const slope = Math.tan(deg(spec.wingSweepDeg + LEADING_EDGE_EXTRA_SWEEP));
  const leadingEdge = x => rootY - (x - R) * slope;
  const wingNacelles = [];
  if (shape.engines?.mount === 'wing') {
    const nacelle = spec.engineDiaM;
    const chamfer = NACELLE_CHAMFER * nacelle;
    for (const station of shape.engines.stations) {
      const centre = station * halfSpan;
      const front = leadingEdge(centre) + shape.engines.ahead * nacelle;
      const inner = centre - nacelle / 2;
      const outer = centre + nacelle / 2;
      wingNacelles.push({
        centre, front, back: front - shape.engines.length * nacelle, diameter: nacelle,
        points: [[inner, leadingEdge(inner)], [inner, front - chamfer], [inner + chamfer, front], [outer - chamfer, front],
          [outer, front - chamfer], [outer, leadingEdge(outer)]],
      });
    }
  }
  const tipY = leadingEdge(halfSpan);
  const trailingRootY = rootY - rootChord;
  const wing = [[width(rootY), rootY], [halfSpan, tipY], [halfSpan, tipY - tipChord], [width(trailingRootY), trailingRootY]];

  // Below the wing, in order down the fuselage: rear engines, the start of the tail cone and the tailplane.
  const stab = shape.stab;
  const stabHalfSpan = (stab.span * spec.spanM) / 2;
  const stabRootChord = stab.rootChord * L;
  const stabSlope = Math.tan(deg(spec.wingSweepDeg + LEADING_EDGE_EXTRA_SWEEP + stab.extraSweep));
  let stabY = bottom + stab.fromTail * L;
  // A wide or swept tailplane moves forward until its tip clears the tail.
  const stabTipTrail = y => y - (stabHalfSpan - width(y)) * stabSlope - stab.taper * stabRootChord;
  for (let step = 0; step < 50 && stabTipTrail(stabY) < bottom + TAIL_CLEARANCE * L; step += 1) stabY += 0.01 * L;
  const stabTrailY = stabY - stabRootChord;
  const stabTipY = stabY - (stabHalfSpan - width(stabY)) * stabSlope;
  const tailplane = [[width(stabY), stabY], [stabHalfSpan, stabTipY], [stabHalfSpan, stabTipY - stab.taper * stabRootChord],
    [width(stabTrailY), stabTrailY]];

  let rearPod = null;
  if (shape.engines?.mount === 'rear') {
    const podTop = bottom + shape.engines.top * L;
    const podBottom = podTop - shape.engines.length * spec.engineDiaM;
    const outer = width(podTop) + 1.15 * spec.engineDiaM;
    const chamfer = NACELLE_CHAMFER * spec.engineDiaM;
    rearPod = {
      top: podTop, bottom: podBottom, outer, diameter: spec.engineDiaM,
      points: [[width(podTop), podTop], [outer - chamfer, podTop], [outer, podTop - chamfer], [outer, podBottom + chamfer],
        [outer - chamfer, podBottom], [width(podBottom), podBottom]],
    };
  }

  return {
    R, top, bottom, taperStart, width, nose, wing, wingNacelles, rearPod, tailplane, stabY, stabTrailY, trailingRootY,
  };
}

function tubeOutline(frame) {
  const { R, bottom, taperStart, nose, wing, wingNacelles, rearPod, tailplane, stabY, stabTrailY, trailingRootY } = frame;
  const [rootLeading, tipLeading, tipTrailing, rootTrailing] = wing;
  const half = [...nose, rootLeading, ...wingNacelles.flatMap(nacelle => nacelle.points), tipLeading, tipTrailing,
    rootTrailing];

  const parts = [];
  if (rearPod !== null) parts.push({ from: rearPod.top, to: rearPod.bottom, points: rearPod.points });
  parts.push({ from: stabY, to: stabTrailY, points: tailplane });
  const covered = y => parts.some(part => y <= part.from && y >= part.to);
  if (taperStart < trailingRootY && !covered(taperStart)) parts.push({ from: taperStart, points: [[R, taperStart]] });
  // Each part keeps its own order: a swept tailplane's tip may lie below its root trailing edge.
  parts.sort((first, second) => second.from - first.from);
  half.push(...parts.flatMap(part => part.points), [R * TAIL_END, bottom]);
  return mirrorHalf(half);
}

// The frame of a tube-and-wing airframe; null for the two families drawn otherwise (a helicopter, the dart).
function frameOf(spec) {
  const family = spec?.family;
  if (family === 'helicopter' || family === 'dart') return null;
  if (typeof family !== 'string' || !Object.hasOwn(TUBE_SHAPES, family)) {
    throw new RangeError(`No silhouette for the aircraft family ${String(family)}`);
  }
  return tubeFrame(spec, TUBE_SHAPES[family]);
}

/**
 * The half-width of a tube-and-wing fuselage at `y` (metres along it, the nose at +length/2): the ogive of the nose,
 * the constant tube, the cone of the tail, as the outline draws them; `y` is held within the length. `null` for a
 * helicopter and the dart, whose outlines have no tube.
 */
export function fuselageHalfWidth(spec, y) {
  const frame = frameOf(spec);
  if (frame === null) return null;
  return frame.width(Math.min(Math.max(y, frame.bottom), frame.top));
}

/**
 * The stations where the fuselage outline bends, from the nose tip to the tail: `[[halfWidth, y], …]`, the points of
 * the nose ogive, the start of the tail cone and the end of the tail. Between two stations the half-width changes
 * linearly. `null` for a helicopter and the dart.
 */
export function fuselageProfile(spec) {
  const frame = frameOf(spec);
  if (frame === null) return null;
  return [...frame.nose.map(([x, y]) => [x, y]), [frame.R, frame.taperStart], [frame.R * TAIL_END, frame.bottom]];
}

/**
 * The right half of the wing in plan view: `[[x, y], …]` for the root leading edge (on the fuselage outline), the tip
 * leading edge, the tip trailing edge and the root trailing edge, as the outline draws them. `null` for a helicopter
 * and the dart.
 */
export function wingPlanform(spec) {
  const frame = frameOf(spec);
  return frame === null ? null : frame.wing.map(([x, y]) => [x, y]);
}

/**
 * The right half of the tailplane in plan view, after the outline moved it forward until its tip clears the tail: the
 * root leading edge, the tip leading edge, the tip trailing edge and the root trailing edge. `null` for a helicopter
 * and the dart.
 */
export function tailplanePlanform(spec) {
  const frame = frameOf(spec);
  return frame === null ? null : frame.tailplane.map(([x, y]) => [x, y]);
}

/**
 * The nacelles on the right side (the left ones are their mirror images): `[{ mount, x, frontY, backY, diameterM }]`,
 * `mount` `wing` (hung under the wing) or `rear` (on the rear fuselage), `x` the nacelle's axis and `frontY` the front
 * the outline draws. A wing nacelle's back lies under the wing, where the outline does not show it. `[]` for a single
 * piston engine in the nose; `null` for a helicopter and the dart.
 */
export function nacelles(spec) {
  const frame = frameOf(spec);
  if (frame === null) return null;
  const wingMounted = frame.wingNacelles.map(nacelle => ({
    mount: 'wing', x: nacelle.centre, frontY: nacelle.front, backY: nacelle.back, diameterM: nacelle.diameter,
  }));
  const pod = frame.rearPod;
  const rearMounted = pod === null ? [] : [{
    mount: 'rear', x: pod.outer - pod.diameter / 2, frontY: pod.top, backY: pod.bottom, diameterM: pod.diameter,
  }];
  return [...wingMounted, ...rearMounted];
}

// A helicopter seen from above: the two blades of its rotor along and across it (the span is the rotor's diameter and
// the length runs from the forward blade tip to the tail), a cabin, a tail boom and its small tailplane.
function helicopterOutline(spec) {
  const L = spec.lengthM;
  const halfSpan = spec.spanM / 2;
  const top = L / 2;
  const bottom = -L / 2;
  const hub = top - halfSpan;
  const blade = 0.045 * spec.spanM;
  const cabin = spec.fuselageDiaM / 2;
  const boom = 0.25 * cabin;
  const cabinFront = Math.min(hub + 0.28 * L, top - 0.5);
  const cabinBack = hub - 0.12 * L;
  const fin = bottom + 0.1 * L;
  const half = [
    [0, top], [blade, top], [blade, cabinFront - 0.12 * L],
    [0.8 * cabin, hub + 0.12 * L], [cabin, hub + 0.05 * L],
    [cabin, hub + blade], [halfSpan, hub + blade], [halfSpan, hub - blade], [cabin, hub - blade],
    [0.85 * cabin, hub - 0.06 * L], [blade, cabinBack],
    [blade, hub - halfSpan], [boom, hub - halfSpan],
    [boom, fin], [0.11 * spec.spanM, fin], [0.11 * spec.spanM, fin - 0.04 * L], [boom, fin - 0.04 * L], [boom, bottom],
  ];
  return mirrorHalf(half);
}

// The neutral dart of an aircraft the map cannot name.
const dartOutline = spec => mirrorHalf([[0, spec.lengthM / 2], [spec.spanM / 2, -spec.lengthM / 2], [0, -spec.lengthM / 4]]);

/**
 * The outline of an aircraft type (`spec` from aircraft/types.js): `[[x, y], …]` in metres, nose toward +y, one
 * simple polygon symmetric about x = 0 whose box is `spanM` × `lengthM` (the ring is not closed: the last point is not
 * the first again).
 */
export function silhouetteOutline(spec) {
  if (spec?.family === 'helicopter') return helicopterOutline(spec);
  if (spec?.family === 'dart') return dartOutline(spec);
  return tubeOutline(frameOf(spec));
}

/** `{ minX, maxX, minY, maxY }` of an outline. */
export function outlineBox(outline) {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const pixel = value => String(Math.round(value * 100) / 100);

/**
 * The outline as SVG path data inside a `size` × `size` box: scaled to fit the box less `inset` on every side, centred,
 * with y turned down so the nose points to the top of the image. `M x y L … Z`.
 */
export function silhouettePath(outline, { size, inset = 3 } = {}) {
  if (!(size > 2 * inset)) throw new RangeError(`A silhouette needs a box larger than twice its inset, got ${size}`);
  const { minX, maxX, minY, maxY } = outlineBox(outline);
  const scale = (size - 2 * inset) / Math.max(maxX - minX, maxY - minY);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const points = outline.map(([x, y]) => `${pixel(size / 2 + (x - centreX) * scale)} ${pixel(size / 2 - (y - centreY) * scale)}`);
  return `M${points.join(' L')} Z`;
}

/** The outline of each icon category, from its generic airframe (aircraft/types.js: CATEGORY_FALLBACKS). */
export const CATEGORY_OUTLINES = Object.freeze(Object.fromEntries(Object.entries(CATEGORY_FALLBACKS)
  .map(([category, spec]) => [category, Object.freeze(silhouetteOutline(spec).map(point => Object.freeze(point)))])));
