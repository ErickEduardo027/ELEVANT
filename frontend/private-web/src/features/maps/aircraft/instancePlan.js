import { occColor } from '../../occ-ui/occPalette';
import { EARTH_RADIUS_M, METRES_PER_NM, haversineM } from '../airport/geo';
import { altitudeColour, mapColorsFor } from '../style/mapColors';
import {
  AIRCRAFT_ICON_INSET, AIRCRAFT_ICON_SIZES, DEMO_PLATE_CENTRE_PX, DEMO_PLATE_IMAGE, ESTIMATED_RING_IMAGE, aircraftImage,
} from '../style/trafficImages';
import { TRAFFIC_SCALES, altitudeFeet, drawnRadius, isDrawn, tagTextOf } from '../traffic/trafficFeatures';
import { OUTSIDE_FILTER_OPACITY, TAG_DECLUTTER_UNTIL_ZOOM, TAG_STYLE } from '../traffic/trafficLayers';
import { gearDown } from './attitude';
import { LIVERY_ZONES, liveryZones, resolveLivery } from './liveries';
import { SPRITE_CELLS, cellUv } from './spriteAtlas';
import { resolveAircraftType } from './types';
import { contactShadowMatrix, contactShadowSize, contactShadowStrength } from './contactShadow';

// What the 3D layer draws (design G1 and G3, contracts 2.3 and 2.4): one entry per aircraft type present, with the
// instance matrices and colours of its aircraft and of their ground shadows, in the local frame of the ARP. Pure, and
// free of three: the map plans again when something moves and hands the plan to the layer
// (aircraft/aircraft3dLayer.js) with a new revision, so the layer copies matrices only then.
//
// The frame: x east, y north and z up, in metres of the Mercator scale at the ARP, the ground at z = 0. Its matrix is
// MapLibre's own model transform for a custom layer, so a model stands exactly where the 2D layers draw its position.
// An instance matrix is T(x, y, z) · Rz(−heading): the models of aircraft/aircraftGeometry.js point their nose at +y,
// so a heading of 0 points it north and 90 east.

/** Only aircraft this close to the ARP are drawn in 3D (design G1): the airfield and its approaches. */
export const AIRCRAFT_3D_RADIUS_NM = 6;

// Note of 2026-11-27 (M9, approved plan): on Mapa de posiciones only, contracts 2.4 give way twice. Its 3D aircraft wear
// their airlines' liveries (brand colours of aircraft/liveries.js, the chosen one still in the accent), and other
// traffic on the ground near the field is drawn in 3D too, while the governor is at full quality. Every other map keeps
// the monochrome aircraft and its ground traffic in 2D: both are options of planInstances, off by default.
/**
 * With the liveries on (M9, Mapa de posiciones), other traffic on the ground this close to the ARP is drawn in 3D too:
 * the airfield, its aprons and its taxiways, not an aircraft parked at a field nearby.
 */
export const GROUND_TRAFFIC_3D_RADIUS_M = 4_000;

/** Above this height an airborne aircraft gets a drop line to the ground, so its position on the map reads. */
export const DROP_LINE_MIN_M = 3;

/** The ground shadow: the model flattened to a hundredth of its height, five centimetres above the ground. */
export const SHADOW = Object.freeze({ heightM: 0.05, flatten: 0.01 });

/** How many distinct type descriptions the plan keeps resolved (aircraft/types.js: resolveAircraftType). */
export const TYPE_MEMO_LIMIT = 256;

const MAX_MERCATOR_LATITUDE = 85.051129;
// MapLibre's mercator coordinates (src/geo/mercator_coordinate.ts): the world is [0, 1] on both axes, y grows south,
// and one metre at latitude φ is 1 / (2π · 6 371 008.8 m · cos φ) units.
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M;
const mercatorX = lng => (180 + lng) / 360;
const mercatorY = lat => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const list = value => (Array.isArray(value) ? value : []);

/**
 * The local frame of the 3D layer at `originLngLat` (the ARP): `{ originX, originY, metreUnits, toLocal, matrix }`.
 * `originX` and `originY` are the origin's mercator coordinates, `metreUnits` the size of a metre there in mercator
 * units (MercatorCoordinate.meterInMercatorCoordinateUnits), `toLocal([lng, lat])` the point's `[x, y]` in metres east
 * and north on that scale, and `matrix` a new column-major Float64Array(16), translate(originX, originY, 0) ·
 * scale(s, −s, s) with s = metreUnits, that takes the frame to mercator coordinates.
 */
export function mercatorFrame(originLngLat) {
  const [lng, lat] = Array.isArray(originLngLat) ? originLngLat : [];
  if (!finite(lng) || !finite(lat) || Math.abs(lat) > MAX_MERCATOR_LATITUDE) {
    throw new RangeError(`A 3D frame needs an origin [lng, lat] on the mercator map, got ${String(originLngLat)}`);
  }
  const originX = mercatorX(lng);
  const originY = mercatorY(lat);
  const metreUnits = 1 / EARTH_CIRCUMFERENCE_M / Math.cos((lat * Math.PI) / 180);
  return Object.freeze({
    originX,
    originY,
    metreUnits,
    toLocal: ([pointLng, pointLat]) => [
      (mercatorX(pointLng) - originX) / metreUnits,
      (originY - mercatorY(pointLat)) / metreUnits,
    ],
    get matrix() {
      return Float64Array.of(metreUnits, 0, 0, 0, 0, -metreUnits, 0, 0, 0, 0, metreUnits, 0, originX, originY, 0, 1);
    },
  });
}

const HEX_COLOUR = /^#([\da-f]{3}|[\da-f]{6})$/i;
const RGB_COLOUR = /^rgba?\(\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;

// The sRGB transfer function, inverted with three's own constants (src/math/ColorManagement.js: SRGBToLinear).
const srgbToLinear = channel => (channel < 0.04045
  ? channel * 0.0773993808
  : Math.pow(channel * 0.9478672986 + 0.0521327014, 2.4));

/**
 * An sRGB colour of the palette (`#rgb`, `#rrggbb`, or `rgb(r g b / a)` without its alpha) as the frozen `[r, g, b]`
 * that three's colour management keeps in its linear working space: what an instance colour attribute holds.
 */
export function linearRgb(colour) {
  const text = typeof colour === 'string' ? colour.trim() : '';
  let channels = null;
  const hex = HEX_COLOUR.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1];
    channels = [0, 2, 4].map(start => Number.parseInt(digits.slice(start, start + 2), 16));
  } else {
    const rgb = RGB_COLOUR.exec(text);
    if (rgb) channels = rgb.slice(1, 4).map(Number);
  }
  if (channels === null || channels.some(channel => channel > 255)) {
    throw new RangeError(`Not an sRGB colour: ${String(colour)}`);
  }
  return Object.freeze(channels.map(channel => srgbToLinear(channel / 255)));
}

/**
 * The instance colours (contracts 2.4: no hue for what is normal, cyan for what is chosen): AVIAM aircraft in the
 * text colour, other traffic in the faint one, the chosen aircraft in the accent, shadows in the darkest slab.
 */
export const AIRCRAFT_3D_COLORS = Object.freeze({
  aviam: linearRgb(occColor('text')),
  other: linearRgb(occColor('faint')),
  selected: linearRgb(occColor('accent')),
  shadow: linearRgb(occColor('nav')),
});

// On the light map (ADR-0044, note of 2026-11-15) the same roles in its own tokens: AVIAM aircraft in the panels'
// white, other traffic in the strong line's grey, the chosen one in the light theme's accent and the shadows in the
// faint ink, so a model stands off the light pavement and still carries no hue but the selection's.
const LIGHT_3D_COLORS = Object.freeze({
  aviam: linearRgb(occColor('panel', 'light')),
  other: linearRgb(occColor('line-strong', 'light')),
  selected: linearRgb(occColor('accent', 'light')),
  shadow: linearRgb(occColor('faint', 'light')),
});

/** The instance colours of `theme` ('light' or the dark default): AIRCRAFT_3D_COLORS in the dark one. */
export function aircraft3dColors(theme) {
  return theme === 'light' ? LIGHT_3D_COLORS : AIRCRAFT_3D_COLORS;
}

// The zones an instance paints besides its base colour (`colors`, the fuselage), in LIVERY_ZONES order.
const EXTRA_ZONES = Object.freeze(LIVERY_ZONES.filter(zone => zone !== 'fuselage'));
const liveryMemo = new Map();

/**
 * The instance colours of an aircraft's livery (M9): the linear `[r, g, b]` of each zone of LIVERY_ZONES
 * (aircraft/liveries.js: liveryZones) of the airline resolveLivery finds for `item`, frozen, kept per livery. The one
 * helper both the instanced procedural models and the models from files (lane M5) paint with.
 */
export function liveryInstanceColours(item) {
  const livery = resolveLivery(item);
  let colours = liveryMemo.get(livery.id);
  if (colours === undefined) {
    const zones = liveryZones(livery);
    colours = Object.freeze(Object.fromEntries(LIVERY_ZONES.map(zone => [zone, linearRgb(zones[zone])])));
    liveryMemo.set(livery.id, colours);
  }
  return colours;
}

// Every zone in one colour: the monochrome aircraft, the chosen one and the shadows.
const uniformZones = colour => Object.fromEntries(LIVERY_ZONES.map(zone => [zone, colour]));

/** The key of a resolved type in the plan: its ICAO designator, or `@` and its category for a generic airframe. */
export function instanceKey(resolved) {
  return resolved.code ?? `@${resolved.iconCategory}`;
}

// resolveAircraftType reads regular expressions; the same few descriptions come back every frame.
const typeMemo = new Map();

function resolvedTypeOf(item) {
  const description = [item.typeIcao, item.model, item.sizeCategory, item.emitterCategory]
    .map(value => (value == null ? '' : String(value))).join('\u0001');
  let resolved = typeMemo.get(description);
  if (resolved === undefined) {
    resolved = resolveAircraftType({ typeIcao: item.typeIcao ?? null, model: item.model ?? null,
      sizeCategory: item.sizeCategory ?? null, emitterCategory: item.emitterCategory ?? null });
    if (typeMemo.size >= TYPE_MEMO_LIMIT) typeMemo.delete(typeMemo.keys().next().value);
    typeMemo.set(description, resolved);
  }
  return resolved;
}

/** How many type descriptions the memo holds. Tests only. */
export function typeMemoSizeForTests() {
  return typeMemo.size;
}

// Row-major 4 × 4 products for poseMatrix.
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[4 * row + k] * b[4 * k + column];
      out[4 * row + column] = sum;
    }
  }
  return out;
}
const translationOf = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const rotationX = radians => [1, 0, 0, 0, 0, Math.cos(radians), -Math.sin(radians), 0, 0, Math.sin(radians),
  Math.cos(radians), 0, 0, 0, 0, 1];
const rotationY = radians => [Math.cos(radians), 0, Math.sin(radians), 0, 0, 1, 0, 0, -Math.sin(radians), 0,
  Math.cos(radians), 0, 0, 0, 0, 1];
const rotationZ = radians => [Math.cos(radians), -Math.sin(radians), 0, 0, Math.sin(radians), Math.cos(radians), 0, 0,
  0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The matrix that stands a model (nose toward +y, wheels at z = 0) where an aircraft is (CN-30), column-major as three's
 * Matrix4.elements: T(x, y, z) · Rz(−heading) · T(0, pivotY, 0) · Rx(pitch) · T(0, −pivotY, pivotZ) · Ry(bank) ·
 * T(0, 0, −pivotZ) · S(scale, scale, scale · flatten). The nose pitches up about the main wheels (`pivotY`), so on a
 * take-off the tail stays above the runway, and a right bank (positive) lowers the right wing about the fuselage's axis
 * (`pivotZ`). Without pitch, bank or scale it is T(x, y, z) · Rz(−heading) · S(1, 1, flatten).
 */
export function poseMatrix({
  x = 0, y = 0, z = 0, headingDeg = 0, pitchDeg = 0, bankDeg = 0, pivotY = 0, pivotZ = 0, scale = 1, flatten = 1,
} = {}) {
  const rad = value => (finite(value) ? (value * Math.PI) / 180 : 0);
  let m = multiply(translationOf(x, y, z), rotationZ(-rad(headingDeg)));
  if (pitchDeg !== 0 || bankDeg !== 0) {
    m = multiply(m, translationOf(0, pivotY, 0));
    m = multiply(m, rotationX(rad(pitchDeg)));
    m = multiply(m, translationOf(0, -pivotY, pivotZ));
    m = multiply(m, rotationY(rad(bankDeg)));
    m = multiply(m, translationOf(0, 0, -pivotZ));
  }
  m = multiply(m, [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale * flatten, 0, 0, 0, 0, 1]);
  // Row-major to column-major.
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) out[4 * column + row] = m[4 * row + column];
  }
  return out;
}

/**
 * Where a model pitches and banks (CN-30): over its main wheels, a little behind the middle of its length, about the
 * axis of its fuselage (aircraft/aircraftDetail.js says the same of its detailed model).
 */
export function pivotOf(spec) {
  return { y: -0.06 * spec.lengthM, z: 0.92 * spec.fuselageDiaM };
}

// Column-major, as three's Matrix4.elements: T(x, y, z) · Rz(−heading) · S(1, 1, flatten), with the attitude of
// poseMatrix when the aircraft has one.
function writeMatrix(target, offset, { x, y, z, headingDeg, flatten, pitchDeg = 0, bankDeg = 0, pivot = null }) {
  if ((pitchDeg !== 0 || bankDeg !== 0) && pivot !== null) {
    target.set(poseMatrix({ x, y, z, headingDeg, pitchDeg, bankDeg, pivotY: pivot.y, pivotZ: pivot.z, flatten }), offset);
    return;
  }
  const radians = (headingDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  target.set([cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, flatten, 0, x, y, z, 1], offset);
}

// What the layer can place, or null: other traffic on the ground stays 2D (contracts 2.4) unless it is within
// `groundRadiusM` of the ARP (M9), and an aircraft in the air without an altitude too, because no height is made up
// for it.
function placeable(item, { fieldElevationM, originLngLat, groundRadiusM }) {
  if (!isDrawn(item) || item.id == null) return null;
  const aviam = item.kind === 'aviam';
  if (item.onGround === true) {
    if (aviam) return { item, aviam, z: 0 };
    const near = groundRadiusM > 0 && finite(item.lon) && finite(item.lat)
      && haversineM(originLngLat, [item.lon, item.lat]) <= groundRadiusM;
    return near ? { item, aviam, z: 0 } : null;
  }
  if (!finite(item.altM)) return null;
  return { item, aviam, z: Math.max(0, item.altM - fieldElevationM) };
}

const byId = (a, b) => {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
};

/**
 * The 3D plan of the aircraft the map draws (design G3). `renderAircraft` are the map's aircraft
 * (traffic/situationModel.js: RenderAircraft); `parkedAircraft` the aircraft standing on their stands,
 * `{ id, lon, lat, headingDeg, typeIcao, model, sizeCategory, kind? }`, each owning the aircraft of the map with its id.
 *
 * Answers `Map<key, { spec, approximate, aircraftCount, count, matrices, colors, zoneColors, floorLengths, ids, liveries,
 * gear, dropLines, contacts, contactStrengths }>`, the keys
 * dropLines }>`, the keys
 * (instanceKey) sorted, empty below `minZoom` (the caller's 3D threshold: the airfield fit − 0.3, contracts 2.3):
 * - only aircraft within AIRCRAFT_3D_RADIUS_NM of `originLngLat` (the ARP) that the 2D layers draw (isDrawn); other
 *   traffic on the ground stays 2D, and so does an aircraft in the air without an altitude;
 * - an airborne aircraft stands at its height above the field, `max(0, altM − fieldElevationM)`, with a drop line
 *   (`dropLines`: x, y, z, x, y, 0 per line) above DROP_LINE_MIN_M; one on the ground, or parked, at zero;
 * - its heading is `trackDeg`, else `headingDeg`, else 0 (north);
 * - each entry holds `aircraftCount` aircraft sorted by id, then as many flat dark shadows in the same order
 *   (`count` = 2 × aircraftCount): `matrices` 16 floats and `colors` 3 linear floats per instance, `ids` the
 *   aircraft's id for an aircraft and `null` for a shadow;
 * - `floorLengths` (PR M7) holds, per instance, the model's length in metres for an aircraft of the traffic and its
 *   shadow, which the layer may draw larger at a far zoom (aircraft3dLayer.js: minModelPx), and 0 for one on its stand;
 * - colours (`colors` option, AIRCRAFT_3D_COLORS by default): the chosen aircraft (`selectedId`) in `selected`, AVIAM
 *   aircraft in `aviam`, other traffic in `other`, shadows in `shadow`; `colors` paints the fuselage and `zoneColors`
 *   (`{ belly, tail, engine, wing }`, 3 linear floats per instance each) the other zones of aircraft/liveries.js:
 *   LIVERY_ZONES, in the same colour unless `livery`;
 * - M9: with `livery`, every aircraft but the chosen one and the shadows wears its airline's livery
 *   (liveryInstanceColours: fuselage, belly, fin, engines and wings), and with `groundRadiusM` other traffic on the
 *   ground within that many metres of the ARP is drawn too (GROUND_TRAFFIC_3D_RADIUS_M), as the traffic is;
 * - PR M5: `liveries` holds per instance the id of the livery a type's glTF model wears up close (aircraft/liveries.js:
 *   resolveLivery, painted by aircraft/liveryMaterial.js from the same liveryPaint as `zoneColors`): for an AVIAM
 *   aircraft, and with `livery` (M9, the Mapa de posiciones' exception to contracts 2.4) for every aircraft; null for
 *   the chosen aircraft (it keeps the selection's accent), for other traffic without `livery` (it keeps its plain
 *   colour, so the livery itself marks AVIAM's aircraft) and for a shadow; `gear` 1 where the landing gear is down (on
 *   a stand, on the ground, or as aircraft/attitude.js eased it) and 0 where it is up, a shadow as its aircraft;
 * - `spec` and `approximate` come from resolveAircraftType: a type the table lacks takes its category's generic
 *   airframe under the category's own key, approximate.
 * - CN-30: `attitudes` (`Map<id, { heightM, pitchDeg, bankDeg }>`, aircraft/attitude.js) pitch and bank an aircraft of
 *   the traffic (poseMatrix) and set its height; its shadow stays level. `excludeId` is left out of the plan: the
 *   aircraft the detailed model draws (core/aircraft3d.js).
 * - M4 (2026-11-28): `contacts` holds the matrix of each aircraft's soft contact shadow (contactShadow.js: 16 floats,
 *   in the aircraft's order) and `contactStrengths` its strength, 1 on the ground and 0 from CONTACT_SHADOW.fadeM up
 *   (its matrix then zero).
 * - PR M2: `radiusNm` widens the circle (AIRCRAFT_3D_RADIUS_NM by default; Infinity for none): the animated layer draws
 *   every aircraft in sight as a model, and the layer's size floor keeps the far ones from vanishing.
 * The input is never changed; the same input gives the same plan.
 */
export function planInstances(renderAircraft = [], parkedAircraft = [], {
  zoom, minZoom, originLngLat, fieldElevationM = 0, selectedId = null, colors = AIRCRAFT_3D_COLORS,
  attitudes = null, excludeId = null, livery = false, groundRadiusM = 0, radiusNm = AIRCRAFT_3D_RADIUS_NM,
} = {}) {
  const plan = new Map();
  if (!(zoom >= minZoom)) return plan;
  const radiusM = (finite(radiusNm) ? radiusNm : Infinity) * METRES_PER_NM;
  const attitudeOf = id => (attitudes instanceof Map ? attitudes.get(id) ?? null : null);
  const frame = mercatorFrame(originLngLat);
  const field = finite(fieldElevationM) ? fieldElevationM : 0;

  const parked = new Map();
  for (const item of list(parkedAircraft)) {
    if (item?.id == null || !finite(item.lon) || !finite(item.lat) || item.id === excludeId) continue;
    parked.set(item.id, { item, aviam: item.kind !== 'other', z: 0, onStand: true });
  }
  const placed = [...parked.values()];
  for (const item of list(renderAircraft)) {
    if (item?.id == null || parked.has(item.id) || item.id === excludeId) continue;
    const entry = placeable(item, { fieldElevationM: field, originLngLat,
      groundRadiusM: finite(groundRadiusM) ? groundRadiusM : 0 });
    if (entry !== null) placed.push(entry);
  }

  const plain = { aviam: uniformZones(colors.aviam), other: uniformZones(colors.other) };
  const selectedZones = uniformZones(colors.selected);
  const shadowZones = uniformZones(colors.shadow);
  const paintOf = entry => {
    if (entry.item.id === selectedId) return selectedZones;
    if (livery === true) return liveryInstanceColours(entry.item);
    return plain[entry.aviam ? 'aviam' : 'other'];
  };

  const groups = new Map();
  for (const entry of placed) {
    const point = [entry.item.lon, entry.item.lat];
    if (radiusM !== Infinity && haversineM(originLngLat, point) > radiusM) continue;
    const resolved = resolvedTypeOf(entry.item);
    const key = instanceKey(resolved);
    const [x, y] = frame.toLocal(point);
    const { trackDeg, headingDeg } = entry.item;
    let heading = 0;
    if (finite(trackDeg)) heading = trackDeg;
    else if (finite(headingDeg)) heading = headingDeg;
    const group = groups.get(key) ?? { resolved, members: [] };
    // The attitude the controller eased for it (CN-30): its pitch, its bank and its height over the field.
    const attitude = entry.onStand === true ? null : attitudeOf(entry.item.id);
    const z = finite(attitude?.heightM) ? attitude.heightM : entry.z;
    const selected = entry.item.id === selectedId;
    // PR M5: the livery its type's model wears up close, and its gear. Only an AVIAM aircraft wears its airline's
    // livery: the chosen one keeps the selection's accent and other traffic its plain colour, so the 3D picture still
    // tells AVIAM's aircraft from the rest (contracts 2.4; ADR-0043, note of 2026-11-28). With `livery` (M9, the Mapa
    // de posiciones) every aircraft but the chosen one wears it, as its procedural model does (paintOf).
    const down = entry.onStand === true || (typeof attitude?.gearDown === 'boolean' ? attitude.gearDown
      : gearDown({ heightM: z, onGround: entry.item.onGround === true, phase: entry.item.phase ?? null,
        vrateMs: finite(entry.item.vrateMs) ? entry.item.vrateMs : null }));
    group.members.push({ id: entry.item.id, x, y, z, headingDeg: heading, onStand: entry.onStand === true,
      livery: selected || !(entry.aviam || livery === true) ? null : resolveLivery(entry.item).id, gearDown: down,
      pitchDeg: finite(attitude?.pitchDeg) ? attitude.pitchDeg : 0, bankDeg: finite(attitude?.bankDeg) ? attitude.bankDeg : 0,
      pivot: pivotOf(resolved.spec),
      zones: paintOf(entry) });
    groups.set(key, group);
  }

  for (const key of [...groups.keys()].sort()) {
    const { resolved, members } = groups.get(key);
    members.sort(byId);
    const aircraftCount = members.length;
    const matrices = new Float32Array(32 * aircraftCount);
    const instanceColors = new Float32Array(6 * aircraftCount);
    const zoneColors = Object.fromEntries(EXTRA_ZONES.map(zone => [zone, new Float32Array(6 * aircraftCount)]));
    // The length a model may grow from (aircraft3dLayer.js: minModelPx): an aircraft of the traffic, as its 2D symbol,
    // is never drawn smaller than a few pixels; one on its stand keeps the stand's scale, as its footprint does.
    const floorLengths = new Float32Array(2 * aircraftCount);
    const ids = [];
    const liveries = [];
    const gear = new Float32Array(2 * aircraftCount);
    const drops = [];
    // M4: the soft contact shadow under each aircraft (contactShadow.js), fading with its height.
    const contacts = new Float32Array(16 * aircraftCount);
    const contactStrengths = new Float32Array(aircraftCount);
    members.forEach((member, index) => {
      writeMatrix(matrices, 16 * index, { ...member, flatten: 1 });
      writeMatrix(matrices, 16 * (aircraftCount + index), { ...member, z: SHADOW.heightM, flatten: SHADOW.flatten,
        pitchDeg: 0, bankDeg: 0 });
      instanceColors.set(member.zones.fuselage, 3 * index);
      instanceColors.set(shadowZones.fuselage, 3 * (aircraftCount + index));
      for (const zone of EXTRA_ZONES) {
        zoneColors[zone].set(member.zones[zone], 3 * index);
        zoneColors[zone].set(shadowZones[zone], 3 * (aircraftCount + index));
      }
      ids[index] = member.id;
      ids[aircraftCount + index] = null;
      liveries[index] = member.livery;
      liveries[aircraftCount + index] = null;
      gear[index] = member.gearDown ? 1 : 0;
      gear[aircraftCount + index] = gear[index];
      const floor = member.onStand ? 0 : resolved.spec.lengthM;
      floorLengths[index] = floor;
      floorLengths[aircraftCount + index] = floor;
      if (member.z > DROP_LINE_MIN_M) drops.push(member.x, member.y, member.z, member.x, member.y, 0);
      const strength = contactShadowStrength(member.z);
      contactStrengths[index] = strength;
      if (strength > 0) {
        contacts.set(contactShadowMatrix({ x: member.x, y: member.y, headingDeg: member.headingDeg,
          ...contactShadowSize(resolved.spec, member.z) }), 16 * index);
      }
    });
    plan.set(key, Object.freeze({
      spec: resolved.spec,
      approximate: resolved.approximate,
      aircraftCount,
      count: 2 * aircraftCount,
      matrices,
      colors: instanceColors,
      zoneColors: Object.freeze(zoneColors),
      floorLengths,
      ids: Object.freeze(ids),
      liveries: Object.freeze(liveries),
      gear,
      dropLines: Float32Array.from(drops),
      contacts,
      contactStrengths,
    }));
  }
  return plan;
}

// The sRGB channels of a #rrggbb colour, 0 to 1: the sprites' shader paints them as they are, as MapLibre does.
const srgbMemo = new Map();
function srgb(colour) {
  let channels = srgbMemo.get(colour);
  if (channels === undefined) {
    const match = /^#([\da-f]{6})$/i.exec(colour ?? '');
    if (match === null) throw new RangeError(`Not a #rrggbb colour: ${String(colour)}`);
    channels = Object.freeze([0, 2, 4].map(start => Number.parseInt(match[1].slice(start, start + 2), 16) / 255));
    srgbMemo.set(colour, channels);
  }
  return channels;
}

// The plate's centre below an aircraft of drawn half size `radius` (traffic/trafficLayers.js: plateOffset).
function plateCentrePx(radius) {
  let centre = DEMO_PLATE_CENTRE_PX[0][1];
  for (const [from, value] of DEMO_PLATE_CENTRE_PX) if (radius >= from) centre = value;
  return centre;
}

const clamp01 = value => Math.min(1, Math.max(0, value));

/**
 * The flat sprites of the animated traffic layer (PR M2, aircraft/aircraft3dLayer.js): what the GeoJSON layers draw of
 * each aircraft (traffic/trafficLayers.js), at the positions of this frame. `aircraft` are the aircraft of the frame
 * (the write's items at their interpolated positions, traffic/keyframes.js); options:
 * - `originLngLat` (the ARP of the layer's frame), `theme` (the altitude colours and the chosen aircraft's and the
 *   estimated ring's OCC colours, as style/occStyle.js swaps them for the GeoJSON layers), `selectedId`;
 * - `modelIds`: aircraft drawn as models (no silhouette, their marks stay); `parkedIds`: ELEVANT aircraft their stand
 *   draws (no silhouette unless chosen, their marks stay);
 * - M8 (integration with M2): `outsideIds`, the aircraft Monitoreo's board filter leaves out (OccMap's flightEmphasis),
 *   whose silhouette and «Demo» plate are dimmed by OUTSIDE_FILTER_OPACITY as the GeoJSON layers dim them (their
 *   estimated ring is not, as the GeoJSON ring is not);
 * - M4 (integration with M2): `closeUpId`, close up («Seguir en 3D» past zoom 19.5), the followed aircraft, whose
 *   estimated ring and «Demo» plate are left out, as the GeoJSON layers leave them (they sat on its model's tail).
 * Each sprite is a rectangle of the atlas (aircraft/spriteAtlas.js) on the ground of the frame, sized in CSS pixels, so
 * the layer scales it by the metres of a pixel at the frame's zoom and it keeps its size on screen as an icon does:
 * - a silhouette: its category's (hollow for a departing ELEVANT flight), turned to its track, `scale` as
 *   trafficFeatures sizes it, tinted with the altitude scale (style/mapColors.js: grey on the ground), the chosen one in
 *   the accent, dimmed to half when stale and faded by its own opacity;
 * - an estimated position: its dashed ring, muted; a demo flight: its «Demo» plate below it, facing the screen at every
 *   pitch and bearing as the GeoJSON plate does (aircraft/trafficSprites.js draws an image with its own colours as a
 *   billboard: its size and offset are screen pixels, its matrix only places its aircraft).
 * Answers `{ count, matrices, colors, halos, opacities, sizes, offsets, cells, plain, ids }`: per sprite 16 floats
 * (T(x, y, 0) · Rz(−angle), column-major), 3 sRGB floats of tint and of halo, its opacity, its width and height in px,
 * its offset in px along its own axes, its atlas rectangle `[u0, v0, du, dv]`, 1 for an image with its own colours, and
 * the aircraft's id for a silhouette (null for a mark). Drawing order: other traffic on the ground, other traffic in the
 * air, ELEVANT flights, the chosen aircraft, then the rings and the plates.
 */
export function planSprites(aircraft = [], {
  originLngLat, theme = 'dark', selectedId = null, modelIds = null, parkedIds = null, outsideIds = null,
  closeUpId = null,
} = {}) {
  const frame = mercatorFrame(originLngLat);
  const models = modelIds instanceof Set ? modelIds : new Set();
  const parked = parkedIds instanceof Set ? parkedIds : new Set();
  const outside = outsideIds instanceof Set ? outsideIds : null;
  const halo = mapColorsFor(theme).altitude.halo;
  const bands = [[], [], [], [], [], []];
  for (const item of list(aircraft)) {
    if (item?.id == null || !isDrawn(item)) continue;
    const aviam = item.kind === 'aviam';
    const departure = aviam && item.direction === 'Departure';
    const ground = item.onGround === true;
    const selected = item.id === selectedId;
    const category = resolvedTypeOf(item).iconCategory;
    let scale = TRAFFIC_SCALES.other;
    if (selected) scale = TRAFFIC_SCALES.selected;
    else if (aviam) scale = TRAFFIC_SCALES.aviam;
    else if (ground) scale = TRAFFIC_SCALES.otherGround;
    const [x, y] = frame.toLocal([item.lon, item.lat]);
    const own = finite(item.opacity) ? clamp01(item.opacity) : 1;
    const dimmed = own * (item.quality === 'stale' ? 0.5 : 1)
      * (outside !== null && outside.has(item.id) ? OUTSIDE_FILTER_OPACITY : 1);
    const bare = closeUpId != null && item.id === closeUpId;
    const icon = aircraftImage(category, { hollow: departure });
    const iconPx = SPRITE_CELLS[icon].width * scale;
    if (!models.has(item.id) && (selected || !(aviam && parked.has(item.id)))) {
      let band = 2;
      if (selected) band = 3;
      else if (!aviam) band = ground ? 0 : 1;
      bands[band].push({ id: item.id, x, y, angle: finite(item.trackDeg) ? item.trackDeg : 0, image: icon,
        width: iconPx, height: iconPx, offsetY: 0,
        tint: selected ? occColor('accent', theme) : altitudeColour(theme, { ground, altFt: altitudeFeet(item) }),
        halo: selected ? occColor('nav', theme) : halo, opacity: dimmed });
    }
    if (item.quality === 'estimated' && !bare) {
      const ring = SPRITE_CELLS[ESTIMATED_RING_IMAGE];
      bands[4].push({ id: null, x, y, angle: 0, image: ESTIMATED_RING_IMAGE, width: ring.width * scale,
        height: ring.height * scale, offsetY: 0, tint: occColor('muted', theme), halo: occColor('nav', theme), opacity: own });
    }
    if (aviam && item.isDemo === true && !bare) {
      const plate = SPRITE_CELLS[DEMO_PLATE_IMAGE];
      const radius = Math.round(((AIRCRAFT_ICON_SIZES[category] - 2 * AIRCRAFT_ICON_INSET) / 2) * scale * 10) / 10;
      bands[5].push({ id: null, x, y, angle: 0, image: DEMO_PLATE_IMAGE,
        width: plate.width, height: plate.height, offsetY: -plateCentrePx(radius), tint: '#ffffff', halo: '#ffffff',
        opacity: dimmed });
    }
  }
  const sprites = bands.flat();
  const count = sprites.length;
  const matrices = new Float32Array(16 * count);
  const colors = new Float32Array(3 * count);
  const halos = new Float32Array(3 * count);
  const opacities = new Float32Array(count);
  const sizes = new Float32Array(2 * count);
  const offsets = new Float32Array(2 * count);
  const cells = new Float32Array(4 * count);
  const plain = new Float32Array(count);
  const ids = [];
  sprites.forEach((sprite, index) => {
    writeMatrix(matrices, 16 * index, { x: sprite.x, y: sprite.y, z: 0, headingDeg: sprite.angle, flatten: 1 });
    colors.set(srgb(sprite.tint), 3 * index);
    halos.set(srgb(sprite.halo), 3 * index);
    opacities[index] = sprite.opacity;
    sizes[2 * index] = sprite.width;
    sizes[2 * index + 1] = sprite.height;
    offsets[2 * index + 1] = sprite.offsetY;
    cells.set(cellUv(sprite.image), 4 * index);
    plain[index] = SPRITE_CELLS[sprite.image].plain ? 1 : 0;
    ids[index] = sprite.id;
  });
  return Object.freeze({ count, matrices, colors, halos, opacities, sizes, offsets, cells, plain,
    ids: Object.freeze(ids) });
}

/**
 * Which tags of the animated traffic may show, where, and how strongly (PR M2, aircraft/trafficLabels.js lays them out),
 * as the GeoJSON tags show them (traffic/trafficLayers.js, CN-29):
 * - an ELEVANT flight's always, except on the stand that draws it (`parkedIds`); below TAG_DECLUTTER_UNTIL_ZOOM it gives
 *   way where it would cover another tag (the chosen one's first, then those in the air, then those on the ground);
 *   from that zoom on it shows over what is there;
 * - other traffic's while it is chosen or under the pointer (`focusId`), and with «Etiquetas de todo el tráfico»
 *   (`labelsOn`) from `otherTagsMinZoom` up, giving way to every other tag (low zoom: ELEVANT, chosen and hovered only).
 * `aircraft` are the aircraft of the frame; `words` their tags' words by id (traffic/trafficFeatures.js: tagTextOf,
 * made at the write; one missing is made here). Answers `{ tags, marks, ring }` in the frame's metres: `tags`
 * `{ id, x, y, tag, priority, always, offsetPx, opacity }` (the gap past the silhouette as the GeoJSON tags keep it,
 * the opacity of a stale or fading aircraft), `marks` `{ id, x, y, radius }` the silhouettes a tag keeps off, and
 * `ring` `{ x, y }` the chosen aircraft's ring, or null.
 * - M8 (integration with M2): the tags of `outsideIds` (Monitoreo's board filter) are dimmed by OUTSIDE_FILTER_OPACITY,
 *   as the GeoJSON tags are.
 * - M4 (integration with M2): `closeUp` («Seguir en 3D» past zoom 19.5) shows no tag and no ring, as the GeoJSON tags
 *   and the selection rings hide close up (core/mapEngine.js: setCloseUp); the marks stay.
 */
export function planLabels(aircraft = [], {
  originLngLat, selectedId = null, focusId = null, labelsOn = false, zoom = null, words = null, parkedIds = null,
  language = 'es', otherTagsMinZoom = null, outsideIds = null, closeUp = false,
} = {}) {
  const frame = mercatorFrame(originLngLat);
  const parked = parkedIds instanceof Set ? parkedIds : new Set();
  const outside = outsideIds instanceof Set ? outsideIds : null;
  const hidden = closeUp === true;
  const close = finite(zoom) && zoom >= TAG_DECLUTTER_UNTIL_ZOOM;
  const othersShown = labelsOn === true && (!finite(otherTagsMinZoom) || (finite(zoom) && zoom >= otherTagsMinZoom));
  const tags = [];
  const marks = [];
  let ring = null;
  for (const item of list(aircraft)) {
    if (item?.id == null || !isDrawn(item)) continue;
    const aviam = item.kind === 'aviam';
    const ground = item.onGround === true;
    const selected = item.id === selectedId;
    const focused = item.id === focusId;
    const onStand = aviam && parked.has(item.id);
    let scale = TRAFFIC_SCALES.other;
    if (selected) scale = TRAFFIC_SCALES.selected;
    else if (aviam) scale = TRAFFIC_SCALES.aviam;
    else if (ground) scale = TRAFFIC_SCALES.otherGround;
    const radius = drawnRadius(resolvedTypeOf(item).iconCategory, scale);
    const [x, y] = frame.toLocal([item.lon, item.lat]);
    if (selected && !hidden) ring = { x, y };
    if (!onStand || selected) marks.push({ id: item.id, x, y, radius });
    if (hidden) continue;
    let priority = null;
    let always = false;
    if (aviam && !onStand) {
      always = close || selected || focused;
      if (selected) priority = 0;
      else priority = close || !ground ? 1 : 2;
    } else if (!aviam && (selected || focused)) {
      priority = 0;
      always = true;
    } else if (!aviam && othersShown) priority = 3;
    if (priority === null) continue;
    const tag = words?.get?.(item.id) ?? tagTextOf(item, { language });
    const size = aviam ? TAG_STYLE.aviam.size : TAG_STYLE.other.size;
    const own = finite(item.opacity) ? clamp01(item.opacity) : 1;
    tags.push({ id: item.id, x, y, tag, priority, always,
      offsetPx: radius + TAG_STYLE.radialOffsetEm * size,
      opacity: own * (item.quality === 'stale' ? 0.5 : 1)
        * (outside !== null && outside.has(item.id) ? OUTSIDE_FILTER_OPACITY : 1) });
  }
  return { tags, marks, ring };
}
