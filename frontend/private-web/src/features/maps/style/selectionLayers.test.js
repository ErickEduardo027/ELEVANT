import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { MAP_IMAGE_IDS } from './mapImages';
import { buildOccStyle } from './occStyle';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from './selectionLayers';

const STANDS = [
  { id: 'A5', terminal: 'A', lat: 18.564028, lon: -68.362833 },
  { id: 'B33', terminal: 'B', lat: 18.5627, lon: -68.3721, retired: true },
  { code: 'B21', terminalCode: 'B', latitude: 18.563139, longitude: -68.369194 },
];
const FLIGHTS = [{ flightKey: 'l:leg-1', legId: 'leg-1', direction: 'Arrival', position: { latitude: 18.7, longitude: -68.1 } }];

describe('selection layers', () => {
  it('draws a cyan casing in the top slot from a source of its own, valid for MapLibre', () => {
    const style = buildOccStyle({ overlays: [selectionOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
    const ids = style.layers.map(layer => layer.id);
    const marker = ids.indexOf('slot-selection');
    expect(ids.slice(marker + 1)).toEqual(['occ-selection-stand', 'occ-selection-ring']);
    expect(style.sources[SELECTION_SOURCE]).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    const [stand, ring] = style.layers.slice(marker + 1);
    expect(stand.layout['icon-image']).toBe('stand-selected');
    expect(MAP_IMAGE_IDS).toContain('stand-selected');
    expect(stand.paint['icon-color']).toBe(occColor('accent'));
    expect(ring.paint).toMatchObject({
      'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': occColor('accent'),
    });
    for (const layer of [stand, ring]) expect(layer.metadata).toMatchObject({ 'occ:group': 'selection', 'occ:slot': 'selection' });
  });

  it('holds at most one feature, where the selected stand or flight is', () => {
    expect(selectionFeatures({ kind: 'stand', id: 'a05' }, { stands: STANDS })).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { kind: 'stand', id: 'A5' }, geometry: { type: 'Point', coordinates: [-68.362833, 18.564028] },
      }],
    });
    expect(selectionFeatures({ kind: 'stand', id: 'B21' }, { stands: STANDS }).features[0].geometry.coordinates)
      .toEqual([-68.369194, 18.563139]);
    expect(selectionFeatures({ kind: 'flight', id: 'leg-1' }, { flights: FLIGHTS }).features).toEqual([{
      type: 'Feature', properties: { kind: 'flight', id: 'leg-1' }, geometry: { type: 'Point', coordinates: [-68.1, 18.7] },
    }]);
    // A retired stand, an unknown one, an aircraft (until PR M5) and no selection draw nothing.
    for (const selection of [{ kind: 'stand', id: 'B33' }, { kind: 'stand', id: 'Z9' }, { kind: 'aircraft', id: 'a1b2c3' }, null]) {
      expect(selectionFeatures(selection, { stands: STANDS, flights: FLIGHTS }).features).toEqual([]);
    }
  });
});
