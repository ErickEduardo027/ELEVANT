import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { airportStructures, structureFeatures } from '../airport/structures';
import { AIRFIELD_ATTRIBUTION } from '../core/attribution';
import { thresholdsFromFits } from '../core/cameraPresets';
import { createMapEngine } from '../core/mapEngine';
import {
  AIRFIELD_GROUP, AIRFIELD_LAYER_IDS, AIRFIELD_LEGEND_KINDS, AIRFIELD_SOURCE, AIRFIELD_STRUCTURE_LAYER_IDS,
  AIRFIELD_STRUCTURES_SOURCE, airfieldKindsOnScreen, airfieldOverlay, airfieldTooltip,
} from './airfieldLayers';
import { FONT_STACKS, RUNWAY_WIDTH, TAXIWAY_WIDTH } from './basemapLayers';
import { BASEMAP_COLORS, BASEMAP_THEMES, contrastRatio, relativeLuminance } from './mapTheme';
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
      'occ-airfield-taxiway-name': [['text-color', occColor('muted')], ['text-halo-color', BASEMAP_COLORS.labelHalo]],
      'occ-airfield-designator': [['text-color', occColor('text')], ['text-halo-color', BASEMAP_COLORS.labelHalo]],
    });
    expect(relativeLuminance(BASEMAP_COLORS.runway)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.apron));
    // Little hue: every colour is the blue-grey of the base map (mapColors.js) or a slate of the OCC tokens.
    const used = [...new Set(Object.values(colours).flat().map(([, colour]) => colour))];
    const known = new Set([...Object.values(BASEMAP_COLORS), ...Object.values(OCC_PALETTE)]);
    for (const colour of used) {
      expect(known.has(colour), colour).toBe(true);
      expect(chroma(colour), colour).toBeLessThan(0.2);
    }
    // The centreline is dashed; the bars are solid.
    expect(layerOf('occ-airfield-centreline').paint['line-dasharray']).toEqual([6, 5]);
    expect(layerOf('occ-airfield-hold').paint).not.toHaveProperty('line-dasharray');
    // The labels read on the pavement and the land around it.
    expect(contrastRatio(occColor('muted'), BASEMAP_COLORS.taxiway)).toBeGreaterThanOrEqual(4.5);
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
      type: 'geojson', attribution: AIRFIELD_ATTRIBUTION, maxzoom: 16, data: { type: 'FeatureCollection', features: [] },
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
    expect(AIRFIELD_LEGEND_KINDS).toEqual([
      'runway', 'taxiway', 'taxiwayPavement', 'holdBar', 'apron', 'terminal', 'building', 'jetBridge',
    ]);
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

describe('airport structures in 3D (M9)', () => {
  const withStructures = airfieldOverlay({ structures: true });
  const structureLayer = id => withStructures.layers.find(layer => layer.id === id);
  const slotOf = (style, id) => style.layers.find(layer => layer.id === id).metadata['occ:slot'];

  it('adds its own source, the pavement under the taxiway lines and the raised structures over the 3D buildings', () => {
    expect(AIRFIELD_STRUCTURE_LAYER_IDS).toEqual([
      'occ-airfield-taxiway-pavement', 'occ-airfield-building-3d', 'occ-airfield-jet-bridge', 'occ-airfield-building-label',
    ]);
    // Without the option the overlay is the one of every other map.
    expect(airfieldOverlay().layers.map(layer => layer.id)).toEqual(AIRFIELD_LAYER_IDS);
    expect(withStructures.sources).toEqual({
      [AIRFIELD_SOURCE]: { type: 'geojson', attribution: AIRFIELD_ATTRIBUTION },
      [AIRFIELD_STRUCTURES_SOURCE]: { type: 'geojson', attribution: AIRFIELD_ATTRIBUTION },
    });
    for (const theme of ['dark', 'light']) {
      for (const basemap of [true, false]) {
        const style = buildOccStyle({ basemap, theme, overlays: [withStructures] });
        expect(validateStyleMin(style), `${theme} ${basemap}`).toEqual([]);
        style.sources[AIRFIELD_SOURCE].data = airfieldFeatures(MDPC_LAYOUT);
        style.sources[AIRFIELD_STRUCTURES_SOURCE].data = structureFeatures(MDPC_LAYOUT);
        expect(validateStyleMin(style), `${theme} ${basemap} filled`).toEqual([]);
      }
    }
    const style = buildOccStyle({ overlays: [withStructures] });
    const ids = style.layers.map(layer => layer.id);
    // The pavement right after the terminals and before the taxiway lines, so lines, runways and markings stay on top.
    expect(ids.indexOf('occ-airfield-taxiway-pavement')).toBe(ids.indexOf('occ-airfield-terminal-outline') + 1);
    expect(ids.indexOf('occ-airfield-taxiway')).toBe(ids.indexOf('occ-airfield-taxiway-pavement') + 1);
    expect(slotOf(style, 'occ-airfield-taxiway-pavement')).toBe('airfield');
    // The terminals, the bridges and the labels after the tile buildings of the extrusions slot.
    const extrusions = ids.slice(ids.indexOf('slot-extrusions') + 1, ids.indexOf('slot-models'));
    expect(extrusions).toEqual(['building-3d', 'occ-airfield-building-3d', 'occ-airfield-jet-bridge', 'occ-airfield-building-label']);
    for (const id of AIRFIELD_STRUCTURE_LAYER_IDS) {
      const layer = structureLayer(id);
      expect(layer.source, id).toBe(AIRFIELD_STRUCTURES_SOURCE);
      // The terminals' names and heights wait for the zoom of the stand codes (visual review of 2026-11-27): at
      // Aeródromo they piled up over the stands.
      const from = id === 'occ-airfield-building-label' ? 'codes' : 'airfield';
      expect(layer.metadata, id).toMatchObject({ 'occ:group': AIRFIELD_GROUP, 'occ:minThreshold': from });
      expect(layer.metadata, id).not.toHaveProperty('occ:pick');
    }
  });

  it('raises each structure from its base to its height with the vertical gradient, in theme colours', () => {
    for (const id of ['occ-airfield-building-3d', 'occ-airfield-jet-bridge']) {
      expect(structureLayer(id).type).toBe('fill-extrusion');
      expect(structureLayer(id).paint, id).toMatchObject({
        'fill-extrusion-base': ['to-number', ['get', 'baseM'], 0],
        'fill-extrusion-height': ['to-number', ['get', 'heightM'], 0],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      });
    }
    for (const theme of ['dark', 'light']) {
      const style = buildOccStyle({ theme, overlays: [withStructures] });
      const paintOf = (id, property) => style.layers.find(layer => layer.id === id).paint[property];
      expect(paintOf('occ-airfield-building-3d', 'fill-extrusion-color'), theme).toBe(BASEMAP_THEMES[theme].buildingExtrusion);
      expect(paintOf('occ-airfield-jet-bridge', 'fill-extrusion-color'), theme).toBe(occColor('line-strong', theme));
      expect(paintOf('occ-airfield-taxiway-pavement', 'fill-color'), theme).toBe(BASEMAP_THEMES[theme].taxiway);
      expect(paintOf('occ-airfield-building-label', 'text-color'), theme).toBe(occColor('muted', theme));
    }
    // The bridges stand apart from the terminals they meet.
    expect(occColor('line-strong')).not.toBe(BASEMAP_COLORS.buildingExtrusion);

    // What the layers read: the terminals from the ground to their estimated height, the bridges on their supports
    // (the tunnel from about 3.5 m to 6.5 m), each one an estimate.
    const { features } = structureFeatures(MDPC_LAYOUT);
    const ofKind = kind => features.filter(feature => feature.properties.kind === kind);
    expect(ofKind('building').length).toBeGreaterThan(0);
    for (const { properties } of ofKind('building')) {
      expect(properties.baseM).toBe(0);
      expect(properties.heightM).toBeGreaterThan(properties.baseM);
      expect(properties.heightLabel).toMatch(/ m est\.$/);
      expect(typeof properties.name).toBe('string');
    }
    expect(ofKind('jetBridgeTunnel').map(feature => feature.properties.stand).sort())
      .toEqual(['B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26']);
    for (const { properties } of [...ofKind('jetBridgeTunnel'), ...ofKind('jetBridgeRotunda')]) {
      expect(properties.baseM).toBeGreaterThanOrEqual(3);
      expect(properties.baseM).toBeLessThanOrEqual(4);
      expect(properties.heightM).toBeGreaterThanOrEqual(6);
      expect(properties.heightM).toBeLessThanOrEqual(7.5);
      expect(properties.estimate).toBe(true);
    }
    // The label names the terminal over its estimated height, at the 12 px floor.
    expect(structureLayer('occ-airfield-building-label').layout).toMatchObject({
      'text-field': ['concat', ['coalesce', ['get', 'name'], ''], '\n', ['coalesce', ['get', 'heightLabel'], '']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
    });
  });

  it('draws structures only for the airport they describe', () => {
    expect(airportStructures(MDPC_LAYOUT).features.length).toBe(structureFeatures(MDPC_LAYOUT).features.length);
    // Built once per layout.
    expect(airportStructures(MDPC_LAYOUT)).toBe(airportStructures(MDPC_LAYOUT));
    const other = { ...MDPC_LAYOUT, meta: { ...MDPC_LAYOUT.meta, icao: 'MDSD' } };
    expect(airportStructures(other).features).toEqual([]);
    expect(airportStructures(null).features).toEqual([]);
  });

  it('keeps the pavement and the runway designators right up to zoom 22', () => {
    const stops = expression => Object.fromEntries(Array.from(
      { length: (expression.length - 3) / 2 }, (_, at) => [expression[3 + 2 * at], expression[4 + 2 * at]],
    ));
    // Twice as wide for each zoom step past 19.5, as the ground grows.
    for (const width of [RUNWAY_WIDTH, TAXIWAY_WIDTH]) {
      const at = stops(width);
      expect(Math.max(...Object.keys(at).map(Number))).toBe(22);
      expect(at[22] / at[19.5]).toBeCloseTo(2 ** 2.5, 2);
    }
    expect(layerOf('occ-airfield-taxiway').paint['line-width']).toEqual([...TAXIWAY_WIDTH]);
    const designator = stops(layerOf('occ-airfield-designator').layout['text-size']);
    expect(designator[22] / designator[19.5]).toBeCloseTo(2 ** 2.5, 1);
  });

  it('hides the 3D buildings of the base map from the airfield threshold, where the own structures take over', () => {
    const style = buildOccStyle({ overlays: [withStructures] });
    const tiles = style.layers.find(layer => layer.id === 'building-3d');
    expect(tiles.metadata).toMatchObject({ 'occ:group': 'buildings-3d', 'occ:maxThreshold': 'airfield' });
    const { engine, map } = startEngine(style);
    const thresholds = thresholdsFromFits({ region: 5.6, approach: 8.8, airfield: 14.6, ramp: 15.5 });
    engine.applyThresholds(thresholds);
    const ranges = Object.fromEntries(map.zoomRangeCalls.map(call => [call.id, [call.minzoom, call.maxzoom]]));
    expect(ranges['building-3d']).toEqual([13, thresholds.airfield]);
    for (const id of AIRFIELD_STRUCTURE_LAYER_IDS) {
      const from = id === 'occ-airfield-building-label' ? thresholds.codes : thresholds.airfield;
      expect(ranges[id], id).toEqual([from, 24]);
    }
  });

  it('tells the legend of the structures on screen; a raised terminal stands in for its footprint', () => {
    const drawn = (layer, kind) => ({ layer: { id: layer }, properties: { kind } });
    expect(airfieldKindsOnScreen([
      drawn('occ-airfield-jet-bridge', 'jetBridgeRotunda'), drawn('occ-airfield-building-3d', 'building'),
      drawn('occ-airfield-terminal', 'terminal'), drawn('occ-airfield-taxiway-pavement', 'taxiwayPavement'),
      drawn('occ-airfield-taxiway', 'taxiway'),
    ])).toEqual(['taxiway', 'taxiwayPavement', 'building', 'jetBridge']);
    expect(airfieldKindsOnScreen([drawn('occ-airfield-jet-bridge', 'jetBridgeTunnel')])).toEqual(['jetBridge']);
    // Without a raised terminal in sight the flat one is listed.
    expect(airfieldKindsOnScreen([drawn('occ-airfield-terminal', 'terminal')])).toEqual(['terminal']);
  });
});
