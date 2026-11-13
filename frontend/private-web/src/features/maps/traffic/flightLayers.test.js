import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { MAP_IMAGE_IDS } from '../style/mapImages';
import { buildOccStyle } from '../style/occStyle';
import { FLIGHT_SOURCE, flightOverlay, toFlightFeatures } from './flightLayers';

// Synthetic flights of Monitoreo: invented numbers and positions around Punta Cana.
const flight = overrides => ({ id: 1, flightNumber: 'ZZ101', status: 'approaching', heading: 310, latitude: 18.7, longitude: -68.5, ...overrides });

describe('flight layers', () => {
  it('only flights with a finite position become symbols, rotated by heading', () => {
    const data = toFlightFeatures([
      flight({ id: 1 }),
      flight({ id: 'l:leg-2', heading: null, latitude: 18.9, longitude: -68.1 }),
      flight({ id: 3, latitude: null }),
      flight({ id: 4, longitude: Number.NaN }),
      flight({ id: 5, latitude: '18.6', longitude: '-68.3' }),
      flight({ id: null }),
      null,
    ]);
    expect(data).toEqual({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: '1', heading: 310 }, geometry: { type: 'Point', coordinates: [-68.5, 18.7] } },
        { type: 'Feature', properties: { id: 'l:leg-2', heading: 0 }, geometry: { type: 'Point', coordinates: [-68.1, 18.9] } },
      ],
    });
    expect(toFlightFeatures(undefined).features).toEqual([]);

    const [layer] = flightOverlay().layers;
    expect(layer.layout).toMatchObject({
      'icon-image': 'aircraft-solid', 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map',
    });
    expect(MAP_IMAGE_IDS).toContain(layer.layout['icon-image']);
    // One colour for every state: the text colour, never a hue per state.
    expect(layer.paint['icon-color']).toBe(occColor('text'));
    expect(layer.metadata).toMatchObject({ 'occ:pick': 'flight', 'occ:pickId': 'id' });
    expect(flightOverlay().sources[FLIGHT_SOURCE]).toEqual({ type: 'geojson', promoteId: 'id' });
    const style = buildOccStyle({ basemap: false, overlays: [flightOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
    const ids = style.layers.map(item => item.id);
    expect(ids.indexOf('occ-flights')).toBe(ids.indexOf('slot-traffic') + 1);
  });
});
