import { describe, expect, it } from 'vitest';
import { PUJ_ARP } from '../core/cameraPresets';
import { buildOccStyle } from './occStyle';
import { mapColorsFor } from './mapColors';
import {
  MAX_DRAWN_ROUTES, ROUTES_GROUP, ROUTES_SOURCE, greatCircle, routeDestination, routeFeatures, routesOverlay,
} from './routeLayers';

// «Rutas desde Punta Cana» (ADR-0043, note of 15 November 2026): invented routes in the shape the API sends.
const route = (iata, flights, position = null, icao = null) => ({ destinationIata: iata, destinationIcao: icao, name: iata,
  city: null, countryCode: null, latitude: position?.[1] ?? null, longitude: position?.[0] ?? null,
  averageDailyFlights: flights, operators: [] });

describe('routes from Punta Cana', () => {
  it('draws a great circle from PUJ that ends where the destination is', () => {
    const line = greatCircle(PUJ_ARP, [-73.7789, 40.6398]);
    expect(line).toHaveLength(48);
    expect(line[0][0]).toBeCloseTo(PUJ_ARP[0], 4);
    expect(line.at(-1)).toEqual([-73.7789, 40.6398]);
    // North of the straight line between the ends, as a great circle to New York is.
    const middle = line[24];
    expect(middle[1]).toBeGreaterThan((PUJ_ARP[1] + 40.6398) / 2);
    expect(greatCircle(PUJ_ARP, PUJ_ARP)).toHaveLength(2);
  });

  it('takes the position of the answer, else the region\'s airport, and leaves out a route without either', () => {
    expect(routeDestination(route('YYZ', 6, [-79.63, 43.68]))).toEqual([-79.63, 43.68]);
    expect(routeDestination(route('SDQ', 4, null, 'MDSD'))).not.toBeNull();
    expect(routeDestination(route('XXX', 4))).toBeNull();
    const data = routeFeatures([route('XXX', 9), route('JFK', 3.5, [-73.78, 40.64]), route('YYZ', 6, [-79.63, 43.68])]);
    expect(data.features.map(feature => feature.properties.code)).toEqual(['YYZ', 'JFK']);
    expect(data.features.map(feature => feature.properties.label)).toEqual(['YYZ · 6/día', 'JFK · 3,5/día']);
    expect(routeFeatures([route('JFK', 3.5, [-73.78, 40.64])], { locale: 'en', perDay: '/day' }).features[0].properties.label)
      .toBe('JFK · 3.5/day');
    const many = Array.from({ length: 60 }, (_, index) => route(`A${index}`, index + 1, [-70, 19 + index / 10]));
    expect(routeFeatures(many).features).toHaveLength(MAX_DRAWN_ROUTES);
  });

  it('is a reference layer of its own group, in each theme\'s colours, hidden from the airfield threshold', () => {
    for (const theme of ['dark', 'light']) {
      const overlay = routesOverlay({ theme });
      expect(Object.keys(overlay.sources)).toEqual([ROUTES_SOURCE]);
      expect(overlay.layers.map(layer => layer.id)).toEqual(['occ-routes-line', 'occ-routes-label']);
      for (const layer of overlay.layers) {
        expect(layer.metadata).toEqual({ 'occ:group': ROUTES_GROUP, 'occ:maxThreshold': 'airfield' });
        expect(layer.slot).toBe('reference');
      }
      expect(overlay.layers[0].paint['line-color']).toBe(mapColorsFor(theme).routes.line);
      expect(() => buildOccStyle({ overlays: [overlay], theme })).not.toThrow();
    }
    expect(mapColorsFor('dark').routes.line).not.toBe(mapColorsFor('light').routes.line);
  });
});
