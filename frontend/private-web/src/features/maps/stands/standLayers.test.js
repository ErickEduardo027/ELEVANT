import {
  Color, createPropertyExpression, featureFilter, latest, validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { thresholdsFromFits } from '../core/cameraPresets';
import { createMapEngine } from '../core/mapEngine';
import { MAP_IMAGE_IDS } from '../style/mapImages';
import { FONT_STACKS, buildOccStyle } from '../style/occStyle';
import { SELECTION_SOURCE, selectionOverlay } from '../style/selectionLayers';
import {
  STAND_LABEL_MODES, STAND_SOURCE, standAppearance, standClusterOptions, standOverlay,
} from './standLayers';

const MARK_LAYERS = ['occ-stands-fill', 'occ-stands-frame', 'occ-stands-glyph', 'occ-stands-clock'];
// Fits as a 1440 px screen gives them for the reference ramp of Punta Cana.
const FITS = { region: 6.4, approach: 9.1, airfield: 13.9, ramp: 16.1 };

const styleWith = labels => buildOccStyle({ basemap: false, overlays: [selectionOverlay(), standOverlay({ labels })] });
const layerOf = (overlay, id) => overlay.layers.find(layer => layer.id === id);

// What a layer of the overlay draws for one unclustered stand, evaluated with MapLibre's own expression engine.
function evaluate(layer, kind, name, properties, zoom) {
  const spec = latest[`${kind}_${layer.type}`][name];
  const parsed = createPropertyExpression(layer[kind][name], `layers.${layer.id}.${kind}.${name}`, spec);
  if (parsed.result !== 'success') throw new Error(`${layer.id} ${name}: ${JSON.stringify(parsed.value)}`);
  return parsed.value.evaluate({ zoom }, { type: 1, properties });
}

function drawnBy(layer, status, zoom = 17) {
  const properties = { code: 'A1', status };
  if (!featureFilter(layer.filter, `layers.${layer.id}.filter`).filter({ zoom }, { type: 1, properties })) return null;
  return {
    image: evaluate(layer, 'layout', 'icon-image', properties, zoom).name,
    color: evaluate(layer, 'paint', 'icon-color', properties, zoom),
  };
}

const chroma = colour => {
  const { r, g, b } = Color.parse(colour);
  return Math.max(r, g, b) - Math.min(r, g, b);
};

const engines = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  document.body.replaceChildren();
});

describe('standOverlay', () => {
  it('every pair of stand states differs in dash, fill or glyph, never only in colour', () => {
    const overlay = standOverlay();
    const marks = Object.fromEntries(STAND_STATE_KEYS.map(state => [
      state,
      MARK_LAYERS.map(id => drawnBy(layerOf(overlay, id), state)),
    ]));
    // What the layers draw is what the vocabulary says.
    for (const state of STAND_STATE_KEYS) {
      const appearance = standAppearance(state);
      expect(marks[state].map(mark => mark?.image ?? null), state).toEqual(
        [appearance.fill, appearance.frame, appearance.glyph, appearance.badge].map(part => part?.image ?? null),
      );
      for (const [index, part] of [appearance.fill, appearance.frame, appearance.glyph, appearance.badge].entries()) {
        if (part !== null) expect(marks[state][index].color, `${state} ${MARK_LAYERS[index]}`).toEqual(Color.parse(part.color));
      }
      // Every stand has a frame, and every image exists.
      expect(marks[state][1], state).not.toBeNull();
      for (const mark of marks[state].filter(Boolean)) expect(MAP_IMAGE_IDS, state).toContain(mark.image);
    }
    const shapes = Object.fromEntries(STAND_STATE_KEYS.map(state => [state, marks[state].map(mark => mark?.image ?? 'none').join('|')]));
    for (const [index, first] of STAND_STATE_KEYS.entries()) {
      for (const second of STAND_STATE_KEYS.slice(index + 1)) {
        expect(shapes[first], `${first} and ${second} differ only in colour`).not.toBe(shapes[second]);
      }
    }
    // Today's meaning: an aircraft in a stand a visit holds, the axis of an empty stand, the clock of «Por liberar».
    expect(standAppearance('planned')).toMatchObject({ frame: { image: 'stand-frame-dash-4-3' }, glyph: { image: 'glyph-aircraft' } });
    expect(standAppearance('available')).toMatchObject({ fill: null, frame: { image: 'stand-frame-solid' }, glyph: { image: 'glyph-axis' } });
    expect(standAppearance('releasing')).toMatchObject({ fill: { image: 'stand-slab' }, badge: { image: 'glyph-clock' } });
    expect(standAppearance('disabled')).toMatchObject({ fill: { image: 'stand-hatch' }, frame: { image: 'stand-frame-dash-2-2' }, glyph: null });
    expect(standAppearance('unverified')).toMatchObject({ frame: { image: 'stand-frame-dot-1-3' }, glyph: { image: 'glyph-axis' } });
    expect(() => standAppearance('blocked')).toThrow(RangeError);
  });

  it('uses only OCC palette colours and no hue for normal states', () => {
    const palette = new Set(Object.values(OCC_PALETTE));
    const signals = new Set(['accent', 'warn', 'danger', 'accent-soft', 'warn-soft', 'danger-soft'].map(occColor));
    for (const labels of STAND_LABEL_MODES) {
      const overlay = standOverlay({ labels });
      // Every colour of every layer, inside an expression or not, is a token value.
      const colours = JSON.stringify(overlay.layers.map(layer => layer.paint ?? {}))
        .match(/#[0-9a-f]{6}|rgb\([^)]*\)/gi);
      expect(colours.length, labels).toBeGreaterThan(10);
      for (const colour of colours) expect(palette.has(colour), `${labels}: ${colour}`).toBe(true);
      // Only the selected code is cyan; no stand state, cluster or code carries a signal colour or a hue.
      for (const layer of overlay.layers.filter(item => item.id !== 'occ-stands-code-selected')) {
        for (const colour of JSON.stringify(layer.paint).match(/#[0-9a-f]{6}|rgb\([^)]*\)/gi)) {
          expect(signals.has(colour), `${layer.id}: ${colour}`).toBe(false);
          expect(chroma(colour), `${layer.id}: ${colour}`).toBeLessThan(0.1);
        }
      }
    }
    expect(layerOf(standOverlay({ labels: 'dashboard' }), 'occ-stands-code-selected').paint['text-color']).toBe(occColor('accent'));
  });

  it('dashboard labels keep planned and selected stands prioritised with derived thresholds', () => {
    const dashboard = standOverlay({ labels: 'dashboard' });
    const ids = dashboard.layers.filter(layer => layer.slot === 'standLabels').map(layer => layer.id);
    // Layers higher in the slot are placed first: the selected code, then the planned codes, then the rest.
    expect(ids).toEqual(['occ-stands-cluster-count', 'occ-stands-codes', 'occ-stands-codes-planned', 'occ-stands-code-selected']);
    const codes = layerOf(dashboard, 'occ-stands-codes');
    const planned = layerOf(dashboard, 'occ-stands-codes-planned');
    const selected = layerOf(dashboard, 'occ-stands-code-selected');
    const passes = (layer, status) => featureFilter(layer.filter, `layers.${layer.id}.filter`)
      .filter({ zoom: 15 }, { type: 1, properties: { code: 'A1', status } });
    expect([passes(codes, 'planned'), passes(planned, 'planned')]).toEqual([false, true]);
    expect([passes(codes, 'occupied'), passes(planned, 'occupied')]).toEqual([true, false]);
    expect(planned.layout).toMatchObject({ 'text-allow-overlap': true, 'text-optional': false });
    expect(codes.layout).toMatchObject({ 'text-allow-overlap': false, 'text-optional': true });
    expect([codes, planned].map(layer => layer.metadata['occ:minThreshold'])).toEqual(['polygons', 'polygons']);
    expect(selected).toMatchObject({ source: SELECTION_SOURCE, filter: ['==', ['get', 'kind'], 'stand'] });
    expect(selected.layout).toMatchObject({ 'text-field': ['get', 'id'], 'text-allow-overlap': true });
    // Codes stay at least 12 px.
    for (const layer of [codes, planned]) {
      for (const zoom of [12, 14, 15.5, 17, 19]) expect(evaluate(layer, 'layout', 'text-size', { status: 'planned' }, zoom)).toBeGreaterThanOrEqual(12);
    }

    // Outside the console only the codes, from the ramp view on, and no selected or planned layer.
    const plain = standOverlay();
    expect(plain.layers.filter(layer => layer.slot === 'standLabels').map(layer => layer.id))
      .toEqual(['occ-stands-cluster-count', 'occ-stands-codes']);
    expect(layerOf(plain, 'occ-stands-codes').metadata['occ:minThreshold']).toBe('codes');

    // On a map the engine moves those layers to the thresholds derived from the fitted zooms.
    const fake = createFakeMapLibre();
    const host = document.body.appendChild(document.createElement('div'));
    const engine = createMapEngine({ maplibre: fake.module, host, style: styleWith('dashboard') });
    engines.push(engine);
    const map = fake.state.maps.at(-1);
    fake.state.emit(map, 'style.load');
    const thresholds = thresholdsFromFits(FITS);
    engine.applyThresholds(thresholds);
    expect(map.zoomRangeCalls).toEqual([
      { id: 'occ-stands-codes', minzoom: thresholds.polygons, maxzoom: 24 },
      { id: 'occ-stands-codes-planned', minzoom: thresholds.polygons, maxzoom: 24 },
    ]);
    expect(() => standOverlay({ labels: 'wall' })).toThrow(RangeError);
  });

  it('clusters carry no hue and derive clusterMaxZoom from the fitted airfield zoom', () => {
    for (const labels of STAND_LABEL_MODES) {
      const overlay = standOverlay({ labels });
      const clusters = layerOf(overlay, 'occ-stands-clusters');
      expect(clusters.paint).toMatchObject({ 'circle-color': occColor('panel-raised'), 'circle-stroke-color': occColor('line-strong') });
      expect(clusters.metadata).toMatchObject({ 'occ:pick': 'cluster', 'occ:pickId': 'cluster_id' });
      expect(overlay.sources[STAND_SOURCE]).toMatchObject({ type: 'geojson', promoteId: 'code', cluster: true });
    }
    expect(standOverlay().sources[STAND_SOURCE].clusterRadius).toBe(50);
    expect(standOverlay({ labels: 'dashboard' }).sources[STAND_SOURCE].clusterRadius).toBe(35);

    // airfield 13.9 → stand threshold 13.6 → clusters up to zoom 12: from 13 on, every stand is drawn on its own.
    const thresholds = thresholdsFromFits(FITS);
    expect(standClusterOptions(thresholds)).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: 12 });
    expect(standClusterOptions(thresholdsFromFits({ ...FITS, airfield: 15.25 }), { labels: 'dashboard' }))
      .toEqual({ cluster: true, clusterRadius: 35, clusterMaxZoom: 13 });
    expect(standClusterOptions(thresholdsFromFits({ ...FITS, airfield: 1.1 })).clusterMaxZoom).toBe(1);
    expect(standClusterOptions(null)).toBeNull();
    expect(standClusterOptions({ polygons: Number.NaN })).toBeNull();

    // MapLibre 6.16 sets `cluster` from every call: the options keep clustering on.
    const fake = createFakeMapLibre();
    const host = document.body.appendChild(document.createElement('div'));
    const engine = createMapEngine({ maplibre: fake.module, host, style: styleWith('default') });
    engines.push(engine);
    const map = fake.state.maps.at(-1);
    fake.state.emit(map, 'style.load');
    engine.setClusterOptions(STAND_SOURCE, standClusterOptions(thresholds));
    expect(map.getSource(STAND_SOURCE).getClusterOptions()).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: 12 });
  });

  it('builds a valid style with Noto Sans only, the pick target on the frame and the marks in the stands slot', () => {
    for (const labels of STAND_LABEL_MODES) {
      const style = styleWith(labels);
      expect(validateStyleMin(style), labels).toEqual([]);
      const noto = Object.values(FONT_STACKS).map(stack => JSON.stringify(stack));
      for (const layer of style.layers.filter(item => item.layout?.['text-font'])) {
        expect(noto, layer.id).toContain(JSON.stringify(layer.layout['text-font']));
      }
      const ids = style.layers.map(layer => layer.id);
      const between = (from, to) => ids.slice(ids.indexOf(`slot-${from}`) + 1, ids.indexOf(`slot-${to}`));
      expect(between('stands', 'routes')).toEqual(['occ-stands-clusters', ...MARK_LAYERS]);
      expect(between('standLabels', 'traffic')).toEqual(standOverlay({ labels }).layers
        .filter(layer => layer.slot === 'standLabels').map(layer => layer.id));
      const picks = style.layers.filter(layer => layer.metadata?.['occ:pick']).map(layer => [layer.id, layer.metadata['occ:pick']]);
      expect(picks).toEqual([['occ-stands-clusters', 'cluster'], ['occ-stands-frame', 'stand']]);
      // The stand icons never hide a label or each other.
      for (const id of MARK_LAYERS) {
        expect(style.layers.find(layer => layer.id === id).layout, id)
          .toMatchObject({ 'icon-allow-overlap': true, 'icon-ignore-placement': true });
      }
    }
  });
});
