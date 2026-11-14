import { readFileSync } from 'node:fs';
import {
  Color, createPropertyExpression, featureFilter, latest, validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { SIGNALS, STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { thresholdsFromFits } from '../core/cameraPresets';
import { createMapEngine } from '../core/mapEngine';
import { MAP_IMAGE_SHAPES, isSdfImage } from '../style/mapImages';
import { BASEMAP_COLORS } from '../style/mapTheme';
import { FONT_STACKS, buildOccStyle } from '../style/occStyle';
import { SELECTION_SOURCE, selectionOverlay } from '../style/selectionLayers';
import { createMapStands } from '../testing/mapFixtures';
import { buildStandFeatures } from './standFeatures';
import { ghostFeatures, placingGhost } from './placing';
import {
  PLACING_PAINT, STAND_AUX_SOURCE, STAND_CHIP_LAYER, STAND_FEATURE_STATES, STAND_FILL_LAYER, STAND_GHOST_SOURCE,
  STAND_GROUP_SOURCE, STAND_LABEL_MODES, STAND_LABEL_SOURCE, STAND_SOURCE, STAND_SOURCES, standDisplayAt, standOverlay,
  standPaint,
} from './standLayers';
import { attachStandGeometry } from './standModel';

// Fits as a 1440 px screen gives them for the ramp of Punta Cana: airfield 13.9 and ramp 15.4.
const FITS = { region: 6.4, approach: 9.1, airfield: 13.9, ramp: 15.4 };
const THRESHOLDS = thresholdsFromFits(FITS);
const NOW = Date.parse('2026-11-13T15:00:00Z');

const styleWith = (labels = 'default') => buildOccStyle({ basemap: false, overlays: [selectionOverlay(), standOverlay({ labels })] });
const layerOf = (overlay, id) => overlay.layers.find(layer => layer.id === id);
const standLayers = (labels = 'default') => standOverlay({ labels }).layers;

// What a layer's property gives for a feature, evaluated with MapLibre's own expression engine.
function evaluate(layer, kind, name, properties, { zoom = 17, state = {}, type = 3 } = {}) {
  const spec = latest[`${kind}_${layer.type}`][name];
  const value = layer[kind]?.[name];
  if (value === undefined) return spec.default;
  const parsed = createPropertyExpression(value, `layers.${layer.id}.${kind}.${name}`, spec);
  if (parsed.result !== 'success') throw new Error(`${layer.id} ${name}: ${JSON.stringify(parsed.value)}`);
  return parsed.value.evaluate({ zoom }, { type, properties }, state);
}
const passes = (layer, properties, { zoom = 17, type = 3 } = {}) => layer.filter === undefined
  || featureFilter(layer.filter, `layers.${layer.id}.filter`).filter({ zoom }, { type, properties });

// The features buildStandFeatures gives a stand of each state: a stand of the screen read in that state.
function featuresFor(state) {
  const [stand] = attachStandGeometry(createMapStands().filter(item => item.id === 'A2'), MDPC_LAYOUT);
  const cancelled = { ...stand, displayStatus: state, display: { ...stand.display, state, cancelledBy: state === 'disabled' ? 'A1' : null } };
  const [canceller] = attachStandGeometry(createMapStands().filter(item => item.id === 'A1'), MDPC_LAYOUT);
  return buildStandFeatures([cancelled, canceller], { nowMs: NOW });
}

// What a state shows on the map without colour: the fill kind, the outline (its layer, so its dash, and its width), and
// the marks the label and aux layers draw for it.
function channelsOf(state) {
  const layers = standLayers();
  const features = featuresFor(state);
  const polygon = features.polygons.features.find(item => item.id === 'A2').properties;
  const label = features.labels.features.find(item => item.id === 'A2').properties;
  const leadIn = features.aux.features.find(item => item.id === 'leadIn:A2')?.properties;
  const fill = layerOf({ layers }, STAND_FILL_LAYER);
  const opacity = evaluate(fill, 'paint', 'fill-opacity', polygon);
  const colour = evaluate(fill, 'paint', 'fill-color', polygon);
  let fillKind = 'none';
  if (passes(layerOf({ layers }, 'occ-stands-hatch'), polygon)) fillKind = 'hatch';
  else if (opacity > 0) fillKind = colour.a < 1 ? 'tint' : 'solid';
  const outlines = layers.filter(layer => layer.id.startsWith('occ-stands-outline-') && passes(layer, polygon, { type: 2 }));
  const marks = ['occ-stand-glyph', 'occ-stand-clock'].filter(id => passes(layerOf({ layers }, id), label, { type: 1 }));
  if (leadIn && passes(layerOf({ layers }, 'occ-stands-leadin-arriving'), leadIn, { type: 2 })) marks.push('leadin-arriving');
  if (features.aux.features.some(item => item.properties.kind === 'combinedLink')) marks.push('combined-link');
  return {
    fillKind,
    outline: outlines.map(layer => layer.id),
    width: evaluate(outlines[0], 'paint', 'line-width', polygon),
    marks,
  };
}

const coloursIn = value => {
  if (typeof value === 'string') return /^(?:#|rgb)/i.test(value) ? [value] : [];
  return Array.isArray(value) ? value.flatMap(coloursIn) : [];
};

const engines = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  document.body.replaceChildren();
});

describe('standOverlay', () => {
  it('the style with the stand overlay passes validateStyleMin', () => {
    for (const labels of STAND_LABEL_MODES) {
      expect(validateStyleMin(styleWith(labels)), labels).toEqual([]);
      expect(validateStyleMin(buildOccStyle({ overlays: [selectionOverlay(), standOverlay({ labels })] })), labels).toEqual([]);
    }
    // Four sources, each keyed by the property its collection promotes, and no cluster any more; and the boxes of
    // «Ubicar en el mapa».
    expect(standOverlay().sources).toEqual({
      [STAND_SOURCE]: { type: 'geojson', promoteId: 'code' },
      [STAND_AUX_SOURCE]: { type: 'geojson', promoteId: 'id' },
      [STAND_LABEL_SOURCE]: { type: 'geojson', promoteId: 'code' },
      [STAND_GROUP_SOURCE]: { type: 'geojson', promoteId: 'terminal' },
      [STAND_GHOST_SOURCE]: { type: 'geojson', promoteId: 'id' },
    });
    expect(STAND_SOURCES).toEqual({ polygons: STAND_SOURCE, aux: STAND_AUX_SOURCE, labels: STAND_LABEL_SOURCE, groups: STAND_GROUP_SOURCE });
    // The stands slot holds the polygons and their lines; the labels slot the chips, marks, labels and signals.
    const style = styleWith();
    const ids = style.layers.map(layer => layer.id);
    const between = (from, to) => ids.slice(ids.indexOf(`slot-${from}`) + 1, ids.indexOf(`slot-${to}`));
    expect(between('stands', 'routes')).toEqual([
      'occ-stands-fill', 'occ-stands-hatch', 'occ-stands-outline-solid', 'occ-stands-outline-dash-4-3',
      'occ-stands-outline-dash-2-2', 'occ-stands-outline-dot-1-3', 'occ-stands-leadin', 'occ-stands-leadin-arriving',
      'occ-stands-combined-link', 'occ-stands-narrow-inner', 'occ-stands-selection', 'occ-stands-related',
      'occ-stands-same-agent',
    ]);
    expect(between('standLabels', 'traffic')).toEqual([
      'occ-stand-groups', 'occ-stand-groups-arriving', 'occ-stand-glyph', 'occ-stand-clock', 'occ-stand-labels',
      'occ-stand-labels-3', 'occ-stand-label-selected', 'occ-stand-label-selected-3', 'occ-stand-signal',
    ]);
    // A stand is picked by its polygon, a terminal by its chip.
    const picks = style.layers.filter(layer => layer.metadata?.['occ:pick']).map(layer => [layer.id, layer.metadata['occ:pick'], layer.metadata['occ:pickId']]);
    expect(picks).toEqual([[STAND_FILL_LAYER, 'stand', 'code'], [STAND_CHIP_LAYER, 'terminal', 'terminal']]);
    // Every image a layer names exists: icons as SDF images, the hatch as a painted pattern in the hatch's token.
    for (const layer of style.layers.filter(item => item.metadata['occ:group'] === 'stands')) {
      const icon = layer.layout?.['icon-image'];
      for (const id of icon === undefined ? [] : JSON.stringify(icon).match(/"(?:stand|glyph|signal)-[a-z-]+"/g).map(text => JSON.parse(text))) {
        expect(isSdfImage(id), `${layer.id}: ${id}`).toBe(true);
      }
    }
    expect(layerOf(standOverlay(), 'occ-stands-hatch').paint['fill-pattern']).toBe('stand-hatch-pattern');
    expect(isSdfImage('stand-hatch-pattern')).toBe(false);
    expect(MAP_IMAGE_SHAPES['stand-hatch-pattern'].color).toBe(occColor(STAND_STATES.disabled.fill.token));
    expect(() => standOverlay({ labels: 'wall' })).toThrow(RangeError);
  });

  it('stand layers start only from their derived thresholds: chips from airfield up to polygons, polygons from airfieldFit − 0.3, codes, flight labels and lead-ins from rampFit − 0.3, three-line labels from rampFit + 0.8', () => {
    expect(THRESHOLDS).toMatchObject({ polygons: FITS.airfield - 0.3, codes: FITS.ramp - 0.3, threeLine: FITS.ramp + 0.8 });
    for (const labels of STAND_LABEL_MODES) {
      // No layer carries a zoom of its own: the engine gives every range from the thresholds of the screen.
      for (const layer of standLayers(labels)) {
        expect(layer, layer.id).not.toHaveProperty('minzoom');
        expect(layer, layer.id).not.toHaveProperty('maxzoom');
      }
      const fake = createFakeMapLibre();
      const host = document.body.appendChild(document.createElement('div'));
      const engine = createMapEngine({ maplibre: fake.module, host, style: styleWith(labels) });
      engines.push(engine);
      const map = fake.state.maps.at(-1);
      fake.state.emit(map, 'style.load');
      engine.applyThresholds(THRESHOLDS);
      const ranges = Object.fromEntries(map.zoomRangeCalls.map(call => [call.id, [call.minzoom, call.maxzoom]]));
      const { airfield, polygons, codes, threeLine } = THRESHOLDS;
      const codesFrom = labels === 'dashboard' ? polygons : codes;
      expect(ranges, labels).toEqual({
        'occ-stands-fill': [polygons, 24], 'occ-stands-hatch': [polygons, 24],
        'occ-stands-outline-solid': [polygons, 24], 'occ-stands-outline-dash-4-3': [polygons, 24],
        'occ-stands-outline-dash-2-2': [polygons, 24], 'occ-stands-outline-dot-1-3': [polygons, 24],
        'occ-stands-leadin': [codes, 24], 'occ-stands-leadin-arriving': [polygons, 24],
        'occ-stands-combined-link': [polygons, 24], 'occ-stands-narrow-inner': [codes, 24],
        'occ-stands-selection': [polygons, 24], 'occ-stands-related': [polygons, 24], 'occ-stands-same-agent': [polygons, 24],
        'occ-stand-groups': [airfield, polygons], 'occ-stand-groups-arriving': [airfield, polygons],
        'occ-stand-glyph': [polygons, 24], 'occ-stand-clock': [polygons, 24],
        'occ-stand-labels': [codesFrom, threeLine], 'occ-stand-labels-3': [threeLine, 24],
        'occ-stand-label-selected': [polygons, threeLine], 'occ-stand-label-selected-3': [threeLine, 24],
        'occ-stand-signal': [polygons, 24],
      });
    }
  });

  it('standDisplayAt: nothing below the airfield threshold, chips up to the polygons, polygons from there', () => {
    expect([6.4, 9.1, 11.4].map(zoom => standDisplayAt(zoom, THRESHOLDS))).toEqual(['hidden', 'hidden', 'hidden']);
    expect([THRESHOLDS.airfield, 13, FITS.airfield - 0.6].map(zoom => standDisplayAt(zoom, THRESHOLDS))).toEqual(['chips', 'chips', 'chips']);
    expect([THRESHOLDS.polygons, FITS.airfield, FITS.ramp, 19.5].map(zoom => standDisplayAt(zoom, THRESHOLDS)))
      .toEqual(['polygons', 'polygons', 'polygons', 'polygons']);
    // Before the thresholds the layers have no zoom range: the polygons are drawn. Without an airfield of its own a map
    // has no chip range either.
    expect(standDisplayAt(15, null)).toBe('polygons');
    expect(standDisplayAt(undefined, THRESHOLDS)).toBe('polygons');
    expect(standDisplayAt(12, { polygons: 13.6 })).toBe('hidden');
  });

  it('every pair of states differs in a channel that is not colour (dash, outline width, fill kind, glyph or extra mark)', () => {
    const channels = Object.fromEntries(STAND_STATE_KEYS.map(state => [state, channelsOf(state)]));
    // What the layers draw is what the vocabulary says.
    for (const state of STAND_STATE_KEYS) {
      const { fill, outline } = STAND_STATES[state];
      expect(channels[state].fillKind, state).toBe(fill.kind);
      expect(channels[state].width, state).toBe(outline.width);
      expect(channels[state].outline, state).toEqual([standPaint(state).outline.layer]);
    }
    expect(channels.occupied.marks).toEqual(['occ-stand-glyph']);
    expect(channels.releasing.marks).toEqual(['occ-stand-glyph', 'occ-stand-clock']);
    expect(channels.arriving.marks).toEqual(['leadin-arriving']);
    expect(channels.disabled.marks).toEqual(['combined-link']);
    const signature = state => JSON.stringify(channels[state]);
    for (const [index, first] of STAND_STATE_KEYS.entries()) {
      for (const second of STAND_STATE_KEYS.slice(index + 1)) {
        expect(signature(first), `${first} and ${second} differ only in colour`).not.toBe(signature(second));
      }
    }
    expect(() => standPaint('blocked')).toThrow(RangeError);
  });

  it('one outline layer per dash style of the vocabulary, with a constant line-dasharray in line widths', () => {
    const outlines = standLayers().filter(layer => layer.id.startsWith('occ-stands-outline-'));
    const dashes = [...new Set(STAND_STATE_KEYS.map(state => JSON.stringify(STAND_STATES[state].dash)))];
    expect(outlines).toHaveLength(dashes.length);
    for (const layer of outlines) {
      const states = STAND_STATE_KEYS.filter(state => passes(layer, { state }, { type: 2 }));
      const [dash] = new Set(states.map(state => STAND_STATES[state].dash));
      // One dash per layer, written as a constant (Decision D-1: never a data-driven dash).
      expect(new Set(states.map(state => JSON.stringify(STAND_STATES[state].dash))).size, layer.id).toBe(1);
      if (dash === null) {
        expect(layer.paint, layer.id).not.toHaveProperty('line-dasharray');
        continue;
      }
      const dasharray = layer.paint['line-dasharray'];
      expect(dasharray.every(Number.isFinite), layer.id).toBe(true);
      // MapLibre counts a dash in line widths: back in pixels it is the vocabulary's.
      for (const state of states) {
        const width = evaluate(layer, 'paint', 'line-width', { state });
        expect(dasharray.map(length => Math.round(length * width * 1000) / 1000), `${layer.id} ${state}`).toEqual(dash);
      }
    }
  });

  it('colours come from STAND_STATES and occColor; no base-map colour and no hard-coded hex', () => {
    const palette = new Set(Object.values(OCC_PALETTE));
    const basemap = new Set(Object.values(BASEMAP_COLORS));
    for (const labels of STAND_LABEL_MODES) {
      const colours = standLayers(labels).flatMap(layer => coloursIn(Object.values(layer.paint ?? {})));
      expect(colours.length, labels).toBeGreaterThan(20);
      for (const colour of colours) {
        expect(palette.has(colour), `${labels}: ${colour}`).toBe(true);
        expect(basemap.has(colour), `${labels}: ${colour}`).toBe(false);
      }
    }
    // Each state's fill and outline are the tokens of the vocabulary.
    const layers = standLayers();
    for (const state of STAND_STATE_KEYS) {
      const { fill, outline } = STAND_STATES[state];
      const outlineLayer = layers.find(layer => layer.id === standPaint(state).outline.layer);
      expect(evaluate(outlineLayer, 'paint', 'line-color', { state }), state).toEqual(Color.parse(occColor(outline.token)));
      if (fill.kind === 'tint' || fill.kind === 'solid') {
        expect(evaluate(layerOf({ layers }, STAND_FILL_LAYER), 'paint', 'fill-color', { state }), state).toEqual(Color.parse(occColor(fill.token)));
      }
    }
    // Normal states carry no hue: cyan only in the selection and in what can be acted on (the boxes of a stand being
    // placed), amber and red only in the signals.
    const hues = new Set(['accent', 'warn', 'danger'].map(occColor));
    const withHue = layers.filter(layer => coloursIn(Object.values(layer.paint ?? {})).some(colour => hues.has(colour))).map(layer => layer.id);
    expect(withHue).toEqual([
      'occ-stands-selection', 'occ-stands-related', 'occ-stand-label-selected', 'occ-stand-label-selected-3', 'occ-stand-signal',
      'occ-stand-ghost-fill', 'occ-stand-ghost-pending', 'occ-stand-ghost-outline', 'occ-stand-ghost-snapped',
      'occ-stand-ghost-centre',
    ]);
    const signal = layerOf({ layers }, 'occ-stand-signal');
    expect(evaluate(signal, 'paint', 'icon-color', { signal: 'attention' })).toEqual(Color.parse(occColor(SIGNALS.attention.colorToken)));
    expect(evaluate(signal, 'paint', 'icon-color', { signal: 'urgent' })).toEqual(Color.parse(occColor(SIGNALS.urgent.colorToken)));
    expect(evaluate(signal, 'layout', 'icon-image', { signal: 'urgent' }).name).toBe('signal-urgent');
    expect(evaluate(signal, 'layout', 'icon-image', { signal: 'attention' }).name).toBe('signal-attention');
    // The module writes no colour of its own.
    const source = readFileSync('src/features/maps/stands/standLayers.js', 'utf8');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(source).not.toMatch(/mapTheme|BASEMAP_COLORS/);
  });

  it('only Noto Sans and text of 12 px or more', () => {
    const noto = Object.values(FONT_STACKS).map(stack => JSON.stringify(stack));
    for (const labels of STAND_LABEL_MODES) {
      const texts = standLayers(labels).filter(layer => layer.layout?.['text-field'] !== undefined);
      expect(texts.map(layer => layer.id)).toEqual([
        'occ-stand-groups', 'occ-stand-labels', 'occ-stand-labels-3', 'occ-stand-label-selected', 'occ-stand-label-selected-3',
      ]);
      for (const layer of texts) {
        expect(noto, layer.id).toContain(JSON.stringify(layer.layout['text-font']));
        for (const zoom of [11, 13.6, 15.1, 16.2, 19.5]) {
          expect(evaluate(layer, 'layout', 'text-size', { state: 'planned' }, { zoom, type: 1 }), `${layer.id} ${zoom}`).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  it('symbol-sort-key places disabled and arriving before occupied, planned and available', () => {
    const labels = standLayers().filter(layer => layer.id === 'occ-stand-labels' || layer.id === 'occ-stand-labels-3');
    for (const layer of labels) expect(layer.layout['symbol-sort-key'], layer.id).toEqual(['get', 'sortKey']);
    // MapLibre places the lower key first.
    const keyOf = state => featuresFor(state).labels.features.find(item => item.id === 'A2').properties.sortKey;
    const keys = Object.fromEntries(STAND_STATE_KEYS.map(state => [state, keyOf(state)]));
    expect(keys.disabled).toBe(keys.arriving);
    expect(keys.arriving).toBeLessThan(keys.occupied);
    expect(keys.occupied).toBe(keys.releasing);
    expect(keys.occupied).toBeLessThan(keys.planned);
    expect(keys.planned).toBeLessThan(keys.available);
    expect(keys.available).toBeLessThan(keys.unverified);
    // The selected stand's label is above every other label, so MapLibre places it before them all; the same stand's
    // label below it gives way, and its texts come from the selection source.
    const ids = standLayers().map(layer => layer.id);
    for (const id of ['occ-stand-label-selected', 'occ-stand-label-selected-3']) {
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('occ-stand-labels-3'));
      expect(layerOf(standOverlay(), id)).toMatchObject({ source: SELECTION_SOURCE, filter: ['==', ['get', 'kind'], 'stand'] });
      expect(layerOf(standOverlay(), id).layout['text-allow-overlap']).toBe(true);
    }
    // A label moves above or below its stand's centre when its neighbours leave no room; the selected one stays in the
    // middle and clears the room around it, so the same stand's label never shows beside it.
    for (const id of ['occ-stand-labels', 'occ-stand-labels-3']) {
      expect(layerOf(standOverlay(), id).layout, id).toMatchObject({ 'text-variable-anchor': ['center', 'bottom', 'top'], 'text-radial-offset': 1.2 });
    }
    for (const id of ['occ-stand-label-selected', 'occ-stand-label-selected-3']) {
      expect(layerOf(standOverlay(), id).layout, id).toMatchObject({ 'text-anchor': 'center', 'text-padding': 44 });
      expect(layerOf(standOverlay(), id).layout, id).not.toHaveProperty('text-variable-anchor');
    }
    // The label shows the code of a free stand and the code with its flight otherwise.
    const label = layerOf(standOverlay(), 'occ-stand-labels');
    expect(evaluate(label, 'layout', 'text-field', { state: 'available', label1: 'A1', label2: 'A1\nX' }, { type: 1 }).toString()).toBe('A1');
    expect(evaluate(label, 'layout', 'text-field', { state: 'planned', label1: 'A2', label2: 'A2\nDM201' }, { type: 1 }).toString()).toBe('A2\nDM201');
  });

  it('the signal sits above the stand and the clock below it, clear of the label in the middle, and the aircraft grows with the map', () => {
    const layers = standLayers();
    const offset = (id, zoom) => evaluate(layerOf({ layers }, id), 'layout', 'icon-offset', { signal: 'attention', clock: true }, { zoom, type: 1 });
    // On the stand's axis on screen: the signal above (a negative y), the clock as far below.
    for (const zoom of [14, 15.5, 16, 17, 18.5, 20]) {
      expect(offset('occ-stand-signal', zoom)[0], `signal x at ${zoom}`).toBe(0);
      expect(offset('occ-stand-signal', zoom)[1], `signal y at ${zoom}`).toBeLessThan(0);
      expect(offset('occ-stand-clock', zoom), `clock at ${zoom}`).toEqual([0, -offset('occ-stand-signal', zoom)[1]]);
    }
    // Clear of the label in the middle of the box: the 20 px image (10 px to its edge) ends past a two-line label from
    // the codes on, and past a four-line one from the three lines on (12 px lines at a line height of 1.15).
    const label = layerOf({ layers }, 'occ-stand-labels');
    const line = label.layout['text-size'] * label.layout['text-line-height'];
    const clears = (zoom, lines) => Math.abs(offset('occ-stand-signal', zoom)[1]) - 10 >= (lines * line) / 2;
    for (const zoom of [15.5, 16, 16.5]) expect(clears(zoom, 2), `two lines at ${zoom}`).toBe(true);
    for (const zoom of [17, 17.5, 18, 19, 20]) expect(clears(zoom, 4), `four lines at ${zoom}`).toBe(true);
    // Past the stand's edge as the stand grows on screen (about 13 px from its centre at zoom 16, twice as far for each
    // zoom step), and close to the small box below 15, where no label shows.
    for (const zoom of [16, 17, 18, 19, 20]) {
      expect(Math.abs(offset('occ-stand-signal', zoom)[1]), `past the edge at ${zoom}`).toBeGreaterThan(13 * 2 ** (zoom - 16) + 9);
    }
    expect(Math.abs(offset('occ-stand-signal', 14)[1])).toBeLessThanOrEqual(8);
    // Always drawn, and the labels give way to them instead of running under them: MapLibre places the upper layers
    // first, and the signal is above every label of the stands.
    for (const id of ['occ-stand-signal', 'occ-stand-clock']) {
      expect(layerOf({ layers }, id).layout, id).toMatchObject({ 'icon-allow-overlap': true, 'icon-ignore-placement': false, 'icon-padding': 0 });
    }
    const ids = layers.map(layer => layer.id);
    expect(ids.indexOf('occ-stand-signal')).toBeGreaterThan(ids.indexOf('occ-stand-labels-3'));
    const glyph = zoom => evaluate(layerOf({ layers }, 'occ-stand-glyph'), 'layout', 'icon-size', { glyph: 'aircraft' }, { zoom, type: 1 });
    expect(glyph(17) / glyph(16)).toBeCloseTo(2, 3);
    // The aircraft is never drawn at a fixed screen size and turns with the stand.
    expect(layerOf({ layers }, 'occ-stand-glyph').layout).toMatchObject({
      'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
    });
  });

  it('hover, selected, related and same-agent are feature-state expressions', () => {
    expect(STAND_FEATURE_STATES).toEqual(['hover', 'selected', 'related', 'sameAgent']);
    const layers = standLayers();
    const opacity = (id, state) => evaluate(layerOf({ layers }, id), 'paint', 'line-opacity', { state: 'planned' }, { state, type: 2 });
    expect([{}, { hover: true }, { selected: true }, { selected: true, hover: true }].map(state => opacity('occ-stands-selection', state)))
      .toEqual([0, 0.55, 1, 1]);
    expect([{}, { related: true }, { related: true, selected: true }].map(state => opacity('occ-stands-related', state))).toEqual([0, 1, 0]);
    expect([{}, { sameAgent: true }].map(state => opacity('occ-stands-same-agent', state))).toEqual([0, 1]);
    // Read from the feature state, never from the data: no source is rewritten for them, and no filter names them.
    for (const layer of layers) {
      const text = JSON.stringify(layer);
      const keys = [...text.matchAll(/"feature-state","(\w+)"/g)].map(match => match[1]);
      expect(keys.every(key => STAND_FEATURE_STATES.includes(key)), layer.id).toBe(true);
      expect(JSON.stringify(layer.filter ?? null), layer.id).not.toMatch(/feature-state/);
      for (const key of STAND_FEATURE_STATES) expect(text, layer.id).not.toMatch(new RegExp(`\\["get","${key}"\\]`));
    }
    expect(layers.filter(layer => JSON.stringify(layer).includes('feature-state')).map(layer => layer.id))
      .toEqual(['occ-stands-selection', 'occ-stands-related', 'occ-stands-same-agent']);
    // The casings hug every outline: as wide as it, plus their clearance.
    for (const state of STAND_STATE_KEYS) {
      const gap = evaluate(layerOf({ layers }, 'occ-stands-selection'), 'paint', 'line-gap-width', { state }, { type: 2 });
      expect(gap, state).toBe(STAND_STATES[state].outline.width + 1);
    }
  });

  it('placing layers: the box at the pointer is dashed until it snaps, the pending location solid over a wash, in the top slot at every zoom', () => {
    const style = styleWith();
    const ids = style.layers.map(layer => layer.id);
    expect(ids.slice(ids.indexOf('slot-selection') + 1)).toEqual([
      'occ-selection-ring', 'occ-stand-ghost-fill', 'occ-stand-ghost-pending', 'occ-stand-ghost-outline',
      'occ-stand-ghost-snapped', 'occ-stand-ghost-centre',
    ]);
    const layers = standLayers().filter(layer => layer.source === STAND_GHOST_SOURCE);
    // At every zoom: a stand may be placed from the airfield view; no threshold and no fixed zoom.
    for (const layer of layers) {
      expect(layer.metadata, layer.id).toEqual({ 'occ:group': 'stands' });
      expect(layer, layer.id).not.toHaveProperty('minzoom');
    }
    // The features of a real ghost and a pending location (a stand of the layout, read from the dataset).
    const center = MDPC_LAYOUT.stands.find(stand => stand.code === 'B27').center;
    const away = [center[0] + 0.0004, center[1]];
    const features = ghostFeatures({
      ghost: placingGhost({ code: 'B27', pointer: away, layout: MDPC_LAYOUT }),
      pending: placingGhost({ code: 'B27', pointer: center, layout: MDPC_LAYOUT }),
    }).features;
    const drawnBy = id => features.filter(item => passes(layerOf({ layers }, id), item.properties, {
      type: item.geometry.type === 'Point' ? 1 : 3,
    })).map(item => item.id);
    expect(drawnBy('occ-stand-ghost-outline')).toEqual(['ghost']);
    expect(drawnBy('occ-stand-ghost-snapped')).toEqual([]);
    expect(drawnBy('occ-stand-ghost-fill')).toEqual(['pending']);
    expect(drawnBy('occ-stand-ghost-pending')).toEqual(['pending']);
    expect(drawnBy('occ-stand-ghost-centre')).toEqual(['pending-centre']);
    // The same box snapped to the stand's outline is drawn solid instead.
    const snapped = { kind: 'ghost', snapped: true };
    expect(passes(layerOf({ layers }, 'occ-stand-ghost-snapped'), snapped)).toBe(true);
    expect(passes(layerOf({ layers }, 'occ-stand-ghost-outline'), snapped)).toBe(false);
    // Cyan, the colour of what can be acted on; the dash in line widths; the pending outline wider than the ghost's.
    const { ghost, pending } = PLACING_PAINT;
    const paintOf = (id, name) => evaluate(layerOf({ layers }, id), 'paint', name, { kind: 'ghost' }, { type: 2 });
    expect(paintOf('occ-stand-ghost-outline', 'line-color')).toEqual(Color.parse(occColor('accent')));
    expect(layerOf({ layers }, 'occ-stand-ghost-outline').paint['line-dasharray']).toEqual(ghost.dash.map(length => length / ghost.width));
    expect([paintOf('occ-stand-ghost-outline', 'line-width'), paintOf('occ-stand-ghost-pending', 'line-width')])
      .toEqual([ghost.width, pending.width]);
    expect(layerOf({ layers }, 'occ-stand-ghost-fill').paint['fill-opacity']).toBe(pending.fillOpacity);
    expect(validateStyleMin(style)).toEqual([]);
  });

  it('never imports the dataset (source text guard)', () => {
    expect(readFileSync('src/features/maps/stands/standLayers.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
