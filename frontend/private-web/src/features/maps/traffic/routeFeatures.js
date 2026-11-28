import { createTranslator } from '../../../i18n/languageStore';
import { normalizeStandCode } from '../../../services/standCodes';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { counterpartPoint } from '../airport/worldAirports';
import { FLIGHT_ROUTE_PARTS, buildFlightRoute } from '../kinematics/flightRoute';
import { ROUTE_LABELS, kinematicsMessages } from '../kinematics/kinematicsMessages';
import { STAND_REFERENCE } from '../stands/standReference';

// The route of the chosen flight on the OCC maps (design E5): one builder, kinematics/flightRoute.js (buildFlightRoute),
// and this thin adapter that feeds it what the map knows of the selection (traffic/situationModel.js: selectionTarget):
// the observed points of its aircraft (its trail, with the server's track once read), the trajectory the map plans for
// it (traffic/motionStore.js: trajectoryForRoute), where the map draws it and when. Its parts, as the route layers of
// traffic/trafficLayers.js filter them: what it flew as observed (solid), what it flew as estimated (faint, from its
// origin airport: «Trayecto estimado»), what is still to fly (dashed: the approach, the runway, its exit and the taxi
// route to its stand, or to the apron hold where it waits, «Posición por asignar»; for a departure its stand, the taxi
// route, the runway, the climb and the great circle to its destination) and the points marked on it (touchdown,
// runway exit, stand, apron hold). A trail is never joined across a gap. Other traffic has no plan: only what it flew.
// Pure.

/** The parts of a route, as the route layers filter them (`properties.part`). */
export const ROUTE_PARTS = FLIGHT_ROUTE_PARTS;

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) });

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const isPoint = point => Array.isArray(point) && finite(point[0]) && finite(point[1]);
// The counterpart's position: the API row's, else the region's or the world's airport of its code (M8).
const pointOfAirport = counterpartPoint;

const centresByLayout = new WeakMap();

// The centre of every active stand of a layout by its normalized code and aliases, built once per layout.
function layoutCentres(layout) {
  let index = centresByLayout.get(layout);
  if (index) return index;
  index = new Map();
  for (const stand of layout.stands ?? []) {
    if (stand?.retired === true || !isPoint(stand?.center)) continue;
    for (const code of [stand.code, ...(stand.aliases ?? [])]) {
      const normalized = normalizeStandCode(code);
      if (normalized !== '' && !index.has(normalized)) index.set(normalized, [stand.center[0], stand.center[1]]);
    }
  }
  centresByLayout.set(layout, index);
  return index;
}

/** The centre of a stand by its code, as `[lng, lat]`: from the airport layout, else the reference list, else `null`. */
export function standCentre(code, layout = MDPC_LAYOUT) {
  const wanted = normalizeStandCode(code);
  if (wanted === '') return null;
  const fromLayout = layout && typeof layout === 'object' ? layoutCentres(layout).get(wanted) : undefined;
  if (fromLayout) return [...fromLayout];
  const reference = STAND_REFERENCE.find(stand => normalizeStandCode(stand.code) === wanted);
  return reference ? [reference.longitude, reference.latitude] : null;
}

// A point of a trail as buildFlightRoute takes it: `{ at, lon, lat, onGround?, breakBefore? }` (traffic/trailStore.js)
// or `[lng, lat]` (a trail drawn without its times).
function trailPoint(point, index, startsPart) {
  if (isPoint(point)) return { at: index, lon: point[0], lat: point[1], breakBefore: startsPart };
  if (!point || !finite(point.lon) || !finite(point.lat)) return null;
  return {
    at: finite(point.at) ? point.at : index, lon: point.lon, lat: point.lat, onGround: point.onGround === true,
    breakBefore: startsPart || point.breakBefore === true,
  };
}

/**
 * The observed points of the chosen aircraft, oldest first, every part after the first starting with a break, so no
 * line joins two parts: the parts of its trail (`segments`), else the points of the server's track. Points without
 * their time (`[lng, lat]`) keep their order.
 */
function observedTrail(segments, track) {
  const parts = (Array.isArray(segments) ? segments : []).filter(part => Array.isArray(part) && part.length > 0);
  const source = parts.length > 0 ? parts : [track?.points ?? []];
  const points = [];
  let index = 0;
  for (const [partIndex, part] of source.entries()) {
    let first = true;
    for (const point of part) {
      const converted = trailPoint(point, index, partIndex > 0 && first);
      index += 1;
      if (converted === null) continue;
      points.push(converted);
      first = false;
    }
  }
  return points;
}

// A cancelled or diverted flight has nothing still to fly here: only what it flew is drawn (a cancelled demo fades out
// where it is, contracts 2.3).
const goesNowhere = flight => flight.phase === 'cancelled' || flight.phase === 'diverted'
  || flight.demo?.state === 'Cancelled';

// Whether a flight's journey is over: an arrival that landed or reached its stand, a departure that left. A flight the
// map does not draw (Decision F-1) is then all flown, and before that all still to fly: no point between is made up.
function journeyOver(flight) {
  if (flight.direction === 'Departure') return flight.phase === 'departed' || text(flight.actualAt) !== null;
  return text(flight.actualAt) !== null || flight.phase === 'landed' || flight.phase === 'arrived'
    || (Array.isArray(flight.milestones) && flight.milestones.some(item => item?.code === 'BLOCK_ON' && item.actualAt != null));
}

// The words of a route label (kinematics/kinematicsMessages.js: ROUTE_LABELS) in the map's language.
function labelOf(labelKey, language) {
  const message = ROUTE_LABELS[labelKey];
  return message ? createTranslator(kinematicsMessages, language)(message) : null;
}

// The motion state the route reads of an aircraft (CN-29): `{ trackDeg, gsMs, onGround }`, or null.
function stateOf(item) {
  if (!item || typeof item !== 'object') return null;
  return { trackDeg: finite(item.trackDeg) ? item.trackDeg : null, gsMs: finite(item.gsMs) ? item.gsMs : null,
    onGround: item.onGround === true };
}

/**
 * The route of a selection target (traffic/situationModel.js: selectionTarget) as the route source's data, a
 * FeatureCollection (kinematics/flightRoute.js: buildFlightRoute).
 * - `segments`: the parts of the chosen aircraft's trail, each a list of trail points (`{ at, lon, lat, onGround,
 *   breakBefore }`, traffic/trailStore.js) or of `[lng, lat]`; without them, the points of `track` (the track model of
 *   toTrackModel). `breakMs` breaks a part where two points are further apart in time (trailBreakMs).
 * - `trajectory`: the flight's (traffic/motionStore.js: trajectoryForRoute): without one only what it flew is drawn,
 *   which is all of other traffic's route and of a cancelled or diverted flight's.
 * - `aircraft`: where the map draws the chosen aircraft now (`[lng, lat]`; OccMap passes it every frame it writes the
 *   route), else where the target has it; the split between flown and still to fly follows it. `nowMs`: the server's
 *   time. A flight the map does not draw (merely scheduled, Decision F-1) shows its planned route still to fly, all of
 *   it, or all of it flown once its journey is over.
 * - `state`: the drawn aircraft's `{ trackDeg, gsMs, onGround }` (CN-29; OccMap passes it with `aircraft`), else the
 *   target's: an arrival in the air off its plan flies its own approach (kinematics/flightRoute.js).
 * - `language`: the words of the marks' labels (`label`: «Posición por asignar» at an apron hold).
 * Each feature carries `{ id, flightKey, part, hex, … }` (`hex` the aircraft's ADS-B address, '' without one, so the
 * trails drawn beside the route can give way to its observed part), ids stable between calls; a mark its `mark` and,
 * when it has words, `label`. No target, nothing to fly and nothing flown: no route.
 */
export function buildRoute({
  target = null, segments = [], track = null, trajectory = null, nowMs = null, breakMs = null, aircraft = null,
  state = null, language = 'es',
} = {}) {
  const flight = target?.flight ?? null;
  const drawn = target?.aircraft ?? null;
  const key = flight?.flightKey ?? drawn?.id ?? null;
  if (key === null) return EMPTY;
  const drawnAt = isPoint(aircraft) ? [aircraft[0], aircraft[1]]
    : (drawn && finite(drawn.lon) && finite(drawn.lat) ? [drawn.lon, drawn.lat] : null);
  const trail = observedTrail(segments, track);
  const departure = flight?.direction === 'Departure';
  let tMs = finite(nowMs) ? nowMs : null;
  if (flight !== null && drawnAt === null) tMs = journeyOver(flight) ? Number.MAX_SAFE_INTEGER : null;
  const planned = flight !== null && !goesNowhere(flight) ? trajectory : null;
  const route = buildFlightRoute({ flightKey: key, direction: flight?.direction ?? null }, planned, trail, tMs, {
    origin: departure ? null : pointOfAirport(flight?.counterpart),
    destination: departure ? pointOfAirport(flight?.counterpart) : null,
    aircraft: drawnAt,
    breakMs,
    // CN-29: the drawn aircraft's track, speed and whether it is on the ground, so an arrival off its plan flies its own
    // approach; where the map passes no state, the target's own.
    state: stateOf(state) ?? (isPoint(aircraft) ? null : stateOf(drawn)),
  });
  if (route.features.length === 0) return EMPTY;
  const hex = text(drawn?.hex)?.toLowerCase() ?? '';
  return {
    type: 'FeatureCollection',
    features: route.features.map(feature => {
      const label = feature.properties.labelKey ? labelOf(feature.properties.labelKey, language) : null;
      return {
        type: 'Feature',
        properties: { ...feature.properties, flightKey: flight?.flightKey ?? null, hex,
          ...(feature.properties.part === 'mark' && label !== null ? { label } : {}) },
        geometry: feature.geometry,
      };
    }),
  };
}

/** The parts of the trail of `hex` in a trails FeatureCollection (traffic/trailStore.js: trailFeatures), oldest first. */
export function trailSegmentsOf(trails, hex) {
  const address = typeof hex === 'string' ? hex.toLowerCase() : null;
  if (address === null || address === '') return [];
  return (trails?.features ?? [])
    .filter(feature => feature?.properties?.hex === address && feature.geometry?.type === 'LineString')
    .map(feature => feature.geometry.coordinates);
}

/**
 * The trails without the trail a route already draws as its observed part (the same aircraft), so the chosen
 * aircraft's trail is drawn once, in the route's colour. Nothing to drop gives the same collection back.
 */
export function trailsBesideRoute(trails, route) {
  const routed = new Set((route?.features ?? [])
    .filter(feature => feature?.properties?.part === 'flownObserved' && text(feature.properties.hex) !== null)
    .map(feature => feature.properties.hex));
  if (routed.size === 0 || !Array.isArray(trails?.features)) return trails;
  const features = trails.features.filter(feature => !routed.has(feature?.properties?.hex));
  return features.length === trails.features.length ? trails : { ...trails, features };
}
