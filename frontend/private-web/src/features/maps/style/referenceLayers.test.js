import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { PUJ_ARP } from '../core/cameraPresets';
import { HOME_AIRPORT_IATA, basemapLayers } from './basemapLayers';
import { MAP_IMAGE_IDS } from './mapImages';
import { FONT_STACKS, buildOccStyle } from './occStyle';
import { REFERENCE_SOURCE, referenceFeatures, referenceOverlay } from './referenceLayers';

describe('reference layers', () => {
  it('draw the ARP of PUJ with its label up to the codes threshold, in place of the airport marker', () => {
    const [layer] = referenceOverlay().layers;
    expect(layer).toMatchObject({ slot: 'reference', type: 'symbol', source: REFERENCE_SOURCE });
    expect(layer.layout).toMatchObject({ 'icon-image': 'airport-arp', 'text-font': [...FONT_STACKS.bold], 'text-field': ['get', 'label'] });
    expect(MAP_IMAGE_IDS).toContain(layer.layout['icon-image']);
    expect(layer.metadata).toEqual({ 'occ:group': 'reference', 'occ:maxThreshold': 'codes' });
    expect([layer.paint['icon-color'], layer.paint['text-color']]).toEqual([occColor('text'), occColor('text')]);
    expect(referenceFeatures()).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { kind: 'arp', label: 'PUJ' }, geometry: { type: 'Point', coordinates: [...PUJ_ARP] } }],
    });
    expect(PUJ_ARP).toEqual([-68.3634, 18.5674]);
    const style = buildOccStyle({ overlays: [referenceOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('leaves the tile label of the home airport out of the base map, so PUJ is written once', () => {
    const aerodrome = basemapLayers().baseLabels.find(layer => layer.id === 'base-label-aerodrome');
    const shows = iata => featureFilter(aerodrome.filter, 'layers.base-label-aerodrome.filter')
      .filter({ zoom: 9 }, { type: 1, properties: iata === null ? {} : { iata } });
    expect(HOME_AIRPORT_IATA).toBe(referenceFeatures().features[0].properties.label);
    expect([shows('PUJ'), shows('SDQ'), shows('LRM'), shows(null)]).toEqual([false, true, true, false]);
  });
});
