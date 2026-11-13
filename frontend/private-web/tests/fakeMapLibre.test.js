import { describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, SERVED_WORKER_URL, createFakeMapLibre, sharedFakeMapLibre } from './fakeMapLibre';

const STYLE = {
  version: 8,
  sources: { points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true } },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#1a2125' } },
    { id: 'dots', type: 'circle', source: 'points', layout: { visibility: 'visible' } },
  ],
};

function newMap(fake = createFakeMapLibre()) {
  fake.module.setWorkerUrl(SERVED_WORKER_URL);
  const container = document.createElement('div');
  const map = new fake.module.Map({ container, style: STYLE, center: [-68.3634, 18.5674], zoom: 15, maxZoom: 19.5 });
  return { fake, map, container };
}

describe('fake MapLibre', () => {
  it('the fake Map throws until the worker URL is set and records sources, layers, camera calls and controls', () => {
    const fake = createFakeMapLibre();
    const container = document.createElement('div');
    expect(() => new fake.module.Map({ container, style: STYLE })).toThrow(/worker URL/);
    expect(fake.state.maps).toHaveLength(0);

    const { map, container: mapContainer } = newMap(fake);
    expect(map.getContainer()).toBe(mapContainer);
    expect(mapContainer.querySelector('canvas.maplibregl-canvas')).not.toBeNull();
    expect(map.getSource('points')).toBeUndefined();

    fake.state.emit(map, 'style.load');
    expect(map.layerIds()).toEqual(['land', 'dots']);
    map.getSource('points').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 1 }] });
    map.setLayoutProperty('dots', 'visibility', 'none');
    map.setLayerZoomRange('dots', 15, 24);
    map.setFeatureState({ source: 'points', id: 1 }, { selected: true });
    map.addLayer({ id: 'top', type: 'background' }, 'dots');
    expect(map.layerIds()).toEqual(['land', 'top', 'dots']);
    expect(map.getSource('points').setDataCalls).toHaveLength(1);
    expect(map.layoutCalls).toEqual([{ id: 'dots', name: 'visibility', value: 'none' }]);
    expect(map.getLayer('dots')).toMatchObject({ minzoom: 15, maxzoom: 24 });
    expect(map.featureStateOf('points', 1)).toEqual({ selected: true });

    const nav = new fake.module.NavigationControl({ visualizePitch: true });
    const scale = new fake.module.ScaleControl({ unit: 'nautical' });
    map.addControl(nav, 'top-right').addControl(scale, 'bottom-right');
    expect(map.controls).toEqual([{ control: nav, position: 'top-right' }, { control: scale, position: 'bottom-right' }]);
    expect(scale.options).toEqual({ unit: 'nautical' });

    map.flyTo({ center: [-68.36, 18.57], zoom: 17, duration: 800 });
    map.fitBounds([[-68.4, 18.55], [-68.33, 18.59]], { padding: 20, duration: 0 });
    expect(map.cameraCalls.map(call => call.method)).toEqual(['flyTo', 'fitBounds']);
    // cameraForBounds is deterministic: the width of the bounds against the fake width of 1440 px (less the padding).
    const expected = Math.log2((1440 - 40) / ((512 * 0.07) / 360));
    expect(map.getZoom()).toBeCloseTo(expected, 6);
    map.setStyle({ version: 8, sources: {}, layers: [] });
    expect(map.styleCalls).toHaveLength(1);
  });

  it('getBounds is the viewport around the centre; resize changes it and fires the events of Map.resize()', () => {
    const { fake, map } = newMap();
    const bounds = map.getBounds();
    expect((bounds.getWest() + bounds.getEast()) / 2).toBeCloseTo(-68.3634, 9);
    // The corners project onto the edges of the 1440 × 900 viewport.
    expect(map.project([bounds.getWest(), 18.5674]).x).toBeCloseTo(0, 6);
    expect(map.project([bounds.getEast(), 18.5674]).x).toBeCloseTo(1440, 6);
    expect(map.project([-68.3634, bounds.getNorth()]).y).toBeCloseTo(0, 6);
    expect(map.project([-68.3634, bounds.getSouth()]).y).toBeCloseTo(900, 6);

    const events = [];
    for (const type of ['movestart', 'resize', 'moveend']) map.on(type, () => events.push(type));
    fake.state.resize(map, { width: 720 });
    expect(events).toEqual(['movestart', 'resize', 'moveend']);
    expect(map.project([map.getBounds().getEast(), 18.5674]).x).toBeCloseTo(720, 6);
    expect(map.cameraForBounds([[-68.4, 18.55], [-68.33, 18.59]]).zoom).toBeCloseTo(Math.log2(720 / ((512 * 0.07) / 360)), 6);
    // A reset brings the viewport back for the next test.
    fake.state.reset();
    expect(fake.state.size).toEqual({ width: 1440, height: 900 });
  });

  it('cameraForBounds counts the map padding unless absolutePadding, and answers nothing without room, like MapLibre', () => {
    const { fake, map } = newMap();
    const bounds = [[-68.4, 18.55], [-68.33, 18.59]];
    const zoomFor = width => Math.log2(width / ((512 * 0.07) / 360));
    map.setPadding({ top: 0, right: 300, bottom: 0, left: 100 });
    // The fit padding comes on top of the map's own padding...
    expect(map.cameraForBounds(bounds, { padding: 20 }).zoom).toBeCloseTo(zoomFor(1440 - 400 - 40), 6);
    expect(map.cameraForBounds(bounds, { padding: 20 })).not.toHaveProperty('padding');
    // ...or replaces it, and the answer carries the padding the camera will have.
    const absolute = map.cameraForBounds(bounds, { padding: { left: 50, right: 50 }, absolutePadding: true });
    expect(absolute.zoom).toBeCloseTo(zoomFor(1440 - 100), 6);
    expect(absolute.padding).toEqual({ top: 0, right: 50, bottom: 0, left: 50 });
    map.fitBounds(bounds, { padding: { left: 50, right: 50 }, absolutePadding: true });
    expect(map.getPadding()).toEqual({ top: 0, right: 50, bottom: 0, left: 50 });

    // A viewport without a size: an infinite zoom out with exactly no room, nothing (and no move) with less.
    fake.state.resize(map, { width: 0 });
    expect(map.cameraForBounds(bounds, { absolutePadding: true }).zoom).toBe(-Infinity);
    expect(map.cameraForBounds(bounds, { padding: 10, absolutePadding: true })).toBeUndefined();
    const moves = map.cameraCalls.length;
    expect(map.fitBounds(bounds, { padding: 10 })).toBe(map);
    expect(map.cameraCalls).toHaveLength(moves);
    fake.state.reset();
  });

  it('getClusterExpansionZoom returns a promise like MapLibre 6', async () => {
    const { fake, map } = newMap(createFakeMapLibre({ expansionZoom: 15.5 }));
    fake.state.emit(map, 'style.load');
    const answer = map.getSource('points').getClusterExpansionZoom(7);
    expect(answer).toBeInstanceOf(Promise);
    await expect(answer).resolves.toBe(15.5);
    expect(map.getSource('points').expansionZoomCalls).toEqual([7]);
  });

  it('setClusterOptions takes cluster from every call and rounds the maximum zoom, like MapLibre 6.16', async () => {
    const { fake, map } = newMap();
    fake.state.emit(map, 'style.load');
    const source = map.getSource('points');
    expect(source.getClusterOptions()).toMatchObject({ cluster: true });
    await expect(source.setClusterOptions({ cluster: true, clusterMaxZoom: 12.4, clusterRadius: 35 })).resolves.toBeUndefined();
    expect(source.getClusterOptions()).toEqual({ cluster: true, clusterMaxZoom: 12, clusterRadius: 35 });
    // Without `cluster` MapLibre switches clustering off; radius and zoom stay as they were.
    source.setClusterOptions({ clusterMaxZoom: 13 });
    expect(source.getClusterOptions()).toEqual({ cluster: undefined, clusterMaxZoom: 13, clusterRadius: 35 });
    expect(source.clusterOptionCalls).toEqual([{ cluster: true, clusterMaxZoom: 12.4, clusterRadius: 35 }, { clusterMaxZoom: 13 }]);
  });

  it('once listens a single time and off removes a once listener by the function given, like MapLibre', () => {
    const { map } = newMap();
    const first = vi.fn();
    const second = vi.fn();
    map.once('idle', first);
    map.once('idle', second);
    map.off('idle', second);
    expect(map.listenerCount('idle')).toBe(1);
    map._fire('idle');
    map._fire('idle');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(map.listenerCount('idle')).toBe(0);
  });

  it('refuses layer-scoped listeners, early style calls, plain-object query points and missing query layers', () => {
    const { fake, map } = newMap();
    expect(() => map.on('click', 'dots', () => {})).toThrow(/layer-scoped/);
    expect(() => map.setLayoutProperty('dots', 'visibility', 'none')).toThrow('Style is not done loading.');
    expect(() => map.addLayer({ id: 'x', type: 'background' })).toThrow('Style is not done loading.');
    fake.state.emit(map, 'style.load');
    expect(() => map.queryRenderedFeatures({ x: 1, y: 2 })).toThrow(/plain object/);
    expect(() => map.queryRenderedFeatures([1, 2], { layers: ['nope'] })).toThrow(/does not exist/);
    expect(() => map.addLayer({ id: 'x', type: 'background' }, 'nope')).toThrow(/non-existing layer/);
    fake.state.setRenderedFeatures(map, (geometry, options) => [{ id: 3, layer: { id: options.layers[0] } }]);
    expect(map.queryRenderedFeatures([1, 2], { layers: ['dots'] })).toEqual([{ id: 3, layer: { id: 'dots' } }]);
  });

  it('a context loss keeps layers and data but drops custom layers and feature state until the style reloads', () => {
    const { fake, map } = newMap();
    fake.state.emit(map, 'style.load');
    const custom = { id: 'models', type: 'custom', render() {} };
    map.addLayer(custom);
    map.getSource('points').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 9 }] });
    map.setFeatureState({ source: 'points', id: 9 }, { hover: true });
    map.setLayoutProperty('dots', 'visibility', 'none');

    fake.state.loseContext(map);
    expect(() => map.getSource('points')).toThrow(TypeError);
    fake.state.restoreContext(map);
    expect(map.isStyleLoaded()).toBe(false);
    expect(map.getLayer('dots')).toBeUndefined();

    fake.state.emit(map, 'style.load');
    expect(map.layerIds()).toEqual(['land', 'dots']);
    expect(map.getLayer('dots').layout.visibility).toBe('none');
    expect(map.getSource('points').data.features).toHaveLength(1);
    expect(map.featureStateOf('points', 9)).toBeUndefined();
  });

  it('constructor errors, the shared fake and its reset', () => {
    const failing = createFakeMapLibre({ constructorError: new GPUInitializationError() });
    failing.module.setWorkerUrl(SERVED_WORKER_URL);
    expect(() => new failing.module.Map({ container: document.createElement('div') }))
      .toThrow(failing.module.GPUInitializationError);

    const shared = sharedFakeMapLibre();
    expect(sharedFakeMapLibre()).toBe(shared);
    const { map } = newMap(shared);
    expect(shared.state.liveMaps()).toEqual([map]);
    map.remove();
    expect(shared.state.liveMaps()).toEqual([]);
    shared.state.reset();
    expect(shared.state.maps).toEqual([]);
    expect(shared.state.workerUrl).toBe(SERVED_WORKER_URL);
  });
});
