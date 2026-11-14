import { normalizeStandCode } from '../../../services/standCodes';
import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM } from '../airport/geo';
import { STAND_REFERENCE } from '../stands/standReference';

// The route of the chosen flight (design E5, as PR M5 ships it): the part it flew, observed (the server's track of the
// aircraft, `aircraft/{hex}/track`, and the trail the map gathered since, solid), and a straight dashed line from the
// aircraft to its next point. PR M6 replaces that straight line with the trajectory (approach, runway, exit and the
// taxi route to the stand) and adds the estimated part flown from the origin. Pure: the route layers of
// traffic/trafficLayers.js draw `part: 'flown'` solid and `part: 'next'` dashed.
//
// The next point of an arrival is its stand (the one assigned, or the one suggested for a demo flight not yet imported:
// its centre in the airport layout, else in the reference list of stands), else the station's airport; of a departure,
// its destination airport when the API gives it coordinates. Other traffic draws no next point, nor does an arrival
// already on its stand, a cancelled or diverted flight, or a next point without coordinates. A trail is never joined
// across a gap: every observed part is a line of its own.

/** The parts of a route, as the route layers filter them. */
export const ROUTE_PARTS = Object.freeze(['flown', 'next']);

// Closer than this the aircraft is at its next point: no line is drawn.
const MIN_NEXT_M = 5;
const EMPTY = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) });

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const isPoint = point => Array.isArray(point) && finite(point[0]) && finite(point[1]);

/** The point of an airport of the API (`{ latitude, longitude }`), as `[lng, lat]`, or `null` without coordinates. */
function airportPoint(airport) {
  return finite(airport?.longitude) && finite(airport?.latitude) ? [airport.longitude, airport.latitude] : null;
}

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

// Whether an arrival is already on its stand at `nowMs`: OCC recorded its on-block time (actualKind OnBlock or the
// BLOCK_ON milestone), or the server's demo clock has it parked.
function onStand(flight, nowMs) {
  const reached = value => {
    const at = parseInstant(value ?? null);
    return at !== null && (!finite(nowMs) || at <= nowMs);
  };
  return (flight.actualKind === 'OnBlock' && reached(flight.actualAt))
    || (Array.isArray(flight.milestones) && flight.milestones.some(milestone => milestone?.code === 'BLOCK_ON'
      && reached(milestone.actualAt)))
    || (flight.isDemo === true && reached(flight.demo?.onBlockAt));
}

/** Where the flight goes next: `{ to: 'stand' | 'airport' | 'destination', point }`, or `null`. */
function nextPoint(flight, { layout, stationAirport, nowMs }) {
  if (!flight || flight.phase === 'cancelled' || flight.phase === 'diverted') return null;
  if (flight.direction === 'Departure') {
    const destination = airportPoint(flight.counterpart);
    return destination && { to: 'destination', point: destination };
  }
  if (onStand(flight, nowMs)) return null;
  const code = text(flight.stand?.code) ?? text(flight.suggestedStandCode);
  const stand = code === null ? null : standCentre(code, layout);
  if (stand) return { to: 'stand', point: stand };
  const airport = airportPoint(stationAirport);
  return airport && { to: 'airport', point: airport };
}

// The observed parts: the trail's parts of two points or more, else the server's track as one part.
function flownParts(segments, track) {
  const parts = (Array.isArray(segments) ? segments : [])
    .map(part => (Array.isArray(part) ? part.filter(isPoint).map(([lng, lat]) => [lng, lat]) : []))
    .filter(part => part.length >= 2);
  if (parts.length > 0) return parts;
  const points = (track?.points ?? []).map(point => [point?.lon, point?.lat]).filter(isPoint);
  return points.length >= 2 ? [points] : [];
}

const line = (properties, coordinates) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });

/**
 * The route of a selection target (traffic/situationModel.js: selectionTarget) as the route source's data: one
 * `part: 'flown'` line per observed part (`segments`, the parts of its trail as `[[lng, lat], …]`, which hold the
 * server's track once read; else `track`, the track model of toTrackModel) and one `part: 'next'` line from the
 * aircraft to its next point. Each feature carries `{ id, part, hex }`, and the next line `to` (`stand`, `airport` or
 * `destination`). `layout` finds the stands (the MDPC dataset by default), `stationAirport` is the map flights' own
 * airport and `nowMs` the server's time (an arrival on its stand has no next point). A target without a position, or
 * none, has no route.
 */
export function buildRoute({ target = null, segments = [], track = null, layout = MDPC_LAYOUT, stationAirport = null,
  nowMs = null } = {}) {
  const aircraft = target?.aircraft ?? null;
  if (!aircraft || !finite(aircraft.lon) || !finite(aircraft.lat)) return EMPTY;
  const here = [aircraft.lon, aircraft.lat];
  const hex = aircraft.hex ?? '';
  const features = flownParts(segments, track)
    .map((coordinates, index) => line({ id: `${aircraft.id}:flown:${index}`, part: 'flown', hex }, coordinates));
  const next = nextPoint(target.flight, { layout, stationAirport, nowMs });
  if (next !== null && haversineM(here, next.point) >= MIN_NEXT_M) {
    features.push(line({ id: `${aircraft.id}:next`, part: 'next', hex, to: next.to }, [here, next.point]));
  }
  return { type: 'FeatureCollection', features };
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
 * The trails without the trail a route already draws as its flown part (the same aircraft), so the chosen aircraft's
 * trail is drawn once, in the route's colour. Nothing to drop gives the same collection back.
 */
export function trailsBesideRoute(trails, route) {
  const routed = new Set((route?.features ?? [])
    .filter(feature => feature?.properties?.part === 'flown' && text(feature.properties.hex) !== null)
    .map(feature => feature.properties.hex));
  if (routed.size === 0 || !Array.isArray(trails?.features)) return trails;
  const features = trails.features.filter(feature => !routed.has(feature?.properties?.hex));
  return features.length === trails.features.length ? trails : { ...trails, features };
}
