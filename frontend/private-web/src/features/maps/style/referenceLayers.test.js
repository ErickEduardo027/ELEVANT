import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { PUJ_ARP } from '../core/cameraPresets';
import { HOME_AIRPORT_IATA, basemapLayers } from './basemapLayers';
import { MAP_IMAGE_IDS } from './mapImages';
import { FONT_STACKS, buildOccStyle } from './occStyle';
import { MAP_COLORS } from './mapColors';
import {
  AIRPORTS_GROUP, REFERENCE_SOURCE, airportFeatures, airportKind, airportLabel, referenceFeatures, referenceOverlay,
} from './referenceLayers';

describe('reference layers', () => {
  it('draw the ARP of PUJ with its label up to the codes threshold, in place of the airport marker', () => {
    const layer = referenceOverlay().layers.find(item => item.id === 'occ-reference-arp');
    expect(layer).toMatchObject({ slot: 'airfield', type: 'symbol', source: REFERENCE_SOURCE });
    expect(layer.layout).toMatchObject({ 'icon-image': 'airport-arp', 'text-font': [...FONT_STACKS.bold], 'text-field': ['get', 'label'] });
    // The label sits above the mark, clear of the stands south of the reference point.
    expect(layer.layout).toMatchObject({ 'text-anchor': 'bottom', 'text-offset': [0, -0.9], 'text-optional': true });
    expect(MAP_IMAGE_IDS).toContain(layer.layout['icon-image']);
    expect(layer.metadata).toEqual({ 'occ:group': 'reference', 'occ:maxThreshold': 'codes' });
    expect([layer.paint['icon-color'], layer.paint['text-color']]).toEqual([occColor('text'), occColor('text')]);
    expect(referenceFeatures().features[0]).toEqual(
      { type: 'Feature', properties: { kind: 'arp', label: 'PUJ' }, geometry: { type: 'Point', coordinates: [...PUJ_ARP] } });
    expect(PUJ_ARP).toEqual([-68.3634, 18.5674]);
    const style = buildOccStyle({ overlays: [referenceOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('draws the mark above the pavement and the base-map labels, so neither hides the airport', () => {
    const ids = buildOccStyle({ overlays: [referenceOverlay()] }).layers.map(layer => layer.id);
    const arp = ids.indexOf('occ-reference-arp');
    // MapLibre draws later layers on top and places their symbols first.
    for (const id of ['airfield-runway', 'airfield-taxiway', 'airfield-apron', 'airfield-runway-ref', 'base-label-city',
      'base-label-aerodrome']) {
      expect(arp, id).toBeGreaterThan(ids.indexOf(id));
    }
    expect(arp).toBeLessThan(ids.indexOf('slot-stands'));
  });

  it('leaves the tile label of the home airport out of the base map, so PUJ is written once', () => {
    const aerodrome = basemapLayers().baseLabels.find(layer => layer.id === 'base-label-aerodrome');
    const shows = iata => featureFilter(aerodrome.filter, 'layers.base-label-aerodrome.filter')
      .filter({ zoom: 9 }, { type: 1, properties: iata === null ? {} : { iata } });
    expect(HOME_AIRPORT_IATA).toBe(referenceFeatures().features[0].properties.label);
    expect([shows('PUJ'), shows('SDQ'), shows('LRM'), shows(null)]).toEqual([false, true, true, false]);
  });

  it('the airports of the region: 32 dots coloured by kind with a yellow ICAO/IATA label, below the airfield threshold', () => {
    const airports = airportFeatures();
    expect(airports).toHaveLength(32);
    expect(referenceFeatures().features).toHaveLength(33);
    const home = airports.filter(feature => feature.properties.airportKind === 'home');
    expect(home.map(feature => feature.properties.label)).toEqual(['MDPC']);
    const kinds = new Set(airports.map(feature => feature.properties.airportKind));
    expect([...kinds].sort()).toEqual(['home', 'international', 'other', 'regional']);
    expect(airportKind({ icao: 'MDLR', type: 'large_airport' })).toBe('international');
    expect(airportKind({ icao: 'TJBQ', iata: 'BQN', type: 'medium_airport', name: 'Rafael Hernández' })).toBe('regional');
    expect(airportKind({ ident: 'X1', type: 'small_airport', name: 'Pista' })).toBe('other');
    expect(airportLabel({ icao: 'MDSD', iata: 'SDQ', type: 'large_airport' })).toBe('MDSD/SDQ');
    expect(airportLabel({ icao: 'MDXX', iata: '' })).toBe('MDXX');

    const layers = referenceOverlay().layers.filter(layer => layer.metadata['occ:group'] === AIRPORTS_GROUP);
    expect(layers.map(layer => layer.id)).toEqual(['occ-region-airports', 'occ-region-airport-labels']);
    for (const layer of layers) expect(layer.metadata['occ:maxThreshold']).toBe('airfield');
    const [dots, labels] = layers;
    const { airports: colours } = MAP_COLORS.dark;
    expect(dots.paint['circle-color']).toEqual(['match', ['get', 'airportKind'], 'home', colours.home, 'international',
      colours.international, 'regional', colours.regional, colours.other]);
    // The home airport is larger than every other.
    const radius = dots.paint['circle-radius'];
    expect(radius[3]).toBeGreaterThan(Math.max(...radius.slice(4).filter(Number.isFinite)));
    expect(labels.paint['text-color']).toBe(colours.label);
    expect(labels.layout['text-field']).toEqual(['get', 'label']);
    // Above the base-map labels, so the tile label of the same airport gives way.
    const ids = buildOccStyle({ overlays: [referenceOverlay()] }).layers.map(layer => layer.id);
    expect(ids.indexOf('occ-region-airport-labels')).toBeGreaterThan(ids.indexOf('base-label-aerodrome'));
    // A map without traffic draws the mark of PUJ alone.
    expect(referenceOverlay({ airports: false }).layers.map(layer => layer.id)).toEqual(['occ-reference-arp']);
    expect(referenceFeatures({ airports: false }).features).toHaveLength(1);
  });
});
