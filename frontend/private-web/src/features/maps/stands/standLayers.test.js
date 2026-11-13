import {
  Color, createPropertyExpression, featureFilter, latest, validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { thresholdsFromFits } from '../core/cameraPresets';
import { createMapEngine } from '../core/mapEngine';
import { MAP_IMAGE_IDS, MAP_IMAGE_SHAPES } from '../style/mapImages';
import { FONT_STACKS, buildOccStyle } from '../style/occStyle';
import { SELECTION_SOURCE, selectionOverlay } from '../style/selectionLayers';
import {
  STAND_LABEL_MODES, STAND_SOURCE, standAppearance, standClusterOptions, standDisplayAt, standOverlay,
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
      // The frame the layer draws has the width and the dash of the vocabulary's outline, which the legend draws too.
      const [line] = MAP_IMAGE_SHAPES[marks[state][1].image].ops;
      expect([line.lineWidth, line.dash ?? null], state).toEqual([STAND_STATES[state].outline.width, STAND_STATES[state].dash]);
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
    // The solid frames keep the widths of the vocabulary: 1 px free, 2 px while the aircraft is on the stand, 2.5 px
    // while it arrives.
    expect(['available', 'occupied', 'releasing', 'arriving'].map(state => standAppearance(state).frame.image)).toEqual([
      'stand-frame-solid', 'stand-frame-solid-2px', 'stand-frame-solid-2px', 'stand-frame-solid-2-5px',
    ]);
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
        for (const colour of JSON.stringify(layer.paint).match(/#[0-9a-f]{6}|rgb\([^)]*\)/gi) ?? []) {
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

    // Outside the console only the codes (and their keep-out), from the ramp view on, and no selected or planned layer.
    const plain = standOverlay();
    expect(plain.layers.filter(layer => layer.slot === 'standLabels').map(layer => layer.id))
      .toEqual(['occ-stands-cluster-count', 'occ-stands-codes', 'occ-stands-keep-out']);
    expect(layerOf(plain, 'occ-stands-codes').metadata['occ:minThreshold']).toBe('codes');
    // A code goes below its stand, else above or beside it: a close neighbour's code no longer hides it.
    const plainCodes = layerOf(plain, 'occ-stands-codes').layout;
    expect(plainCodes).toMatchObject({
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-allow-overlap': false, 'text-optional': true,
      'text-size': 12,
    });
    expect(plainCodes).not.toHaveProperty('text-offset');
    // The console keeps its fixed places under the stand.
    expect(codes.layout).not.toHaveProperty('text-variable-anchor');

    // On a map the engine moves those layers to the thresholds derived from the fitted zooms.
    const fake = createFakeMapLibre();
    const host = document.body.appendChild(document.createElement('div'));
    const engine = createMapEngine({ maplibre: fake.module, host, style: styleWith('dashboard') });
    engines.push(engine);
    const map = fake.state.maps.at(-1);
    fake.state.emit(map, 'style.load');
    const thresholds = thresholdsFromFits(FITS);
    engine.applyThresholds(thresholds);
    // Every layer of the stands source starts at the stand threshold; the console's codes do too.
    expect(map.zoomRangeCalls).toEqual([
      'occ-stands-clusters', ...MARK_LAYERS, 'occ-stands-cluster-count', 'occ-stands-codes', 'occ-stands-codes-planned',
    ].map(id => ({ id, minzoom: thresholds.polygons, maxzoom: 24 })));
    expect(() => standOverlay({ labels: 'wall' })).toThrow(RangeError);
  });

  it('draws the stands from the stand threshold on, grouped until the ramp view outside the console', () => {
    // FITS: stand threshold 13.6 (airfield 13.9 − 0.3), codes 15.8 (ramp 16.1 − 0.3).
    const thresholds = thresholdsFromFits(FITS);
    // Region and approach show the airport's reference point and no stand.
    expect([6.4, 9.1, 13.5].map(zoom => standDisplayAt(zoom, thresholds))).toEqual(['hidden', 'hidden', 'hidden']);
    // The airfield view gathers them: fixed-size marks a few metres apart would pile up.
    expect([13.6, 13.9, 14.99].map(zoom => standDisplayAt(zoom, thresholds))).toEqual(['grouped', 'grouped', 'grouped']);
    expect([15, 16.1, 19.5].map(zoom => standDisplayAt(zoom, thresholds))).toEqual(['points', 'points', 'points']);
    // On the console's apron they are drawn one by one as soon as they are drawn at all.
    expect([13.5, 13.6, 14].map(zoom => standDisplayAt(zoom, thresholds, { labels: 'dashboard' })))
      .toEqual(['hidden', 'points', 'points']);
    // Before the thresholds the layers have no zoom range: every stand is a point.
    expect(standDisplayAt(15, null)).toBe('points');
    expect(standDisplayAt(undefined, thresholds)).toBe('points');

    for (const labels of STAND_LABEL_MODES) {
      for (const layer of standOverlay({ labels }).layers.filter(item => item.source === STAND_SOURCE)) {
        const codes = ['occ-stands-codes', 'occ-stands-keep-out'].includes(layer.id) && labels === 'default';
        expect(layer.metadata['occ:minThreshold'], `${labels} ${layer.id}`).toBe(codes ? 'codes' : 'polygons');
      }
    }
  });

  it('outside the console keeps every code off the stand marks with an invisible copy placed before the codes', () => {
    const plain = standOverlay();
    const labelIds = plain.layers.filter(layer => layer.slot === 'standLabels').map(layer => layer.id);
    // Last in the slot: drawn last (it is invisible) and placed first, so the codes see it.
    expect(labelIds).toEqual(['occ-stands-cluster-count', 'occ-stands-codes', 'occ-stands-keep-out']);
    const keepOut = layerOf(plain, 'occ-stands-keep-out');
    const frame = layerOf(plain, 'occ-stands-frame');
    const codes = layerOf(plain, 'occ-stands-codes');
    expect(keepOut).toMatchObject({ type: 'symbol', source: STAND_SOURCE, filter: ['!', ['has', 'point_count']] });
    // Always drawn, and an obstacle for every label placed after it.
    expect(keepOut.layout).toMatchObject({
      'icon-image': 'stand-slab', 'icon-padding': 0, 'icon-allow-overlap': true, 'icon-ignore-placement': false,
    });
    expect(keepOut.paint).toEqual({ 'icon-opacity': 0 });
    // At every zoom: the keep-out is the drawn square (24 px of the 32 px slab image, at the marks' size), and a code sits
    // 7 px clear of it, its 2 px text padding included.
    const stand = { code: 'A1', status: 'available' };
    for (const zoom of [15, 15.8, 16, 16.7, 17, 18, 19.5]) {
      const square = 12 * evaluate(frame, 'layout', 'icon-size', stand, zoom);
      expect(16 * evaluate(keepOut, 'layout', 'icon-size', stand, zoom), `zoom ${zoom}`).toBeCloseTo(square, 2);
      const offset = 12 * evaluate(codes, 'layout', 'text-radial-offset', stand, zoom);
      expect(offset - square, `zoom ${zoom}`).toBeCloseTo(7, 1);
      expect(offset - 2 - square, `zoom ${zoom}`).toBeGreaterThan(4);
    }
    // Never a pick target: a click still finds the stand's frame.
    expect(keepOut.metadata).toEqual({ 'occ:group': 'stands', 'occ:minThreshold': 'codes' });
    // The marks themselves never block anything, and the console's apron has no keep-out.
    expect(frame.layout['icon-ignore-placement']).toBe(true);
    expect(standOverlay({ labels: 'dashboard' }).layers.map(layer => layer.id)).not.toContain('occ-stands-keep-out');
    expect(validateStyleMin(buildOccStyle({ overlays: [plain, selectionOverlay()] }))).toEqual([]);
  });

  it('clusters carry no hue and derive clusterMaxZoom from the fitted zooms', () => {
    for (const labels of STAND_LABEL_MODES) {
      const overlay = standOverlay({ labels });
      const clusters = layerOf(overlay, 'occ-stands-clusters');
      expect(clusters.paint).toMatchObject({ 'circle-color': occColor('panel-raised'), 'circle-stroke-color': occColor('line-strong') });
      expect(clusters.metadata).toMatchObject({ 'occ:pick': 'cluster', 'occ:pickId': 'cluster_id' });
      expect(overlay.sources[STAND_SOURCE]).toMatchObject({ type: 'geojson', promoteId: 'code', cluster: true });
    }
    expect(standOverlay().sources[STAND_SOURCE].clusterRadius).toBe(50);
    expect(standOverlay({ labels: 'dashboard' }).sources[STAND_SOURCE].clusterRadius).toBe(35);

    // Outside the console: ramp 16.1 → codes 15.8 → clusters up to zoom 14, every stand on its own from 15 on.
    const thresholds = thresholdsFromFits(FITS);
    expect(standClusterOptions(thresholds)).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
    // On the console's apron: airfield 13.9 → stand threshold 13.6 → clusters up to zoom 12.
    expect(standClusterOptions(thresholds, { labels: 'dashboard' })).toEqual({ cluster: true, clusterRadius: 35, clusterMaxZoom: 12 });
    expect(standClusterOptions(thresholdsFromFits({ ...FITS, airfield: 15.25 }), { labels: 'dashboard' }))
      .toEqual({ cluster: true, clusterRadius: 35, clusterMaxZoom: 13 });
    expect(standClusterOptions(thresholdsFromFits({ ...FITS, ramp: 1.1 })).clusterMaxZoom).toBe(1);
    expect(standClusterOptions(null)).toBeNull();
    expect(standClusterOptions({ polygons: Number.NaN, codes: 15 })).toBeNull();
    expect(standClusterOptions({ polygons: 13.6 })).toBeNull();

    // MapLibre 6.16 sets `cluster` from every call: the options keep clustering on.
    const fake = createFakeMapLibre();
    const host = document.body.appendChild(document.createElement('div'));
    const engine = createMapEngine({ maplibre: fake.module, host, style: styleWith('default') });
    engines.push(engine);
    const map = fake.state.maps.at(-1);
    fake.state.emit(map, 'style.load');
    engine.setClusterOptions(STAND_SOURCE, standClusterOptions(thresholds));
    expect(map.getSource(STAND_SOURCE).getClusterOptions()).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
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
