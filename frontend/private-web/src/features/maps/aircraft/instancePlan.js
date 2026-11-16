import { occColor } from '../../occ-ui/occPalette';
import { EARTH_RADIUS_M, METRES_PER_NM, haversineM } from '../airport/geo';
import { isDrawn } from '../traffic/trafficFeatures';
import { resolveAircraftType } from './types';

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

/** Above this height an airborne aircraft gets a drop line to the ground, so its position on the map reads. */
export const DROP_LINE_MIN_M = 3;

/** The ground shadow: the model flattened to a hundredth of its height, five centimetres above the ground. */
export const SHADOW = Object.freeze({ heightM: 0.05, flatten: 0.01 });

/** How many distinct type descriptions the plan keeps resolved (aircraft/types.js: resolveAircraftType). */
export const TYPE_MEMO_LIMIT = 256;

const RADIUS_M = AIRCRAFT_3D_RADIUS_NM * METRES_PER_NM;
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

// Column-major, as three's Matrix4.elements: T(x, y, z) · Rz(−heading) · S(1, 1, flatten).
function writeMatrix(target, offset, { x, y, z, headingDeg, flatten }) {
  const radians = (headingDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  target.set([cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, flatten, 0, x, y, z, 1], offset);
}

// What the layer can place, or null: other traffic on the ground stays 2D (contracts 2.4), and an aircraft in the air
// without an altitude too, because no height is made up for it.
function placeable(item, { fieldElevationM }) {
  if (!isDrawn(item) || item.id == null) return null;
  const aviam = item.kind === 'aviam';
  if (item.onGround === true) return aviam ? { item, aviam, z: 0 } : null;
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
 * Answers `Map<key, { spec, approximate, aircraftCount, count, matrices, colors, floorLengths, ids, dropLines }>`, the keys
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
 *   aircraft in `aviam`, other traffic in `other`, shadows in `shadow`;
 * - `spec` and `approximate` come from resolveAircraftType: a type the table lacks takes its category's generic
 *   airframe under the category's own key, approximate.
 * The input is never changed; the same input gives the same plan.
 */
export function planInstances(renderAircraft = [], parkedAircraft = [], {
  zoom, minZoom, originLngLat, fieldElevationM = 0, selectedId = null, colors = AIRCRAFT_3D_COLORS,
} = {}) {
  const plan = new Map();
  if (!(zoom >= minZoom)) return plan;
  const frame = mercatorFrame(originLngLat);
  const field = finite(fieldElevationM) ? fieldElevationM : 0;

  const parked = new Map();
  for (const item of list(parkedAircraft)) {
    if (item?.id == null || !finite(item.lon) || !finite(item.lat)) continue;
    parked.set(item.id, { item, aviam: item.kind !== 'other', z: 0, onStand: true });
  }
  const placed = [...parked.values()];
  for (const item of list(renderAircraft)) {
    if (item?.id == null || parked.has(item.id)) continue;
    const entry = placeable(item, { fieldElevationM: field });
    if (entry !== null) placed.push(entry);
  }

  const groups = new Map();
  for (const entry of placed) {
    const point = [entry.item.lon, entry.item.lat];
    if (haversineM(originLngLat, point) > RADIUS_M) continue;
    const resolved = resolvedTypeOf(entry.item);
    const key = instanceKey(resolved);
    const [x, y] = frame.toLocal(point);
    const { trackDeg, headingDeg } = entry.item;
    let heading = 0;
    if (finite(trackDeg)) heading = trackDeg;
    else if (finite(headingDeg)) heading = headingDeg;
    const group = groups.get(key) ?? { resolved, members: [] };
    group.members.push({ id: entry.item.id, x, y, z: entry.z, headingDeg: heading, onStand: entry.onStand === true,
      colour: entry.item.id === selectedId ? colors.selected : colors[entry.aviam ? 'aviam' : 'other'] });
    groups.set(key, group);
  }

  for (const key of [...groups.keys()].sort()) {
    const { resolved, members } = groups.get(key);
    members.sort(byId);
    const aircraftCount = members.length;
    const matrices = new Float32Array(32 * aircraftCount);
    const instanceColors = new Float32Array(6 * aircraftCount);
    // The length a model may grow from (aircraft3dLayer.js: minModelPx): an aircraft of the traffic, as its 2D symbol,
    // is never drawn smaller than a few pixels; one on its stand keeps the stand's scale, as its footprint does.
    const floorLengths = new Float32Array(2 * aircraftCount);
    const ids = [];
    const drops = [];
    members.forEach((member, index) => {
      writeMatrix(matrices, 16 * index, { ...member, flatten: 1 });
      writeMatrix(matrices, 16 * (aircraftCount + index), { ...member, z: SHADOW.heightM, flatten: SHADOW.flatten });
      instanceColors.set(member.colour, 3 * index);
      instanceColors.set(colors.shadow, 3 * (aircraftCount + index));
      ids[index] = member.id;
      ids[aircraftCount + index] = null;
      const floor = member.onStand ? 0 : resolved.spec.lengthM;
      floorLengths[index] = floor;
      floorLengths[aircraftCount + index] = floor;
      if (member.z > DROP_LINE_MIN_M) drops.push(member.x, member.y, member.z, member.x, member.y, 0);
    });
    plan.set(key, Object.freeze({
      spec: resolved.spec,
      approximate: resolved.approximate,
      aircraftCount,
      count: 2 * aircraftCount,
      matrices,
      colors: instanceColors,
      floorLengths,
      ids: Object.freeze(ids),
      dropLines: Float32Array.from(drops),
    }));
  }
  return plan;
}
