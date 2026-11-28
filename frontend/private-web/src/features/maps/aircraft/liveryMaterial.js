import { DEFAULT_LIVERY, LIVERIES, liveryName } from './liveries';
import { nacelles } from './silhouette';
import { linearRgb } from './instancePlan';

// The liveries of the 3D models (PR M5) without a hand-made segmentation or a texture per airline: a material paints
// each point of a model by the zone it falls in, from its coordinates in the model's own frame (x to the right, y
// toward the nose, z up, metres), measured against the type's fuselage, fin and nacelles (liveryFrame). The colours
// are those of aircraft/liveries.js, one row per airline in a small palette texture; the airline's name in the app's
// typeface along both sides of the fuselage and its mark on the fin (its licensed or public-domain text logo, the
// `logoTexture` of its livery, else its IATA code) come from one canvas atlas with a row per airline. Every instance
// of a type picks its row with one attribute (`liveryIndex`), so a type is still one draw call; −1 keeps the plain
// instance colour (shadows, and the chosen aircraft in the selection's accent, contracts 2.4).
//
// The zones (liveryZone, and the same arithmetic in GLSL): the nacelles (within a reach of each nacelle's axis, from
// silhouette.js, at the height the model's own nacelle sits); whatever stands out of the fuselage's width (wings,
// tailplane, winglets, pylons) in the wing grey; above the crown at the rear, the fin with its accent swept across the
// lower trailing corner; on the fuselage, by height over its axis: the belly under the window line, the cheatlines and
// the upper body, and the cockpit's dark panes on the nose. `three` is a parameter of the factories, as for the other
// models; the rest is pure.

/** The zones a livery colours, in the order of the palette's columns. */
export const LIVERY_ZONES = Object.freeze(['fuselage', 'belly', 'cheatline', 'cheatline2', 'tail', 'tailAccent',
  'engine', 'wing']);

/** Zones painted in fixed colours: the cockpit's panes, the gear's legs and its tyres. */
export const FIXED_ZONES = Object.freeze({ cockpit: 8, gearMetal: 9, tyre: 10 });
const FIXED_COLOURS = Object.freeze({ cockpit: '#141a21', gearMetal: '#8a9099', tyre: '#141414' });

/** Where the zones change, as shares of the fuselage's radius over its axis (c) or of the half length (t). */
export const LIVERY_BANDS = Object.freeze({
  // Outside the fuselage's width by this share: a wing, a tailplane, a pylon.
  outside: 1.08,
  // The fin: above the crown by this share of the radius, behind this share of the half length.
  finC: 1.08, finT: -0.3,
  // The belly under this height, the second cheatline above the belly down to this one, the first between these.
  belly: -0.22, cheatline2: -0.34, cheatlineLow: -0.2, cheatlineHigh: -0.05,
  // The cockpit's panes on the nose.
  cockpitT0: 0.86, cockpitT1: 0.95, cockpitC0: 0.3, cockpitC1: 0.62,
  // The fin's accent: up to this share of its height, from its trailing edge forward this share of its root chord.
  accentV: 0.6, accentChord: 0.6,
  // The nacelle's reach around its axis and its margin along it, as shares of its diameter.
  engineReach: 0.62, engineMargin: 0.15,
});

/** The atlas of the lettering: one row per livery, the name's cell then the fin's mark. */
export const LIVERY_ATLAS = Object.freeze({ width: 1024, rowHeight: 64, nameWidth: 768, markWidth: 256 });

/** Where the name stands on the body: from this share of the length (from the tail), above the windows. */
export const NAME_PLACE = Object.freeze({ start: 0.45, maxLength: 0.4, bottomC: 0.3, heightC: 0.6, maxHeightM: 1.2 });

/** The fallback of the app's typeface (Manrope, OFL, loaded by app/layout.jsx as --font-manrope). */
export const LIVERY_FONT_FALLBACK = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** The liveries the palette and the atlas hold, in row order: the default first. */
export const LIVERY_ROWS = Object.freeze([DEFAULT_LIVERY, ...Object.values(LIVERIES)]);

const ROW_OF = new Map(LIVERY_ROWS.map((livery, row) => [livery.id, row]));

/** The palette's row of a livery id (or of a livery), or −1 for none: what `liveryIndex` holds per instance. */
export function liveryRow(livery) {
  const id = typeof livery === 'string' ? livery : livery?.id;
  return ROW_OF.get(id) ?? -1;
}

/** A livery's eight colours in the order of LIVERY_ZONES, `#rrggbb`; a missing cheatline or accent takes its base. */
export function liveryColours(livery) {
  return [
    livery.fuselage, livery.belly, livery.cheatline ?? livery.fuselage, livery.cheatline2 ?? livery.belly, livery.tail,
    livery.tailAccent ?? livery.tail, livery.engine, livery.wing,
  ];
}

/** The palette's texels: `rows` × 8 RGBA floats in three's linear working space, row by row. */
export function liveryPaletteData(rows = LIVERY_ROWS) {
  const data = new Float32Array(rows.length * LIVERY_ZONES.length * 4);
  rows.forEach((livery, row) => {
    liveryColours(livery).forEach((colour, zone) => {
      data.set([...linearRgb(colour), 1], 4 * (row * LIVERY_ZONES.length + zone));
    });
  });
  return data;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The points where a model's surface crosses the plane `axis` (0 x, 1 y, 2 z) = `value`: `[x, y, z]` on each edge of
 * each triangle that crosses it. `positions` a flat `[x, y, z, …]` array, `index` its triangles (or null: every three
 * positions one triangle). A sparse mesh (a long constant section, a fin of two edges) is read where it is, not only
 * at its vertices. Pure.
 */
export function sliceModel(positions, index, axis, value) {
  const points = [];
  const count = index ? index.length : Math.floor((positions?.length ?? 0) / 3);
  const corner = (k, c) => positions[3 * (index ? index[k] : k) + c];
  for (let t = 0; t + 2 < count; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = t + e;
      const b = t + ((e + 1) % 3);
      const va = corner(a, axis) - value;
      const vb = corner(b, axis) - value;
      if ((va < 0 && vb < 0) || (va > 0 && vb > 0) || va === vb) continue;
      const s = va / (va - vb);
      points.push([0, 1, 2].map(c => corner(a, c) + s * (corner(b, c) - corner(a, c))));
    }
  }
  return points;
}

/**
 * A nacelle's cross-section in a model, `{ x, z, width }` (its axis's distance from the centreline, its height and its
 * width), or null when no cut finds one. The model is cut across at a few places along the nacelle silhouette.js
 * gives (`{ x, frontY, backY, diameterM }`), the points near its side split into bands of height, and the band whose
 * width and height come closest to its diameter wins: a wing or a pylon in the same cut is thin or narrow. A band
 * that runs on into its pylon takes its height from its bottom. `slice(axis, value)` cuts the model (sliceModel).
 */
export function nacelleSection(slice, nacelle, { zLow = -Infinity, zHigh = Infinity } = {}) {
  const dia = nacelle.diameterM;
  let best = null;
  for (const share of [0.6, 0.75, 0.9]) {
    const points = slice(1, nacelle.backY + share * (nacelle.frontY - nacelle.backY))
      .filter(([x, , z]) => Math.abs(Math.abs(x) - nacelle.x) < 0.75 * dia && z > zLow && z < zHigh)
      .sort((a, b) => a[2] - b[2]);
    let start = 0;
    for (let at = 1; at <= points.length; at += 1) {
      if (at < points.length && points[at][2] - points[at - 1][2] < 0.2 * dia) continue;
      const band = points.slice(start, at);
      start = at;
      if (band.length < 6) continue;
      const xs = band.map(([x]) => Math.abs(x));
      const bottom = band[0][2];
      const height = band[band.length - 1][2] - bottom;
      const width = Math.max(...xs) - Math.min(...xs);
      const score = Math.abs(width - dia) + Math.max(0, dia - height);
      if (width < 0.5 * dia || height < 0.5 * dia || (best !== null && score >= best.score)) continue;
      // The lower half of the band is the nacelle's own, below its pylon.
      const lower = band.filter(point => point[2] < bottom + 0.55 * dia).map(([x]) => Math.abs(x));
      const lowerWidth = clamp(Math.max(...lower) - Math.min(...lower), 0.6 * dia, 1.4 * dia);
      best = { score, x: (Math.max(...lower) + Math.min(...lower)) / 2, z: bottom + lowerWidth / 2, width: lowerWidth };
    }
  }
  return best === null ? null : { x: best.x, z: best.z, width: best.width };
}

/**
 * How far a nacelle found by its cross-section (nacelleSection: `{ x, z, width }`) runs along the model (QA of
 * 2026-11-28: the A330's nacelles reach well ahead of where silhouette.js draws them, and their intake took the wing's
 * grey): `[aft, fore]` where the horizontal plane through its axis cuts its walls, within half its length of
 * silhouette.js's, or null when the cut does not look like that nacelle.
 */
export function nacelleLength(slice, nacelle, { x, z, width }) {
  const span = nacelle.frontY - nacelle.backY;
  const ys = slice(2, z)
    .filter(([px, py]) => Math.abs(Math.abs(px) - x) < 0.6 * width && py > nacelle.backY - 0.5 * span
      && py < nacelle.frontY + 0.5 * span)
    .map(point => point[1]);
  if (ys.length < 4) return null;
  const aft = Math.min(...ys);
  const fore = Math.max(...ys);
  if (fore - aft < 0.6 * span || fore < nacelle.backY || aft > nacelle.frontY) return null;
  return [aft, fore];
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? Number.NaN : sorted[Math.floor(sorted.length / 2)];
};

/**
 * The frame the zones are measured in, from a model's positions (a flat `[x, y, z, …]` array in the models' frame,
 * without its gear), its triangles (`index`, or null for unindexed positions) and its type's dimensions
 * (aircraft/types.js): `{ halfLengthM, yMinM, axisZM, radiusM, halfWidthM, fin: { rootZM, topZM, aftYM, rootChordM,
 * markYM, markZM, markWidthM }, name: { y0M, lengthM, z0M, heightM }, engines: [{ x, z, reachM, y0M, y1M }] }`. The
 * model is cut by planes (sliceModel), so a sparse mesh reads as well as a dense one: the fuselage in sections ahead of
 * the wing, the fin's chords near its root and at its middle, each nacelle across its intake where silhouette.js
 * places it; what the model lacks is taken from the dimensions.
 */
export function liveryFrame(positions, spec, index = null) {
  const L = spec.lengthM;
  const D = spec.fuselageDiaM;
  const count = Math.floor((positions?.length ?? 0) / 3);
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  for (let i = 0; i < count; i += 1) {
    yMin = Math.min(yMin, positions[3 * i + 1]);
    yMax = Math.max(yMax, positions[3 * i + 1]);
    zMin = Math.min(zMin, positions[3 * i + 2]);
  }
  if (!Number.isFinite(yMin)) {
    yMin = -L / 2;
    yMax = L / 2;
    zMin = 0;
  }
  const length = yMax - yMin;
  const at = share => yMin + share * length;
  const slice = (axis, value) => (count > 0 ? sliceModel(positions, index, axis, value) : []);
  // The fuselage in sections behind the cockpit and ahead of the wing and the intakes: the median of their bellies,
  // crowns and half widths.
  const sections = [0.68, 0.72, 0.76, 0.8].map(share => {
    const near = slice(1, at(share)).filter(([x]) => Math.abs(x) < 0.75 * D);
    if (near.length < 6) return null;
    const zs = near.map(point => point[2]);
    return { belly: Math.min(...zs), crown: Math.max(...zs), halfWidth: Math.max(...near.map(([x]) => Math.abs(x))) };
  }).filter(section => section !== null && section.crown - section.belly > 0.5 * D);
  let belly = median(sections.map(section => section.belly));
  let crown = median(sections.map(section => section.crown));
  let halfWidth = median(sections.map(section => section.halfWidth));
  if (!Number.isFinite(belly)) {
    belly = zMin + 0.3 * D;
    crown = belly + 1.04 * D;
    halfWidth = D / 2;
  }
  const axisZ = (belly + crown) / 2;
  const radius = (crown - belly) / 2;
  // The fin: above the crown, near the middle, behind the rear third.
  const finRoot = axisZ + LIVERY_BANDS.finC * radius;
  let finTop = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const [x, y, z] = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    if (z > finRoot && Math.abs(x) < 0.5 * halfWidth && y < at(0.35)) finTop = Math.max(finTop, z);
  }
  if (!(finTop > finRoot + 0.5)) finTop = Math.max(finRoot + 1, spec.heightM);
  const finHeight = finTop - finRoot;
  // The fin's chord at a height: where the plane z = height cuts it.
  const chordAt = height => {
    const ys = slice(2, height).filter(([x, y]) => Math.abs(x) < 0.5 * halfWidth && y < at(0.35)).map(point => point[1]);
    return ys.length >= 2 ? [Math.min(...ys), Math.max(...ys)] : null;
  };
  const root = chordAt(finRoot + 0.05 * finHeight) ?? [yMin, yMin + 0.16 * L];
  const mark = finMark(chordAt, root, finRoot, finHeight);
  // The name above the windows, ahead of the wing.
  const nameHeight = Math.min(NAME_PLACE.heightC * radius, NAME_PLACE.maxHeightM);
  const nameLength = Math.min((LIVERY_ATLAS.nameWidth / LIVERY_ATLAS.rowHeight) * nameHeight, NAME_PLACE.maxLength * length);
  // The nacelles: each one where silhouette.js places it, found in the model by its cross-section (nacelleSection).
  const engines = [];
  for (const nacelle of nacelles(spec) ?? []) {
    const dia = nacelle.diameterM;
    const section = nacelleSection(slice, nacelle, { zLow: zMin - 0.5, zHigh: axisZ + 2 * radius });
    const x = section?.x ?? nacelle.x;
    const z = section?.z ?? (nacelle.mount === 'rear' ? axisZ + 0.5 * radius : axisZ - radius);
    const width = section?.width ?? dia;
    const margin = LIVERY_BANDS.engineMargin * dia;
    const along = section === null ? null : nacelleLength(slice, nacelle, { x, z, width });
    engines.push({ x, z, reachM: LIVERY_BANDS.engineReach * width, y0M: (along?.[0] ?? nacelle.backY) - margin,
      y1M: (along?.[1] ?? nacelle.frontY) + margin });
  }
  return Object.freeze({
    halfLengthM: length / 2,
    yMinM: yMin,
    axisZM: axisZ,
    radiusM: radius,
    halfWidthM: halfWidth,
    fin: Object.freeze({
      rootZM: finRoot, topZM: finTop, aftYM: root[0], rootChordM: root[1] - root[0], markYM: mark.y, markZM: mark.z,
      markWidthM: mark.width,
    }),
    name: Object.freeze({ y0M: yMin + NAME_PLACE.start * length, lengthM: nameLength,
      z0M: axisZ + NAME_PLACE.bottomC * radius, heightM: nameHeight }),
    engines: Object.freeze(engines.slice(0, MAX_ENGINES).map(Object.freeze)),
  });
}

/** The fin's mark: this share of the fin's chord wide, clear of the accent and of the tip by these shares of its height. */
export const MARK_PLACE = Object.freeze({ chord: 0.9, accentGap: 0.03, tipGap: 0.06 });

/**
 * Where the fin's mark stands (QA of 2026-11-28): above the accent, so a mark in the colour of the accent (Wingo's lime,
 * Avianca's white) does not vanish on it, and inside the fin's chord at both its bottom and its top, so the swept
 * leading edge does not cut it. `chordAt(z)` the fin's `[aft, fore]` at a height, or null. Answers `{ y, z, width }`.
 */
function finMark(chordAt, root, finRoot, finHeight) {
  const ratio = LIVERY_ATLAS.rowHeight / LIVERY_ATLAS.markWidth;
  const low = finRoot + (LIVERY_BANDS.accentV + MARK_PLACE.accentGap) * finHeight;
  const high = finRoot + (1 - MARK_PLACE.tipGap) * finHeight;
  const fallback = height => {
    const v = (height - finRoot) / finHeight;
    return [root[0] + 0.3 * v * (root[1] - root[0]), root[1] - 0.45 * v * (root[1] - root[0])];
  };
  const chord = height => chordAt(height) ?? fallback(height);
  let fit = chord((low + high) / 2);
  let width = MARK_PLACE.chord * (fit[1] - fit[0]);
  for (let step = 0; step < 3; step += 1) {
    const half = Math.min((width * ratio) / 2, (high - low) / 2);
    const bottom = chord(low);
    const top = chord(low + 2 * half);
    fit = [Math.max(bottom[0], top[0]), Math.min(bottom[1], top[1])];
    width = Math.max(0, MARK_PLACE.chord * (fit[1] - fit[0]));
    // The mark keeps the atlas's proportions: no taller than the room between the accent and the tip.
    width = Math.min(width, (high - low) / ratio);
  }
  return { y: (fit[0] + fit[1]) / 2, z: low + (width * ratio) / 2, width };
}

/** How many nacelles (per side) the material reads: four-engined types have two. */
export const MAX_ENGINES = 2;

/**
 * The zone of a point `[x, y, z]` of a model in its frame (liveryFrame): an index of LIVERY_ZONES, or of FIXED_ZONES
 * for the cockpit's panes. The material's GLSL (LIVERY_GLSL) does the same arithmetic per pixel.
 */
export function liveryZone([x, y, z], frame) {
  const ax = Math.abs(x);
  // Only outside the fuselage's width: the rear pods' reach must not paint the fuselage beside them (QA 2026-11-28).
  for (const engine of ax > LIVERY_BANDS.outside * frame.halfWidthM ? frame.engines : []) {
    const dx = ax - engine.x;
    const dz = z - engine.z;
    if (y >= engine.y0M && y <= engine.y1M && dx * dx + dz * dz < engine.reachM * engine.reachM) return 6;
  }
  if (ax > LIVERY_BANDS.outside * frame.halfWidthM) return 7;
  const t = (y - frame.yMinM) / frame.halfLengthM - 1;
  const c = (z - frame.axisZM) / frame.radiusM;
  if (c > LIVERY_BANDS.finC && t < LIVERY_BANDS.finT) {
    const v = clamp((z - frame.fin.rootZM) / Math.max(1e-3, frame.fin.topZM - frame.fin.rootZM), 0, 1);
    const reach = LIVERY_BANDS.accentChord * frame.fin.rootChordM * (1 - v / LIVERY_BANDS.accentV);
    return v < LIVERY_BANDS.accentV && y - frame.fin.aftYM < reach ? 5 : 4;
  }
  if (t > LIVERY_BANDS.cockpitT0 && t < LIVERY_BANDS.cockpitT1 && c > LIVERY_BANDS.cockpitC0 && c < LIVERY_BANDS.cockpitC1) {
    return FIXED_ZONES.cockpit;
  }
  if (c < LIVERY_BANDS.belly) return c > LIVERY_BANDS.cheatline2 ? 3 : 1;
  if (c > LIVERY_BANDS.cheatlineLow && c < LIVERY_BANDS.cheatlineHigh) return 2;
  return 0;
}

/**
 * Where a point of the side of the body or of the fin reads in the atlas of its livery's row (`row` of `rows`):
 * `[u, v]` in the texture (three flips a canvas texture: its top row is v = 1), or null outside the name's or the
 * mark's cell. The name reads from the tail toward the nose on the right side (x > 0) and from the nose toward the
 * tail on the left, so it reads on both; the fin's mark the same way.
 */
export function letteringUv([x, y, z], zone, frame, row, rows) {
  const right = x >= 0;
  let u;
  let v;
  let u0;
  let width;
  if (zone === 0 || zone === 2) {
    u = (y - frame.name.y0M) / frame.name.lengthM;
    v = (z - frame.name.z0M) / frame.name.heightM;
    u0 = 0;
    width = LIVERY_ATLAS.nameWidth;
  } else if (zone === 4 || zone === 5) {
    const markHeight = frame.fin.markWidthM * (LIVERY_ATLAS.rowHeight / LIVERY_ATLAS.markWidth);
    u = (y - frame.fin.markYM) / frame.fin.markWidthM + 0.5;
    v = (z - frame.fin.markZM) / markHeight + 0.5;
    u0 = LIVERY_ATLAS.nameWidth;
    width = LIVERY_ATLAS.markWidth;
  } else {
    return null;
  }
  if (!right) u = 1 - u;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return [(u0 + u * width) / LIVERY_ATLAS.width, 1 - (row + 1 - v) / rows];
}

// --------------------------------------------------------------------------------------------------------------- GLSL

const f = value => (Number.isInteger(value) ? `${value}.0` : String(value));

/** The GLSL of the zones and the lettering, the same arithmetic as liveryZone and letteringUv. */
export const LIVERY_GLSL = `
uniform sampler2D liveryPalette;
uniform sampler2D liveryAtlas;
uniform float liveryHasAtlas;
uniform float liveryRows;
uniform vec4 liveryBody;
uniform vec4 liveryFin;
uniform vec4 liveryMark;
uniform vec4 liveryName;
uniform vec4 liveryEngines[${MAX_ENGINES}];
uniform vec2 liveryEngineY[${MAX_ENGINES}];
varying vec3 vLiveryPos;
varying float vLiveryIndex;
varying float vLiveryPart;

float liveryZone(vec3 p) {
  float ax = abs(p.x);
  for (int i = 0; i < ${MAX_ENGINES}; i++) {
    vec4 e = liveryEngines[i];
    vec2 ey = liveryEngineY[i];
    vec2 d = vec2(ax - e.x, p.z - e.y);
    if (e.z > 0.0 && ax > ${f(LIVERY_BANDS.outside)} * liveryBody.w && p.y >= ey.x && p.y <= ey.y
      && dot(d, d) < e.z * e.z) return 6.0;
  }
  if (ax > ${f(LIVERY_BANDS.outside)} * liveryBody.w) return 7.0;
  float t = (p.y - liveryBody.x) / liveryBody.y - 1.0;
  float c = (p.z - liveryBody.z) / liveryFin.w;
  if (c > ${f(LIVERY_BANDS.finC)} && t < ${f(LIVERY_BANDS.finT)}) {
    float v = clamp((p.z - liveryFin.x) / max(0.001, liveryFin.y - liveryFin.x), 0.0, 1.0);
    float reach = ${f(LIVERY_BANDS.accentChord)} * liveryMark.w * (1.0 - v / ${f(LIVERY_BANDS.accentV)});
    return (v < ${f(LIVERY_BANDS.accentV)} && p.y - liveryFin.z < reach) ? 5.0 : 4.0;
  }
  if (t > ${f(LIVERY_BANDS.cockpitT0)} && t < ${f(LIVERY_BANDS.cockpitT1)} && c > ${f(LIVERY_BANDS.cockpitC0)}
    && c < ${f(LIVERY_BANDS.cockpitC1)}) return ${f(FIXED_ZONES.cockpit)};
  if (c < ${f(LIVERY_BANDS.belly)}) return c > ${f(LIVERY_BANDS.cheatline2)} ? 3.0 : 1.0;
  if (c > ${f(LIVERY_BANDS.cheatlineLow)} && c < ${f(LIVERY_BANDS.cheatlineHigh)}) return 2.0;
  return 0.0;
}

vec4 liveryLettering(vec3 p, float zone, float row) {
  if (liveryHasAtlas < 0.5) return vec4(0.0);
  float u;
  float v;
  float u0;
  float width;
  if (zone == 0.0 || zone == 2.0) {
    u = (p.y - liveryName.x) / liveryName.y;
    v = (p.z - liveryName.z) / liveryName.w;
    u0 = 0.0;
    width = ${f(LIVERY_ATLAS.nameWidth)};
  } else if (zone == 4.0 || zone == 5.0) {
    float markHeight = liveryMark.z * ${f(LIVERY_ATLAS.rowHeight / LIVERY_ATLAS.markWidth)};
    u = (p.y - liveryMark.x) / liveryMark.z + 0.5;
    v = (p.z - liveryMark.y) / markHeight + 0.5;
    u0 = ${f(LIVERY_ATLAS.nameWidth)};
    width = ${f(LIVERY_ATLAS.markWidth)};
  } else {
    return vec4(0.0);
  }
  if (p.x < 0.0) u = 1.0 - u;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return vec4(0.0);
  return texture(liveryAtlas, vec2((u0 + u * width) / ${f(LIVERY_ATLAS.width)}, 1.0 - (row + 1.0 - v) / liveryRows));
}

vec3 liveryColour(vec3 p, float row, float part) {
  if (part > 1.5) return ${glslColour(FIXED_COLOURS.tyre)};
  if (part > 0.5) return ${glslColour(FIXED_COLOURS.gearMetal)};
  float zone = liveryZone(p);
  if (zone == ${f(FIXED_ZONES.cockpit)}) return ${glslColour(FIXED_COLOURS.cockpit)};
  vec3 colour = texelFetch(liveryPalette, ivec2(int(zone), int(row + 0.5)), 0).rgb;
  vec4 letter = liveryLettering(p, zone, row);
  return mix(colour, letter.rgb, letter.a);
}
`;

function glslColour(hex) {
  const [r, g, b] = linearRgb(hex);
  return `vec3(${r.toFixed(5)}, ${g.toFixed(5)}, ${b.toFixed(5)})`;
}

const VERTEX_HEAD = `
attribute float liveryIndex;
attribute float liveryGear;
attribute float liveryPart;
varying vec3 vLiveryPos;
varying float vLiveryIndex;
varying float vLiveryPart;
`;

// The gear of an instance whose gear is up folds to a point: its triangles draw nothing.
const VERTEX_BODY = `
vLiveryPos = transformed;
vLiveryIndex = liveryIndex;
vLiveryPart = liveryPart;
if (liveryPart > 0.5 && liveryGear < 0.5) transformed = vec3(0.0);
`;

const COLOUR_FRAGMENT = `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  if (vLiveryIndex < -0.5) diffuseColor *= vColor;
#endif
if (vLiveryIndex > -0.5) diffuseColor.rgb = liveryColour(vLiveryPos, vLiveryIndex, vLiveryPart);
`;

/** Injects the livery into the GLSL of three's Lambert material (its `#include` hooks). Throws when one is missing. */
export function injectLivery({ vertexShader, fragmentShader }) {
  const hooks = [[vertexShader, '#include <common>'], [vertexShader, '#include <begin_vertex>'],
    [fragmentShader, '#include <common>'], [fragmentShader, '#include <color_fragment>']];
  for (const [source, hook] of hooks) {
    if (!source.includes(hook)) throw new Error(`The material's shader has no ${hook}.`);
  }
  return {
    vertexShader: vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`),
    fragmentShader: fragmentShader.replace('#include <common>', `#include <common>\n${LIVERY_GLSL}`)
      .replace('#include <color_fragment>', COLOUR_FRAGMENT),
  };
}

/** The uniforms of a type's frame (liveryFrame), as the GLSL reads them. */
export function frameUniforms(frame) {
  const engines = new Float32Array(4 * MAX_ENGINES);
  const engineY = new Float32Array(2 * MAX_ENGINES);
  frame.engines.forEach((engine, index) => {
    engines.set([engine.x, engine.z, engine.reachM, 0], 4 * index);
    engineY.set([engine.y0M, engine.y1M], 2 * index);
  });
  return {
    liveryBody: { value: [frame.yMinM, frame.halfLengthM, frame.axisZM, frame.halfWidthM] },
    liveryFin: { value: [frame.fin.rootZM, frame.fin.topZM, frame.fin.aftYM, frame.radiusM] },
    liveryMark: { value: [frame.fin.markYM, frame.fin.markZM, frame.fin.markWidthM, frame.fin.rootChordM] },
    liveryName: { value: [frame.name.y0M, frame.name.lengthM, frame.name.z0M, frame.name.heightM] },
    liveryEngines: { value: engines },
    liveryEngineY: { value: engineY },
  };
}

// ----------------------------------------------------------------------------------------------------------- atlas

/** The app's typeface as the page loaded it (next/font: --font-manrope), else LIVERY_FONT_FALLBACK. */
export function liveryFont(root = typeof document === 'undefined' ? null : document.body) {
  try {
    const family = root ? getComputedStyle(root).getPropertyValue('--font-manrope').trim() : '';
    return family !== '' ? `${family}, ${LIVERY_FONT_FALLBACK}` : LIVERY_FONT_FALLBACK;
  } catch {
    return LIVERY_FONT_FALLBACK;
  }
}

/** The longest side, in pixels, of a logo tinted for the fin (tintLogo). */
export const LOGO_MAX_PX = 1024;

/**
 * A logo in one colour (PR M5): the text logos are drawn on the fin in its text colour (`colour`, `#rrggbb`), not in
 * their brand colours, so they read on any fin. Answers a canvas from `createCanvas(width, height)` the logo's shape
 * filled with the colour (its longest side at most LOGO_MAX_PX), or the image itself when no 2D canvas can be made.
 */
export function tintLogo(image, colour, createCanvas) {
  const width = image?.naturalWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.height || 0;
  if (!(width > 0 && height > 0) || typeof createCanvas !== 'function') return image;
  const scale = Math.min(1, LOGO_MAX_PX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(w, h);
  const context = canvas?.getContext?.('2d') ?? null;
  if (!context) return image;
  context.clearRect(0, 0, w, h);
  context.drawImage(image, 0, 0, w, h);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = colour;
  context.fillRect(0, 0, w, h);
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Paints the lettering atlas (LIVERY_ATLAS) on a 2D context: per row of `rows` (liveries), the airline's name as it
 * sets it (liveries.js: liveryName) centred in the name's cell in its text colour, and in the mark's cell its logo
 * (`logos.get(logoTexture)`, a loaded image, fitted inside) or else its IATA code in its fin's text colour. The rest
 * stays transparent: the body shows through. Pure drawing.
 */
export function paintLiveryAtlas(context, { rows = LIVERY_ROWS, logos = new Map(), font = LIVERY_FONT_FALLBACK } = {}) {
  const { width, rowHeight, nameWidth, markWidth } = LIVERY_ATLAS;
  context.clearRect(0, 0, width, rows.length * rowHeight);
  rows.forEach((livery, row) => {
    const top = row * rowHeight;
    const middle = top + rowHeight / 2;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const name = liveryName(livery);
    if (name !== '') {
      context.font = `800 ${Math.round(0.72 * rowHeight)}px ${font}`;
      context.fillStyle = livery.text;
      context.fillText(name, nameWidth / 2, middle, nameWidth - 8);
    }
    const logo = livery.logoTexture ? logos.get(livery.logoTexture) ?? null : null;
    if (logo) {
      const ratio = (logo.naturalWidth || logo.width || 1) / (logo.naturalHeight || logo.height || 1);
      const fitW = Math.min(markWidth - 8, (rowHeight - 8) * ratio);
      const fitH = fitW / ratio;
      context.drawImage(logo, nameWidth + (markWidth - fitW) / 2, middle - fitH / 2, fitW, fitH);
    } else if (livery.iata) {
      context.font = `800 ${Math.round(0.8 * rowHeight)}px ${font}`;
      context.fillStyle = livery.tailText;
      context.fillText(livery.iata, nameWidth + markWidth / 2, middle, markWidth - 8);
    }
  });
}

/**
 * The textures every livery material shares: `{ palette, atlas, rows, refresh(logos), dispose }`. `palette` a
 * DataTexture of liveryPaletteData; `atlas` a CanvasTexture of paintLiveryAtlas, or null without a canvas (Node: the
 * models then wear their colours without lettering); `refresh(logos)` paints the atlas again with the logos loaded
 * since (Map of logoTexture → image) and answers whether it did.
 */
export function createLiveryTextures(three, { createCanvas = null, font = LIVERY_FONT_FALLBACK, rows = LIVERY_ROWS } = {}) {
  const palette = new three.DataTexture(liveryPaletteData(rows), LIVERY_ZONES.length, rows.length, three.RGBAFormat,
    three.FloatType);
  palette.magFilter = three.NearestFilter;
  palette.minFilter = three.NearestFilter;
  palette.needsUpdate = true;
  const canvas = typeof createCanvas === 'function' ? createCanvas(LIVERY_ATLAS.width, rows.length * LIVERY_ATLAS.rowHeight) : null;
  const context = canvas?.getContext?.('2d') ?? null;
  let atlas = null;
  if (context) {
    paintLiveryAtlas(context, { rows, font });
    atlas = new three.CanvasTexture(canvas);
    atlas.colorSpace = three.SRGBColorSpace;
    atlas.anisotropy = 4;
  }
  return {
    palette,
    atlas,
    rows: rows.length,
    refresh(logos) {
      if (atlas === null) return false;
      paintLiveryAtlas(context, { rows, logos, font });
      atlas.needsUpdate = true;
      return true;
    },
    dispose() {
      palette.dispose();
      atlas?.dispose();
    },
  };
}

/**
 * A livery material for one type: three's Lambert material (lit as the procedural models are, both sides) whose shader
 * paints the zones of `frame` (liveryFrame) from the shared `textures` (createLiveryTextures), per instance by its
 * `liveryIndex` attribute; −1 keeps the instance colour. Its geometry also carries `liveryPart` (0 the airframe, 1 the
 * gear's legs, 2 its tyres) and its instances `liveryGear` (1 down, 0 up: the gear folds away).
 */
export function createLiveryMaterial(three, { frame, textures }) {
  const material = new three.MeshLambertMaterial({ color: 0xffffff, side: three.DoubleSide });
  material.name = 'livery';
  const uniforms = {
    ...frameUniforms(frame),
    liveryPalette: { value: textures.palette },
    liveryAtlas: { value: textures.atlas ?? textures.palette },
    liveryHasAtlas: { value: textures.atlas ? 1 : 0 },
    liveryRows: { value: textures.rows },
  };
  material.userData.liveryUniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    Object.assign(shader, injectLivery(shader));
  };
  material.customProgramCacheKey = () => 'occ-livery-v1';
  return material;
}
