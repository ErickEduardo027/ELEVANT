import { occColor } from '../../occ-ui/occPalette';
import region from '../airport/data/region.context.json';
import { PUJ_ARP } from '../core/cameraPresets';
import { FONT_STACKS, HOME_AIRPORT_IATA } from './basemapLayers';
import { mapColorsFor } from './mapColors';

// The fixed references of every OCC map: today the aerodrome reference point of Punta Cana with its «PUJ» label (it
// replaces the airport marker of Monitoreo). From the ramp view on the stands take over, so it hides behind the
// derived `codes` threshold. The label sits above the mark: the stands lie south of the reference point, so in the
// airfield view it stays clear of them. The tile label of the same airport is left out of the base map
// (basemapLayers.js), so PUJ is written once. PR M5 adds range rings, runway centrelines and the region's airports
// here. Pure.
//
// The mark of the home airport lies in the `airfield` slot, above the pavement and the base-map labels: in the
// `reference` slot a runway drawn over it, or a place name placed before it, hid the airport the map is about (seen
// in the map lab). The references PR M5 adds stay in the `reference` slot, under the airfield.

export const REFERENCE_SOURCE = 'occ-reference';
export const REFERENCE_GROUP = 'reference';
/**
 * The airports of the region (owner request of 2026-11-15): the 32 of airport/data/region.context.json (OurAirports,
 * public domain), a dot coloured by kind with its ICAO/IATA code in yellow, from the Región and Aproximación views
 * (below the derived `airfield` threshold) and in the layers menu («Referencias»). Above the base-map labels, so the
 * tile label of the same airport gives way to it.
 */
export const AIRPORTS_GROUP = 'reference.airports';
/** The kinds of the region's airports, in the legend's order. */
export const AIRPORT_KINDS = Object.freeze(['home', 'international', 'regional', 'other']);
const HOME_ICAO = 'MDPC';
const AIRPORT_RADIUS = Object.freeze({ home: 7, international: 5, regional: 4.5, other: 3.5 });

/** The kind of an airport of region.context.json: the home airport, international, regional, or another aerodrome. */
export function airportKind(airport) {
  if (airport?.icao === HOME_ICAO || airport?.ident === HOME_ICAO) return 'home';
  if (airport?.type === 'large_airport' || /international/i.test(airport?.name ?? '')) return 'international';
  if (airport?.type === 'medium_airport' && typeof airport?.iata === 'string' && airport.iata !== '') return 'regional';
  return 'other';
}

/** The label of an airport: «ICAO/IATA», or the one it has; the home airport its ICAO (the ARP mark says PUJ). */
export function airportLabel(airport) {
  const codes = [airport?.icao ?? airport?.ident, airport?.iata].filter(code => typeof code === 'string' && code !== '');
  if (airportKind(airport) === 'home') return codes[0] ?? '';
  return [...new Set(codes)].join('/');
}

function airportLayers(theme) {
  const { airports: colours } = mapColorsFor(theme);
  const kind = ['get', 'airportKind'];
  const byKind = value => ['match', kind, ...AIRPORT_KINDS.slice(0, -1).flatMap(name => [name, value(name)]),
    value(AIRPORT_KINDS.at(-1))];
  const metadata = { 'occ:group': AIRPORTS_GROUP, 'occ:maxThreshold': 'airfield' };
  const isAirport = ['==', ['get', 'kind'], 'airport'];
  return [
    {
      slot: ARP_SLOT,
      id: 'occ-region-airports',
      type: 'circle',
      source: REFERENCE_SOURCE,
      filter: isAirport,
      paint: {
        'circle-radius': byKind(name => AIRPORT_RADIUS[name]),
        'circle-color': byKind(name => colours[name]),
        'circle-stroke-color': colours.halo,
        'circle-stroke-width': 1.5,
      },
      metadata,
    },
    {
      slot: ARP_SLOT,
      id: 'occ-region-airport-labels',
      type: 'symbol',
      source: REFERENCE_SOURCE,
      filter: isAirport,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': [...FONT_STACKS.bold],
        'text-size': ['match', kind, 'home', 13, 12],
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'symbol-sort-key': ['match', kind, 'home', 0, 'international', 1, 'regional', 2, 3],
      },
      paint: { 'text-color': colours.label, 'text-halo-color': colours.halo, 'text-halo-width': 1.5 },
      metadata,
    },
  ];
}
/** The slot of the home airport's mark. */
export const ARP_SLOT = 'airfield';

/**
 * The overlay of the references for buildOccStyle: the region's airports (unless `airports: false`, a map without
 * traffic) and the mark of the home airport.
 */
export function referenceOverlay({ theme = 'dark', airports = true } = {}) {
  return {
    sources: { [REFERENCE_SOURCE]: { type: 'geojson' } },
    layers: [...(airports ? airportLayers(theme) : []), {
      slot: ARP_SLOT,
      id: 'occ-reference-arp',
      type: 'symbol',
      source: REFERENCE_SOURCE,
      filter: ['==', ['get', 'kind'], 'arp'],
      layout: {
        'icon-image': 'airport-arp',
        'icon-allow-overlap': true,
        'text-field': ['get', 'label'],
        'text-font': [...FONT_STACKS.bold],
        'text-size': 12,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.9],
        'text-optional': true,
      },
      paint: {
        'icon-color': occColor('text'),
        'icon-halo-color': occColor('nav'),
        'icon-halo-width': 1,
        'text-color': occColor('text'),
        'text-halo-color': occColor('nav'),
        'text-halo-width': 1.2,
      },
      metadata: { 'occ:group': REFERENCE_GROUP, 'occ:maxThreshold': 'codes' },
    }],
  };
}

/** The airports of the region as features of the reference source: `{ kind: 'airport', airportKind, icao, label }`. */
export function airportFeatures(airports = region.airports) {
  return (Array.isArray(airports) ? airports : []).filter(airport => Array.isArray(airport?.p)).map(airport => ({
    type: 'Feature',
    properties: { kind: 'airport', airportKind: airportKind(airport), icao: airport.icao ?? airport.ident ?? '',
      label: airportLabel(airport) },
    geometry: { type: 'Point', coordinates: [...airport.p] },
  }));
}

/**
 * The data of the reference source: the ARP of Punta Cana labelled with its IATA code, then the region's airports
 * (unless `airports: false`).
 */
export function referenceFeatures({ airports = true } = {}) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: 'arp', label: HOME_AIRPORT_IATA },
      geometry: { type: 'Point', coordinates: [...PUJ_ARP] },
    }, ...(airports ? airportFeatures() : [])],
  };
}
