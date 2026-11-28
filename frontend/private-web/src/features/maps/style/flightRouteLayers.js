import { counterpartPoint } from '../airport/worldAirports';
import { PUJ_ARP } from '../core/cameraPresets';
import { occColor } from '../../occ-ui/occPalette';
import { greatCircle } from './routeLayers';

// «Rutas de los vuelos de AVIAM» (M8, Monitoreo on the globe): the great circle of every AVIAM flight of the map flights,
// from its origin to the station for an arrival and from the station to its destination for a departure, thin and
// subdued, under the chosen flight's route (traffic/trafficLayers.js), which stays the one emphasised. The counterpart's
// position is the API row's, else the region's or the world's airport of its code (airport/worldAirports.js:
// counterpartPoint); a flight without one, a cancelled one and the chosen one (its own route draws it) are left out. A
// line that crosses the antimeridian is cut there, so it never runs round the world the other way. The board's filter
// (flight-monitoring/flightBoardModel.js) dims the routes of the flights it leaves out (`outside`). A layer of the
// «Tráfico» group of the layers menu, in the `reference` slot, hidden from the airfield threshold on. Pure.

export const FLIGHT_ROUTES_SOURCE = 'occ-flight-routes';
export const FLIGHT_ROUTES_GROUP = 'traffic.routes';
export const FLIGHT_ROUTES_LAYER_ID = 'occ-flight-routes-line';
/** Points of each great circle: smooth from the world to the region, small for the source. */
const ARC_POINTS = 64;
/** How a route is drawn: in the filter of the board (or with no filter) and outside it. */
export const FLIGHT_ROUTE_STYLE = Object.freeze({ width: 1, opacity: 0.45, outsideOpacity: 0.12 });

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isPoint = point => Array.isArray(point) && finite(point[0]) && finite(point[1]);
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/**
 * The parts of a line (`[[lng, lat], …]`, longitudes in -180..180) cut where it crosses the antimeridian: a step of more
 * than 180° of longitude between two points is a crossing, and both parts end on it (at 180 and -180) at the latitude
 * between. A line that does not cross comes back as its only part.
 */
export function splitAtAntimeridian(line) {
  const points = (Array.isArray(line) ? line : []).filter(isPoint);
  if (points.length < 2) return points.length === 0 ? [] : [points];
  const parts = [];
  let part = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const [lng1, lat1] = points[index - 1];
    const [lng2, lat2] = points[index];
    if (Math.abs(lng2 - lng1) > 180) {
      // East to west across 180 (179 → -179) or west to east (-179 → 179): the edge each side ends on.
      const edge = lng1 > 0 ? 180 : -180;
      const unwrapped = lng2 + (lng1 > 0 ? 360 : -360);
      const f = (edge - lng1) / (unwrapped - lng1);
      const lat = Math.round((lat1 + (lat2 - lat1) * f) * 1e5) / 1e5;
      part.push([edge, lat]);
      parts.push(part);
      part = [[-edge, lat]];
    }
    part.push(points[index]);
  }
  parts.push(part);
  return parts.filter(item => item.length >= 2);
}

const keyOf = flight => text(flight?.flightKey) ?? text(flight?.legId == null ? null : String(flight.legId));

/**
 * The FeatureCollection of the AVIAM routes for FLIGHT_ROUTES_SOURCE: one feature per map flight (contracts 1.3) whose
 * counterpart has a position, by its flight key, a LineString, or a MultiLineString when it crosses the antimeridian.
 * - `station`: the station's `[lng, lat]` (PUJ's reference point by default);
 * - `emphasised`: the flight keys the board's filter keeps (an iterable), or `null` for no filter: a route of a flight
 *   it leaves out carries `outside: true`;
 * - `exclude`: the flight key of the chosen flight, whose own route the map draws.
 * Each feature carries `{ id, flightKey, direction, code, outside }`, `code` the counterpart's IATA (else ICAO) code.
 * The flights keep their order; a cancelled or diverted one, one without a key and a repeated key are left out.
 */
export function flightRouteFeatures(flights, { station = PUJ_ARP, emphasised = null, exclude = null } = {}) {
  const home = isPoint(station) ? station : PUJ_ARP;
  const kept = emphasised == null ? null : new Set([...emphasised].map(String));
  const seen = new Set();
  const features = [];
  for (const flight of Array.isArray(flights) ? flights : []) {
    const key = keyOf(flight);
    if (key === null || seen.has(key) || key === exclude) continue;
    if (flight.phase === 'cancelled' || flight.phase === 'diverted') continue;
    const counterpart = counterpartPoint(flight.counterpart);
    if (counterpart === null) continue;
    seen.add(key);
    const departure = flight.direction === 'Departure';
    const parts = splitAtAntimeridian(departure ? greatCircle(home, counterpart, ARC_POINTS)
      : greatCircle(counterpart, home, ARC_POINTS));
    if (parts.length === 0) continue;
    features.push({
      type: 'Feature',
      id: key,
      properties: {
        id: key, flightKey: key, direction: departure ? 'Departure' : 'Arrival',
        code: text(flight.counterpart?.iataCode) ?? text(flight.counterpart?.icaoCode) ?? '',
        outside: kept !== null && !kept.has(key),
      },
      geometry: parts.length === 1
        ? { type: 'LineString', coordinates: parts[0] }
        : { type: 'MultiLineString', coordinates: parts },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The overlay of the AVIAM routes for buildOccStyle (OccMap's `overlays`): one thin line in the AVIAM traffic's accent,
 * faint, fainter still outside the board's filter, in the `reference` slot and the «Rutas de los vuelos de AVIAM» group,
 * hidden from the airfield threshold on.
 */
export function flightRoutesOverlay({ theme = 'dark' } = {}) {
  const { width, opacity, outsideOpacity } = FLIGHT_ROUTE_STYLE;
  return {
    sources: { [FLIGHT_ROUTES_SOURCE]: { type: 'geojson' } },
    layers: [
      {
        slot: 'reference',
        id: FLIGHT_ROUTES_LAYER_ID,
        type: 'line',
        source: FLIGHT_ROUTES_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': occColor('accent', theme),
          'line-width': width,
          'line-opacity': ['case', ['==', ['get', 'outside'], true], outsideOpacity, opacity],
        },
        metadata: { 'occ:group': FLIGHT_ROUTES_GROUP, 'occ:maxThreshold': 'airfield' },
      },
    ],
  };
}
