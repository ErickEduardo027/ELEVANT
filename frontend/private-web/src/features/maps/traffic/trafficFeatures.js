import { createTranslator } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { resolveAircraftType } from '../aircraft/types';
import { isInBounds } from '../core/cameraPresets';
import { matchFlight } from '../core/mapSelection';
import { mapMessages } from '../mapMessages';
import { AIRCRAFT_ICON_INSET, AIRCRAFT_ICON_SIZES, aircraftImage } from '../style/trafficImages';
import { staleWords } from './stationTime';

// What the traffic layers draw (design E3, contracts 2.4), from the aircraft of the map situation
// (traffic/situationModel.js: buildSituation). Pure: OccMap writes the features with one updateData per change
// (trafficDiff) and reads trafficOnScreen for the legend and the credit.
//
// Reading without colour: an arriving ELEVANT flight is a solid silhouette and a departing one a hollow one, both
// larger than the rest and always tagged; other traffic is small and muted, tagged on demand; an estimated position
// carries a dashed ring and «est.», a position without recent signal is dimmed and says since when, in the words of the
// vocabulary («Sin actualizar desde las 14:02», traffic/stationTime.js), a demo flight its «Demo» plate. Other traffic
// on the ground inside a stand an ELEVANT visit holds is not drawn. One owner per aircraft (PR M6, design F4): an
// ELEVANT aircraft parked in the stand that shows it is the stand's (stands/standFeatures.js: parkedAircraftIds), so
// where the stands are drawn its symbol gives way to the stand's footprint or glyph (`parkedOnStand`); its dashed ring
// and its «Demo» plate stay, so an estimated or demo aircraft on its stand keeps its mark.

export const TRAFFIC_SOURCE = 'occ-traffic';
export const TRAILS_SOURCE = 'occ-trails';
export const ROUTE_SOURCE = 'occ-route';

/** How much larger than its category's icon each aircraft is drawn. */
export const TRAFFIC_SCALES = Object.freeze({ aviam: 1.25, other: 0.85, otherGround: 0.6, selected: 1.4 });

/** What the legend can list, in its order. */
export const TRAFFIC_KINDS = Object.freeze(['aviamArrival', 'aviamDeparture', 'other', 'otherGround']);
export const TRAFFIC_TAGS = Object.freeze(['demo', 'estimated', 'stale']);
export const TRAIL_KINDS = Object.freeze(['live', 'estimated']);
/**
 * The parts of the chosen flight's route (traffic/routeFeatures.js, kinematics/flightRoute.js), in the legend's order:
 * flown as observed, flown as estimated, still to fly, and the points marked on it.
 */
export const ROUTE_KINDS = Object.freeze(['flownObserved', 'flownEstimated', 'remaining', 'mark']);

const FEET_PER_METRE = 1 / 0.3048;
const KNOTS_PER_MPS = 3_600 / 1_852;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const filled = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Whether an aircraft is drawn at all: it has a position and no stand an ELEVANT or demo aircraft is on hides it. */
export function isDrawn(aircraft) {
  return aircraft != null && aircraft.hiddenInStand !== true && finite(aircraft.lon) && finite(aircraft.lat);
}

/**
 * The id of the aircraft a selection names, or `null`: a flight by any id matchFlight reads (its flightKey, leg,
 * proposal, visit or turnaround), an aircraft by its ADS-B address.
 */
export function selectedAircraftId(aircraft, selection) {
  if (!selection || selection.id == null) return null;
  const list = (Array.isArray(aircraft) ? aircraft : []).filter(isDrawn);
  if (selection.kind === 'aircraft') {
    const hex = String(selection.id).trim().toLowerCase();
    return list.find(item => item.hex === hex)?.id ?? null;
  }
  if (selection.kind === 'flight') return matchFlight(list.filter(item => item.kind === 'aviam'), selection.id)?.id ?? null;
  return null;
}

/** Altitude in hundreds of feet, three digits («026» for 2 600 ft), or `null`. */
/**
 * The altitude the traffic is coloured by (style/mapColors.js), in feet rounded to the hundred: 0 on the ground, -1
 * without an altitude, so a frame that moves an aircraft a few feet writes nothing new.
 */
export function altitudeFeet(item) {
  if (item?.onGround === true) return 0;
  if (!finite(item?.altM)) return -1;
  return Math.max(0, Math.round((item.altM * FEET_PER_METRE) / 100) * 100);
}

export function flightLevelText(altM) {
  if (!finite(altM)) return null;
  return String(Math.max(0, Math.round((altM * FEET_PER_METRE) / 100))).padStart(3, '0');
}

/** Ground speed in whole knots, or `null`. */
export function knotsText(gsMs) {
  return finite(gsMs) ? String(Math.max(0, Math.round(gsMs * KNOTS_PER_MPS))) : null;
}

function tagLines(item, type, { t, language }) {
  const aviam = item.kind === 'aviam';
  const name = (aviam ? filled(item.flightNumber) : null) ?? filled(item.callsign) ?? filled(item.registration)
    ?? String(item.hex ?? '').toUpperCase();
  let altitude = item.onGround === true ? t('traffic.ground') : flightLevelText(item.altM);
  let speed = knotsText(item.gsMs);
  // An aircraft standing on the ground says GND and nothing of a speed it does not have.
  if (item.onGround === true && speed === '0') speed = null;
  // A missing altitude keeps its place, so the speed is never read as one.
  if (altitude === null && speed !== null) altitude = '---';
  const typeCode = filled(item.typeIcao)?.toUpperCase() ?? type.code ?? null;
  let suffix = '';
  if (item.quality === 'estimated') suffix = TAGS.estimated[language] ?? TAGS.estimated.es;
  else if (item.quality === 'stale') suffix = staleWords(item.positionAt, language);
  return {
    tag1: name,
    suffix,
    tag2: [typeCode, altitude, speed].filter(part => part !== null).join(' '),
  };
}

// The stand words of an ELEVANT tag: the stand an arrival goes to; parked at another one than it was given (CN-31),
// «B3≠A5» (where it is, then where it was assigned), for an arrival or a departure.
function standTag(item, aviam, departure) {
  if (!aviam) return '';
  const mismatch = item.standMismatch;
  if (mismatch && filled(mismatch.actual) && filled(mismatch.assigned)) return `${mismatch.actual}≠${mismatch.assigned}`;
  return departure ? '' : (filled(item.standCode) ?? '');
}

// The opacity of an aircraft in hundredths, so a fade writes a hundred steps at most; 1 when it says none.
const opacityOf = item => (finite(item.opacity) ? Math.round(Math.min(1, Math.max(0, item.opacity)) * 100) / 100 : 1);

const NO_IDS = Object.freeze(new Set());
const idsOf = value => (value instanceof Set ? value : NO_IDS);

/** One feature of the traffic source; see trafficFeatures for its properties. */
function featureOf(item, { selectedId, focusId, labelsOn, language, t, parked, models, animatedSet }) {
  const aviam = item.kind === 'aviam';
  const departure = aviam && item.direction === 'Departure';
  const ground = item.onGround === true;
  const selected = item.id === selectedId;
  const focused = item.id === focusId;
  const type = resolveAircraftType({ typeIcao: item.typeIcao, model: item.model, sizeCategory: item.sizeCategory,
    emitterCategory: item.emitterCategory });
  let scale = TRAFFIC_SCALES.other;
  if (selected) scale = TRAFFIC_SCALES.selected;
  else if (aviam) scale = TRAFFIC_SCALES.aviam;
  else if (ground) scale = TRAFFIC_SCALES.otherGround;
  const forceTag = aviam || selected || focused;
  const { tag1, suffix, tag2 } = tagLines(item, type, { t, language });
  return {
    type: 'Feature',
    properties: {
      id: item.id,
      hex: item.hex ?? '',
      flightKey: item.flightKey ?? '',
      kind: aviam ? 'aviam' : 'other',
      dir: aviam ? (departure ? 'dep' : 'arr') : '',
      category: type.iconCategory,
      icon: aircraftImage(type.iconCategory, { hollow: departure }),
      scale,
      // Half the silhouette as drawn, in pixels: the ring, the plate and the tag keep clear of it.
      radius: Math.round(((AIRCRAFT_ICON_SIZES[type.iconCategory] - 2 * AIRCRAFT_ICON_INSET) / 2) * scale * 10) / 10,
      // An aircraft without a known heading points north: no direction is made up for it.
      trk: finite(item.trackDeg) ? Math.round(item.trackDeg * 10) / 10 : 0,
      quality: item.quality,
      stale: item.quality === 'stale',
      estimated: item.quality === 'estimated',
      demo: aviam && item.isDemo === true,
      ground,
      // The altitude in feet the icon is coloured by (style/mapColors.js): 0 on the ground, -1 when unknown.
      altFt: altitudeFeet(item),
      selected,
      forceTag,
      showTag: forceTag || labelsOn === true,
      tag1,
      suffix,
      tag2,
      // CN-31: parked at another stand than its assigned one, the tag says where it is and where it should be.
      tagStand: standTag(item, aviam, departure),
      standMismatch: aviam && item.standMismatch != null,
      // How much of it shows (PR M6): 1, or less while it fades out (a cancelled demo, traffic that lost its signal).
      opacity: opacityOf(item),
      // Parked in the stand that shows it (PR M6): its symbol gives way to the stand's footprint or glyph.
      parkedOnStand: aviam && parked.has(item.id),
      // Drawn as a 3D model (PR M7): its 2D silhouette gives way; its tag, rings and plates stay.
      model3d: models.has(item.id),
      // Animated by the same layer (PR M2): it draws its dashed ring and «Demo» plate too, so they move with it.
      animated: animatedSet.has(item.id),
    },
    geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
  };
}

/**
 * The traffic source's data: one point per drawn aircraft (isDrawn), keyed by its id (`f:<flightKey>` or `h:<hex>`,
 * the source's promoted id), with
 * `{ id, hex, flightKey, kind, dir, category, icon, scale, radius, trk, quality, stale, estimated, demo, ground, altFt,
 * selected, forceTag, showTag, tag1, suffix, tag2, tagStand, opacity }`:
 * - `icon`: the solid silhouette of the aircraft's category, hollow for a departing ELEVANT flight;
 * - `scale`: 1.25 for ELEVANT flights, 0.85 for other traffic, 0.6 for other traffic on the ground, 1.4 when chosen;
 * - `tag1` the flight number (other traffic: callsign, registration or address), `suffix` «est.», or for a stale
 *   position «Sin actualizar desde las 14:02» with the station's time of its last position (it stays the same until a
 *   new position comes), `tag2` type, altitude in hundreds of feet (GND on the ground) and knots (none while standing
 *   on the ground), `tagStand` the stand an arriving flight goes to (CN-31: «B3≠A5» while it stands at another
 *   stand than its assigned one, `standMismatch` then true);
 * - `forceTag`: the tag is always on (ELEVANT flights, the chosen aircraft, the one under the pointer); `showTag`:
 *   it is on, also for the rest of the traffic while all labels are (`labelsOn`, «Etiquetas de todo el tráfico»);
 * - `opacity`: the aircraft's own (PR M6, the motion store), in hundredths: 1, or less while it fades out; the layers
 *   multiply it into the dimming of a stale position;
 * - `parkedOnStand` (PR M6): an ELEVANT aircraft of `parkedIds` (a Set of ids), parked in the stand that draws it to
 *   scale or as its glyph; the layers then leave its symbol and tag to the stand, except as the chosen aircraft, and
 *   keep its estimated ring and «Demo» plate;
 * - `model3d` (PR M7): an aircraft of `modelIds` (a Set of ids), drawn by the 3D layer (core/aircraft3d.js); the layers
 *   then leave out its silhouette, the chosen one's too, and keep its tag, its rings and its plate;
 * - `animated` (PR M2): an aircraft of `animatedIds` (a Set of ids), which the animated layer draws every frame (its
 *   silhouette or its model, also in `modelIds`); the layers then leave it its dashed ring and «Demo» plate too.
 * Options: `selection` (`{ kind, id }`), `focusId` (the aircraft under the pointer), `labelsOn`, `language`,
 * `parkedIds`, `modelIds`, `animatedIds`.
 */
export function trafficFeatures(aircraft = [], {
  selection = null, focusId = null, labelsOn = false, language = 'es', parkedIds = null, modelIds = null,
  animatedIds = null,
} = {}) {
  const list = (Array.isArray(aircraft) ? aircraft : []).filter(isDrawn);
  const selectedId = selectedAircraftId(list, selection);
  const t = createTranslator(mapMessages, language);
  const parked = idsOf(parkedIds);
  const models = idsOf(modelIds);
  const animatedSet = idsOf(animatedIds);
  return {
    type: 'FeatureCollection',
    features: list.map(item => featureOf(item, { selectedId, focusId, labelsOn, language, t, parked, models, animatedSet })),
  };
}

/** The features of a collection by their id. */
export function featuresById(collection) {
  return new Map((collection?.features ?? []).map(feature => [feature.properties.id, feature]));
}

const samePoint = (first, second) => first.coordinates[0] === second.coordinates[0]
  && first.coordinates[1] === second.coordinates[1];

// What changed in one feature, as a GeoJSONFeatureDiff, or null.
function featureChange(before, after) {
  const change = { id: after.properties.id };
  if (!samePoint(before.geometry, after.geometry)) change.newGeometry = after.geometry;
  const added = Object.entries(after.properties)
    .filter(([key, value]) => !Object.is(before.properties[key], value))
    .map(([key, value]) => ({ key, value }));
  const removed = Object.keys(before.properties).filter(key => !Object.hasOwn(after.properties, key));
  if (added.length > 0) change.addOrUpdateProperties = added;
  if (removed.length > 0) change.removeProperties = removed;
  return Object.keys(change).length > 1 ? change : null;
}

/**
 * The GeoJSONSourceDiff that turns the features of `previousById` (featuresById of what the source holds) into
 * `nextFeatures`: `{ add, update, remove }`, by id. An unchanged feature is left out; a moved one carries its new
 * geometry and only the properties that changed.
 */
export function trafficDiff(previousById, nextFeatures = []) {
  const previous = previousById instanceof Map ? previousById : new Map();
  const add = [];
  const update = [];
  const seen = new Set();
  for (const feature of nextFeatures) {
    const { id } = feature.properties;
    seen.add(id);
    const before = previous.get(id);
    if (!before) add.push(feature);
    else {
      const change = featureChange(before, feature);
      if (change !== null) update.push(change);
    }
  }
  const remove = [...previous.keys()].filter(id => !seen.has(id));
  return { add, update, remove };
}

/** Whether a diff changes anything. */
export const isEmptyDiff = diff => diff.add.length === 0 && diff.update.length === 0 && diff.remove.length === 0;

// The layers-menu groups shown by default: the trails of all the traffic only once it is turned on (design E7).
const HIDDEN_BY_DEFAULT = new Set(['traffic.trails', 'traffic.labels']);
const visibleGroup = (groups, group) => (HIDDEN_BY_DEFAULT.has(group) ? groups?.[group] === true : groups?.[group] !== false);

// Whether the segment from `from` to `to` crosses the box `[[west, south], [east, north]]` (Liang–Barsky).
function segmentCrosses([x0, y0], [x1, y1], [[west, south], [east, north]]) {
  let enter = 0;
  let leave = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - west], [dx, east - x0], [-dy, y0 - south], [dy, north - y0]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const share = q / p;
      if (p < 0) {
        if (share > leave) return false;
        enter = Math.max(enter, share);
      } else {
        if (share < enter) return false;
        leave = Math.min(leave, share);
      }
    }
  }
  return true;
}

// Whether a line of `[lng, lat]` points has a point inside `bounds` or crosses them (a straight line to a far airport
// may cross the view with both ends outside it).
const lineInBounds = (points, bounds) => points.some(point => isInBounds(point, bounds))
  || points.some((point, index) => index > 0 && segmentCrosses(points[index - 1], point, bounds));

/**
 * What of the traffic is drawn inside `bounds` (`[[west, south], [east, north]]`, every drawn aircraft without them),
 * for the legend and the credit (contracts 2.4: the legend lists only what is on screen):
 * `{ kinds, tags, trails, route }` in the orders of TRAFFIC_KINDS, TRAFFIC_TAGS, TRAIL_KINDS and ROUTE_KINDS.
 * - `groups`: the layers-menu groups the map shows: `traffic.aviam`, `traffic.other` and `route` unless `false`, and
 *   `traffic.trails` (the trails of the rest of the traffic) only when `true`, as the style starts them.
 * - `zoom` and `thresholds`: other traffic on the ground is drawn only from the airfield threshold up.
 * - `trails`: the trails FeatureCollection (traffic/trailStore.js: trailFeatures).
 * - `route`: the chosen flight's route (traffic/routeFeatures.js: buildRoute): its lines drawn inside `bounds` or across
 *   them, and its marks (points) inside them.
 * - `parkedIds` (PR M6): the ELEVANT aircraft a stand draws instead (trafficFeatures' `parkedOnStand`): the stands'
 *   legend explains them, so they bring no kind of traffic; their «est.» ring and «Demo» plate stay drawn, so they
 *   still bring the tags `estimated` and `demo`.
 */
export function trafficOnScreen(aircraft = [], bounds = null, { groups = {}, zoom = null, thresholds = null, trails = null,
  route = null, parkedIds = null } = {}) {
  const kinds = new Set();
  const tags = new Set();
  const groundHidden = finite(zoom) && finite(thresholds?.airfield) && zoom < thresholds.airfield;
  const parked = idsOf(parkedIds);
  for (const item of Array.isArray(aircraft) ? aircraft : []) {
    if (!isDrawn(item) || (bounds !== null && !isInBounds([item.lon, item.lat], bounds))) continue;
    const aviam = item.kind === 'aviam';
    if (!visibleGroup(groups, aviam ? 'traffic.aviam' : 'traffic.other')) continue;
    // A parked one is drawn by its stand, whose legend explains it, but its estimated ring and «Demo» plate stay.
    const isParked = aviam && parked.has(item.id);
    if (isParked) {
      if (item.isDemo === true) tags.add('demo');
      if (item.quality === 'estimated') tags.add('estimated');
      continue;
    }
    if (aviam) kinds.add(item.direction === 'Departure' ? 'aviamDeparture' : 'aviamArrival');
    else if (item.onGround === true) {
      if (groundHidden) continue;
      kinds.add('otherGround');
    } else kinds.add('other');
    if (aviam && item.isDemo === true) tags.add('demo');
    if (item.quality === 'estimated' || item.quality === 'stale') tags.add(item.quality);
  }
  const trailKinds = new Set();
  for (const feature of trails?.features ?? []) {
    const { kind, selected, quality } = feature.properties ?? {};
    const group = kind === 'aviam' || selected === true ? 'traffic.aviam' : 'traffic.trails';
    if (!visibleGroup(groups, group) || (group === 'traffic.trails' && !visibleGroup(groups, 'traffic.other'))) continue;
    const points = feature.geometry?.coordinates ?? [];
    if (bounds !== null && !points.some(point => isInBounds(point, bounds))) continue;
    trailKinds.add(quality === 'estimated' ? 'estimated' : 'live');
  }
  const routeParts = new Set();
  if (visibleGroup(groups, 'route')) {
    for (const feature of route?.features ?? []) {
      const part = feature?.properties?.part;
      const geometry = feature?.geometry;
      if (!ROUTE_KINDS.includes(part)) continue;
      if (geometry?.type === 'Point') {
        const point = geometry.coordinates;
        if (finite(point?.[0]) && finite(point?.[1]) && (bounds === null || isInBounds(point, bounds))) routeParts.add(part);
        continue;
      }
      const points = geometry?.coordinates ?? [];
      if (points.length < 2) continue;
      if (bounds === null || lineInBounds(points, bounds)) routeParts.add(part);
    }
  }
  return {
    kinds: TRAFFIC_KINDS.filter(kind => kinds.has(kind)),
    tags: TRAFFIC_TAGS.filter(tag => tags.has(tag)),
    trails: TRAIL_KINDS.filter(kind => trailKinds.has(kind)),
    route: ROUTE_KINDS.filter(part => routeParts.has(part)),
  };
}

/** The key of what trafficOnScreen answers: equal keys, the same legend. */
export const onScreenKey = onScreen => [onScreen.kinds, onScreen.tags, onScreen.trails, onScreen.route ?? []]
  .map(list => list.join(',')).join('|');
