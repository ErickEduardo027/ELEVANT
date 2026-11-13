import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { AIRFIELD_ATTRIBUTION } from '../core/attribution';
import { thresholdsFromFits } from '../core/cameraPresets';
import { createMapEngine } from '../core/mapEngine';
import {
  AIRFIELD_GROUP, AIRFIELD_LAYER_IDS, AIRFIELD_LEGEND_KINDS, AIRFIELD_SOURCE, airfieldKindsOnScreen, airfieldOverlay,
  airfieldTooltip,
} from './airfieldLayers';
import { FONT_STACKS } from './basemapLayers';
import { BASEMAP_COLORS, contrastRatio, relativeLuminance } from './mapTheme';
import { buildOccStyle } from './occStyle';

const overlay = airfieldOverlay();
const layerOf = id => overlay.layers.find(layer => layer.id === id);
const TILE_AEROWAY = ['airfield-apron', 'airfield-runway-area', 'airfield-taxiway', 'airfield-runway', 'airfield-runway-ref'];

const COLOUR = /^(?:#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\))$/i;
function coloursIn(value) {
  if (typeof value === 'string') return COLOUR.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(coloursIn);
  return [];
}
const paintColours = layer => Object.entries(layer.paint ?? {})
  .filter(([property]) => property.endsWith('-color'))
  .flatMap(([property, value]) => coloursIn(value).map(colour => [property, colour]));

// The chroma of an opaque #rrggbb colour, 0 for a grey to 1 for a pure hue: the slates of the OCC stay near 0.
function chroma(hex) {
  const channels = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  return Math.max(...channels) - Math.min(...channels);
}

// The outputs of a zoom expression, or the value itself.
const stopsOf = value => (Array.isArray(value) && value[0] === 'interpolate' ? value.slice(3).filter((_, at) => at % 2 === 1) : [value]);

const engines = [];
afterEach(() => {
  engines.splice(0).forEach(engine => engine.destroy());
  document.body.replaceChildren();
});

function startEngine(style) {
  const fake = createFakeMapLibre();
  const host = document.createElement('div');
  document.body.append(host);
  const engine = createMapEngine({ maplibre: fake.module, host, style });
  engines.push(engine);
  const map = fake.state.maps.at(-1);
  fake.state.emit(map, 'style.load');
  return { engine, map, state: fake.state };
}

describe('airfield layers', () => {
  it('the style with the airfield overlay passes validateStyleMin with and without the base map', () => {
    for (const basemap of [true, false]) {
      const style = buildOccStyle({ basemap, overlays: [overlay] });
      expect(validateStyleMin(style), String(basemap)).toEqual([]);
      // Filled with the dataset, the source still validates.
      style.sources[AIRFIELD_SOURCE].data = airfieldFeatures(MDPC_LAYOUT);
      expect(validateStyleMin(style), String(basemap)).toEqual([]);
    }
    // Every layer sits in the airfield slot, in its drawing order, above the tile aeroway of that slot.
    const style = buildOccStyle({ overlays: [overlay] });
    const ids = style.layers.map(layer => layer.id);
    const slot = ids.slice(ids.indexOf('slot-airfield') + 1, ids.indexOf('slot-stands'));
    expect(slot).toEqual([...TILE_AEROWAY, ...AIRFIELD_LAYER_IDS]);
    expect(AIRFIELD_LAYER_IDS).toEqual([
      'occ-airfield-apron', 'occ-airfield-terminal', 'occ-airfield-terminal-outline', 'occ-airfield-taxiway',
      'occ-airfield-runway-axis', 'occ-airfield-runway', 'occ-airfield-centreline', 'occ-airfield-threshold',
      'occ-airfield-hold', 'occ-airfield-taxiway-name', 'occ-airfield-designator',
    ]);
    // Only the three Noto Sans stacks, never below 12 px.
    for (const layer of overlay.layers.filter(item => item.type === 'symbol')) {
      expect(Object.values(FONT_STACKS).map(stack => JSON.stringify(stack))).toContain(JSON.stringify(layer.layout['text-font']));
      expect(Math.min(...stopsOf(layer.layout['text-size'])), layer.id).toBeGreaterThanOrEqual(12);
    }
  });

  it('every airfield layer starts at the derived airfield threshold and every tile aeroway layer ends there', () => {
    const style = buildOccStyle({ overlays: [overlay] });
    for (const layer of overlay.layers) {
      expect(layer.metadata, layer.id).toMatchObject({ 'occ:group': AIRFIELD_GROUP, 'occ:minThreshold': 'airfield' });
      expect(layer.metadata['occ:maxThreshold'], layer.id).toBeUndefined();
      // Never a fixed zoom: the engine sets the range from the fitted views.
      expect(layer, layer.id).not.toHaveProperty('minzoom');
      expect(layer, layer.id).not.toHaveProperty('maxzoom');
    }
    const tiles = style.layers.filter(layer => layer['source-layer'] === 'aeroway');
    expect(tiles.map(layer => layer.id)).toEqual(TILE_AEROWAY);
    for (const layer of tiles) {
      expect(layer.metadata, layer.id).toMatchObject({ 'occ:group': 'airfield', 'occ:maxThreshold': 'airfield' });
      expect(layer, layer.id).not.toHaveProperty('maxzoom');
    }

    // On a map: the fitted views give the threshold, and the engine hands the airfield over to the dataset there.
    const { engine, map } = startEngine(style);
    const fits = { region: 5.6, approach: 8.8, airfield: 14.6, ramp: 15.5 };
    const thresholds = thresholdsFromFits(fits);
    expect(thresholds.airfield).toBeCloseTo((8.8 + 14.6) / 2, 9);
    engine.applyThresholds(thresholds);
    const ranges = Object.fromEntries(map.zoomRangeCalls.map(call => [call.id, [call.minzoom, call.maxzoom]]));
    for (const id of AIRFIELD_LAYER_IDS) expect(ranges[id], id).toEqual([thresholds.airfield, 24]);
    for (const layer of tiles) expect(ranges[layer.id], layer.id).toEqual([layer.minzoom, thresholds.airfield]);
  });

  it('pavement comes from the base-map palette with runways lighter than aprons; markings use --occ-text and labels a dim token; no other colour', () => {
    const colours = Object.fromEntries(overlay.layers.map(layer => [layer.id, paintColours(layer)]));
    expect(colours).toEqual({
      'occ-airfield-apron': [['fill-color', BASEMAP_COLORS.apron]],
      'occ-airfield-terminal': [['fill-color', BASEMAP_COLORS.building]],
      'occ-airfield-terminal-outline': [['line-color', occColor('line-strong')]],
      'occ-airfield-taxiway': [['line-color', BASEMAP_COLORS.taxiway]],
      'occ-airfield-runway-axis': [['line-color', BASEMAP_COLORS.runway]],
      'occ-airfield-runway': [['fill-color', BASEMAP_COLORS.runway]],
      'occ-airfield-centreline': [['line-color', occColor('text')]],
      'occ-airfield-threshold': [['line-color', occColor('text')]],
      'occ-airfield-hold': [['line-color', occColor('text')]],
      'occ-airfield-taxiway-name': [['text-color', occColor('faint')], ['text-halo-color', BASEMAP_COLORS.labelHalo]],
      'occ-airfield-designator': [['text-color', occColor('text')], ['text-halo-color', BASEMAP_COLORS.labelHalo]],
    });
    expect(relativeLuminance(BASEMAP_COLORS.runway)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.apron));
    // No hue: every colour is a slate of the base map or of the OCC tokens.
    const used = [...new Set(Object.values(colours).flat().map(([, colour]) => colour))];
    const known = new Set([...Object.values(BASEMAP_COLORS), ...Object.values(OCC_PALETTE)]);
    for (const colour of used) {
      expect(known.has(colour), colour).toBe(true);
      expect(chroma(colour), colour).toBeLessThan(0.1);
    }
    // The centreline is dashed; the bars are solid.
    expect(layerOf('occ-airfield-centreline').paint['line-dasharray']).toEqual([6, 5]);
    expect(layerOf('occ-airfield-hold').paint).not.toHaveProperty('line-dasharray');
    // The labels read on the pavement and the land around it.
    expect(contrastRatio(occColor('faint'), BASEMAP_COLORS.taxiway)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(occColor('faint'), BASEMAP_COLORS.land)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(occColor('text'), BASEMAP_COLORS.runway)).toBeGreaterThanOrEqual(4.5);
    // The designators face their runway end's heading, flat on the map.
    expect(layerOf('occ-airfield-designator').layout).toMatchObject({
      'text-field': ['get', 'ref'], 'text-rotate': ['get', 'rotate'], 'text-rotation-alignment': 'map',
      'text-font': ['Noto Sans Bold'],
    });
    expect(layerOf('occ-airfield-taxiway-name').layout).toMatchObject({
      'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Regular'], 'text-size': 12,
    });
  });

  it('runways and taxiways are pickable by id and their source carries the OpenStreetMap (ODbL) and OurAirports credit', () => {
    const picks = overlay.layers.filter(layer => layer.metadata['occ:pick'])
      .map(layer => [layer.id, layer.metadata['occ:pick'], layer.metadata['occ:pickId']]);
    expect(picks).toEqual([
      ['occ-airfield-taxiway', 'taxiway', 'id'], ['occ-airfield-runway-axis', 'runway', 'id'], ['occ-airfield-runway', 'runway', 'id'],
    ]);
    expect(overlay.sources).toEqual({ [AIRFIELD_SOURCE]: { type: 'geojson', attribution: AIRFIELD_ATTRIBUTION } });
    const style = buildOccStyle({ overlays: [overlay] });
    expect(style.sources[AIRFIELD_SOURCE]).toEqual({
      type: 'geojson', attribution: AIRFIELD_ATTRIBUTION, data: { type: 'FeatureCollection', features: [] },
    });
    const credit = document.createElement('template');
    credit.innerHTML = AIRFIELD_ATTRIBUTION;
    expect(credit.content.textContent).toBe('© OpenStreetMap contributors (ODbL) · OurAirports');

    // The engine picks a runway and a taxiway by the id of their feature.
    const { engine, map, state } = startEngine(style);
    const runway = { layer: { id: 'occ-airfield-runway' }, properties: { kind: 'runway', id: '08/26', ref: '08/26', lengthM: 3100.1, widthM: 45.1 } };
    state.setRenderedFeatures(map, (_geometry, options) => (options.layers.includes('occ-airfield-runway') ? [runway] : []));
    expect(engine.pickAt({ x: 10, y: 10 })).toEqual({ kind: 'runway', id: '08/26', feature: runway });
    const taxiway = { layer: { id: 'occ-airfield-taxiway' }, properties: { kind: 'taxiway', id: 'tw-1', ref: 'A' } };
    state.setRenderedFeatures(map, () => [taxiway]);
    expect(engine.pickAt({ x: 10, y: 10 })).toMatchObject({ kind: 'taxiway', id: 'tw-1' });
  });

  it('tells the legend which airfield items are drawn, in its order', () => {
    const drawn = (layer, kind) => ({ layer: { id: layer }, properties: { kind } });
    expect(AIRFIELD_LEGEND_KINDS).toEqual(['runway', 'taxiway', 'holdBar', 'apron', 'terminal']);
    expect(airfieldKindsOnScreen([
      drawn('occ-airfield-terminal', 'terminal'), drawn('occ-airfield-hold', 'holdBar'), drawn('occ-airfield-taxiway', 'taxilane'),
      drawn('occ-airfield-designator', 'designator'), drawn('occ-airfield-apron', 'apron'), drawn('occ-airfield-apron', 'apron'),
    ])).toEqual(['runway', 'taxiway', 'holdBar', 'apron', 'terminal']);
    // A threshold bar is part of its runway; the names alone say a taxiway is there.
    expect(airfieldKindsOnScreen([drawn('occ-airfield-threshold', 'thresholdBar')])).toEqual(['runway']);
    expect(airfieldKindsOnScreen([drawn('occ-airfield-taxiway-name', 'taxiway')])).toEqual(['taxiway']);
    // Features of other layers, and kinds the airfield does not draw, are not airfield items.
    expect(airfieldKindsOnScreen([drawn('occ-stands-frame', 'runway'), drawn('occ-airfield-apron', 'toString'), {}, null])).toEqual([]);
    expect(airfieldKindsOnScreen(undefined)).toEqual([]);
  });

  it('reads what the tooltip shows from the picked feature', () => {
    const runway = { kind: 'runway', id: '08/26', feature: { properties: { ref: '08/26', lengthM: 3100.1, widthM: 45.1 } } };
    expect(airfieldTooltip(runway)).toEqual({ kind: 'runway', id: '08/26', ref: '08/26', lengthM: 3100.1, widthM: 45.1 });
    expect(airfieldTooltip({ kind: 'runway', id: '09/27', feature: { properties: { lengthM: '3100' } } }))
      .toEqual({ kind: 'runway', id: '09/27', ref: '09/27', lengthM: null, widthM: null });
    expect(airfieldTooltip({ kind: 'taxiway', id: 'tw-1', feature: { properties: { ref: 'A' } } }))
      .toEqual({ kind: 'taxiway', id: 'tw-1', ref: 'A' });
    // A taxiway without a name (MapLibre drops a null property) is still a taxiway.
    expect(airfieldTooltip({ kind: 'taxiway', id: 'tw-2', feature: { properties: {} } })).toEqual({ kind: 'taxiway', id: 'tw-2', ref: null });
    for (const hit of [null, { kind: 'stand', id: 'A1' }, { kind: 'cluster', id: 3 }, { kind: 'runway', id: null }]) {
      expect(airfieldTooltip(hit), JSON.stringify(hit)).toBeNull();
    }
  });
});
