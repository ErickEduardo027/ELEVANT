import region from '../airport/data/region.context.json';
import { PUJ_ARP } from '../core/cameraPresets';
import { FONT_STACKS } from './basemapLayers';
import { mapColorsFor } from './mapColors';

// «Rutas desde Punta Cana» (ADR-0043, note of 15 November 2026): the daily routes AeroDataBox reports from the station's
// airport, drawn in the Región view as great-circle lines from PUJ to each destination, wider for more daily flights,
// with a label «YYZ · 6/día» along the line. A reference layer of the «Referencias» group, under the airfield and the
// traffic, hidden from the derived `airfield` threshold on like the region's airports. The destination's position is the
// one the answer gives, else the region's airports (airport/data/region.context.json); one without either is left out.
// The data comes from the console's read (aviation-reference/useAirportRoutes.js) through OccMap's `overlayData`. Pure.

export const ROUTES_SOURCE = 'occ-routes';
export const ROUTES_GROUP = 'reference.routes';
/** Points of each great-circle line: smooth at the Región zoom, small for the source. */
const ARC_POINTS = 48;
/** The most routes drawn: the most frequent ones. */
export const MAX_DRAWN_ROUTES = 40;

const RADIANS = Math.PI / 180;

/** The points of the great circle from `from` to `to` ([lng, lat] each), `points` of them, ends included. */
export function greatCircle(from, to, points = ARC_POINTS) {
  const [lon1, lat1] = from.map(value => value * RADIANS);
  const [lon2, lat2] = to.map(value => value * RADIANS);
  const distance = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (!(distance > 1e-9)) return [[...from], [...to]];
  const line = [];
  for (let index = 0; index < points; index += 1) {
    const f = index / (points - 1);
    const a = Math.sin((1 - f) * distance) / Math.sin(distance);
    const b = Math.sin(f * distance) / Math.sin(distance);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    line.push([Math.round(Math.atan2(y, x) / RADIANS * 1e5) / 1e5,
      Math.round(Math.atan2(z, Math.sqrt(x * x + y * y)) / RADIANS * 1e5) / 1e5]);
  }
  return line;
}

const REGION_POSITIONS = new Map((region.airports ?? []).flatMap(airport => {
  if (!Array.isArray(airport?.p)) return [];
  return [airport.icao, airport.iata, airport.ident].filter(code => typeof code === 'string' && code !== '')
    .map(code => [code.toUpperCase(), airport.p]);
}));

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Where a route ends: the answer's position, else the region's airport with its ICAO or IATA code; null otherwise. */
export function routeDestination(route) {
  if (finite(route?.latitude) && finite(route?.longitude)) return [route.longitude, route.latitude];
  for (const code of [route?.destinationIcao, route?.destinationIata]) {
    const position = typeof code === 'string' ? REGION_POSITIONS.get(code.toUpperCase()) : null;
    if (position) return [...position];
  }
  return null;
}

/** «6», «3,5»: the daily flights as the label says them, one decimal at most. */
export function dailyFlightsText(flights, locale = 'es') {
  return Number(flights).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * The FeatureCollection of the routes for ROUTES_SOURCE: one LineString per route with a position, from `origin` (PUJ's
 * reference point by default), most frequent first, with `flights` (the daily average) and `label` («YYZ · 6/día»,
 * `perDay` the suffix of the language).
 */
export function routeFeatures(routes, { origin = PUJ_ARP, locale = 'es', perDay = '/día' } = {}) {
  const list = Array.isArray(routes) ? routes : [];
  const features = [];
  for (const route of [...list].sort((left, right) => (right?.averageDailyFlights ?? 0) - (left?.averageDailyFlights ?? 0))) {
    if (features.length >= MAX_DRAWN_ROUTES) break;
    const end = routeDestination(route);
    if (!end || !finite(route?.averageDailyFlights) || route.averageDailyFlights <= 0) continue;
    const code = route.destinationIata ?? route.destinationIcao ?? route.name;
    features.push({
      type: 'Feature',
      properties: { kind: 'route', code, name: route.name, flights: route.averageDailyFlights,
        label: `${code} · ${dailyFlightsText(route.averageDailyFlights, locale)}${perDay}` },
      geometry: { type: 'LineString', coordinates: greatCircle(origin, end) },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The overlay of the routes for buildOccStyle (OccMap's `overlays`): the line, wider from 1 to 6 daily flights and
 * beyond, and its label along it, both in the `reference` slot and the «Rutas desde Punta Cana» group.
 */
export function routesOverlay({ theme = 'dark' } = {}) {
  const { routes: colours } = mapColorsFor(theme);
  const metadata = { 'occ:group': ROUTES_GROUP, 'occ:maxThreshold': 'airfield' };
  return {
    sources: { [ROUTES_SOURCE]: { type: 'geojson' } },
    layers: [
      {
        slot: 'reference',
        id: 'occ-routes-line',
        type: 'line',
        source: ROUTES_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colours.line,
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['get', 'flights'], 1, 1.2, 3, 2.2, 6, 3.6, 12, 5],
        },
        metadata,
      },
      {
        slot: 'reference',
        id: 'occ-routes-label',
        type: 'symbol',
        source: ROUTES_SOURCE,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'label'],
          'text-font': [...FONT_STACKS.bold],
          'text-size': 11,
          'symbol-sort-key': ['-', 0, ['get', 'flights']],
          'text-max-angle': 30,
        },
        paint: { 'text-color': colours.label, 'text-halo-color': colours.halo, 'text-halo-width': 1.5 },
        metadata,
      },
    ],
  };
}
