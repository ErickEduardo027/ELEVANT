import { describe, expect, it } from 'vitest';
import { PUJ_ARP } from '../core/cameraPresets';
import { occColor } from '../../occ-ui/occPalette';
import {
  FLIGHT_ROUTES_GROUP, FLIGHT_ROUTES_LAYER_ID, FLIGHT_ROUTES_SOURCE, FLIGHT_ROUTE_STYLE, flightRouteFeatures,
  flightRoutesOverlay, splitAtAntimeridian,
} from './flightRouteLayers';

// Synthetic map flights (contracts 1.3): invented keys and numbers; the airports are real ones of OurAirports.
const flight = overrides => ({
  flightKey: 'l:leg-1', legId: 'leg-1', direction: 'Arrival', phase: 'enroute',
  counterpart: { iataCode: 'MIA', icaoCode: 'KMIA', longitude: -80.29, latitude: 25.79 }, ...overrides,
});
const ends = feature => {
  const { geometry } = feature;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  return [lines[0][0], lines.at(-1).at(-1)];
};

describe('splitAtAntimeridian (M8)', () => {
  it('keeps a line that does not cross as its only part', () => {
    const line = [[-80, 25], [-75, 22], [-68.36, 18.57]];
    expect(splitAtAntimeridian(line)).toEqual([line]);
    expect(splitAtAntimeridian([])).toEqual([]);
    expect(splitAtAntimeridian(null)).toEqual([]);
    expect(splitAtAntimeridian([[1, 2]])).toEqual([[[1, 2]]]);
  });

  it('cuts a line at 180 both ways, each part ending on the edge at the latitude between', () => {
    expect(splitAtAntimeridian([[170, 10], [178, 10], [-178, 20], [-170, 20]]))
      .toEqual([[[170, 10], [178, 10], [180, 15]], [[-180, 15], [-178, 20], [-170, 20]]]);
    expect(splitAtAntimeridian([[-170, 0], [-179, 0], [179, 10], [170, 10]]))
      .toEqual([[[-170, 0], [-179, 0], [-180, 5]], [[180, 5], [179, 10], [170, 10]]]);
  });
});

describe('flightRouteFeatures (M8)', () => {
  it('draws origin to the station for an arrival and the station to the destination for a departure', () => {
    const { type, features } = flightRouteFeatures([
      flight(),
      flight({ flightKey: 'l:leg-2', legId: 'leg-2', direction: 'Departure', phase: 'scheduled',
        counterpart: { iataCode: 'YYZ', icaoCode: 'CYYZ', longitude: -79.63, latitude: 43.68 } }),
    ]);
    expect(type).toBe('FeatureCollection');
    expect(features.map(feature => [feature.id, feature.properties])).toEqual([
      ['l:leg-1', { id: 'l:leg-1', flightKey: 'l:leg-1', direction: 'Arrival', code: 'MIA', outside: false }],
      ['l:leg-2', { id: 'l:leg-2', flightKey: 'l:leg-2', direction: 'Departure', code: 'YYZ', outside: false }],
    ]);
    expect(ends(features[0])).toEqual([[-80.29, 25.79], [PUJ_ARP[0], PUJ_ARP[1]]]);
    expect(ends(features[1])).toEqual([[PUJ_ARP[0], PUJ_ARP[1]], [-79.63, 43.68]]);
    expect(features[0].geometry.type).toBe('LineString');
    expect(features[0].geometry.coordinates).toHaveLength(64);
  });

  it('finds a counterpart without a position among the world airports, and leaves out one it cannot place', () => {
    const { features } = flightRouteFeatures([
      // Madrid by its code alone (airport/worldAirports.js: counterpartPoint).
      flight({ flightKey: 'l:mad', counterpart: { iataCode: 'MAD', icaoCode: 'LEMD' } }),
      flight({ flightKey: 'l:nowhere', counterpart: { iataCode: 'ZZZ', icaoCode: null } }),
      flight({ flightKey: 'l:none', counterpart: null }),
    ]);
    expect(features.map(feature => feature.id)).toEqual(['l:mad']);
    const [from] = ends(features[0]);
    expect(from[0]).toBeCloseTo(-3.57, 1);
    expect(from[1]).toBeCloseTo(40.47, 1);
  });

  it('cuts a route that crosses the antimeridian into a MultiLineString', () => {
    const { features } = flightRouteFeatures([
      flight({ flightKey: 'l:far', direction: 'Departure', counterpart: { iataCode: 'XXX', longitude: 170, latitude: 0 } }),
    ], { station: [-170, 0] });
    expect(features[0].geometry.type).toBe('MultiLineString');
    const parts = features[0].geometry.coordinates;
    expect(parts).toHaveLength(2);
    expect(parts[0].at(-1)[0]).toBe(-180);
    expect(parts[1][0][0]).toBe(180);
    for (const part of parts) {
      for (let index = 1; index < part.length; index += 1) {
        expect(Math.abs(part[index][0] - part[index - 1][0])).toBeLessThan(180);
      }
    }
  });

  it('marks outside the board filter the routes it leaves out, and skips the chosen, cancelled and repeated flights', () => {
    const flights = [
      flight({ flightKey: 'l:a' }),
      flight({ flightKey: 'l:b' }),
      flight({ flightKey: 'l:a' }),
      flight({ flightKey: 'l:chosen' }),
      flight({ flightKey: 'l:cancelled', phase: 'cancelled' }),
      flight({ flightKey: 'l:diverted', phase: 'diverted' }),
      flight({ flightKey: null, legId: null }),
      // Without a key of its own, its leg id names it.
      flight({ flightKey: null, legId: 77 }),
    ];
    const result = flightRouteFeatures(flights, { emphasised: new Set(['l:b']), exclude: 'l:chosen' });
    expect(result.features.map(feature => [feature.id, feature.properties.outside]))
      .toEqual([['l:a', true], ['l:b', false], ['77', true]]);
    // No filter: nothing is outside it.
    expect(flightRouteFeatures(flights).features.every(feature => feature.properties.outside === false)).toBe(true);
    // A filter that keeps nothing leaves every route outside it.
    expect(flightRouteFeatures(flights, { emphasised: [] }).features.every(feature => feature.properties.outside))
      .toBe(true);
    expect(flightRouteFeatures(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('starts at PUJ when the station has no position', () => {
    const { features } = flightRouteFeatures([flight({ direction: 'Departure' })], { station: null });
    expect(ends(features[0])[0]).toEqual([PUJ_ARP[0], PUJ_ARP[1]]);
  });
});

describe('flightRoutesOverlay (M8)', () => {
  it('is one thin, faint line of the AVIAM accent in the reference slot, fainter outside the filter, off at the airfield', () => {
    const overlay = flightRoutesOverlay({ theme: 'light' });
    expect(overlay.sources).toEqual({ [FLIGHT_ROUTES_SOURCE]: { type: 'geojson' } });
    expect(overlay.layers).toHaveLength(1);
    const [layer] = overlay.layers;
    expect(layer).toMatchObject({
      slot: 'reference', id: FLIGHT_ROUTES_LAYER_ID, type: 'line', source: FLIGHT_ROUTES_SOURCE,
      metadata: { 'occ:group': FLIGHT_ROUTES_GROUP, 'occ:maxThreshold': 'airfield' },
    });
    expect(FLIGHT_ROUTES_GROUP).toBe('traffic.routes');
    expect(layer.paint['line-color']).toBe(occColor('accent', 'light'));
    expect(layer.paint['line-width']).toBe(FLIGHT_ROUTE_STYLE.width);
    expect(layer.paint['line-opacity']).toEqual(['case', ['==', ['get', 'outside'], true],
      FLIGHT_ROUTE_STYLE.outsideOpacity, FLIGHT_ROUTE_STYLE.opacity]);
    expect(FLIGHT_ROUTE_STYLE.outsideOpacity).toBeLessThan(FLIGHT_ROUTE_STYLE.opacity);
    expect(FLIGHT_ROUTE_STYLE.opacity).toBeLessThan(1);
    expect(flightRoutesOverlay().layers[0].paint['line-color']).toBe(occColor('accent', 'dark'));
  });
});
