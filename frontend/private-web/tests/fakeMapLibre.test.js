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

  it('a camera move fires zoomstart, rotatestart and pitchstart for what changes, with the move\'s originalEvent', () => {
    const { fake, map } = newMap();
    const seen = [];
    for (const type of ['movestart', 'zoomstart', 'zoomend', 'rotatestart', 'rotateend', 'pitchstart', 'pitchend', 'moveend']) {
      map.on(type, event => seen.push([type, event.originalEvent?.type ?? null]));
    }
    // A move made by code: no originalEvent, and only the zoom changed.
    map.jumpTo({ zoom: 14 });
    expect(seen).toEqual([['movestart', null], ['zoomstart', null], ['zoomend', null], ['moveend', null]]);
    // One standing in for a person's: the event goes with every one of them; the same camera again fires no zoom.
    seen.length = 0;
    map.easeTo({ zoom: 14, bearing: -17, pitch: 40, originalEvent: new MouseEvent('mousemove') });
    expect(seen).toEqual([['movestart', 'mousemove'], ['rotatestart', 'mousemove'], ['rotateend', 'mousemove'],
      ['pitchstart', 'mousemove'], ['pitchend', 'mousemove'], ['moveend', 'mousemove']]);
    // A gesture without a move (a drag that starts) is emitted by the test itself.
    seen.length = 0;
    map.on('dragstart', event => seen.push(['dragstart', event.originalEvent.type]));
    fake.state.emit(map, 'dragstart', { originalEvent: new MouseEvent('mousedown') });
    expect(seen).toEqual([['dragstart', 'mousedown']]);
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

  it('unproject is the inverse of project, and the canvas reports the size of the viewport', () => {
    const { fake, map } = newMap();
    const canvasSize = () => [map.getCanvas().clientWidth, map.getCanvas().clientHeight];
    expect(canvasSize()).toEqual([1440, 900]);

    const centre = map.unproject([720, 450]);
    expect(centre).toBeInstanceOf(fake.module.LngLat);
    expect(centre.lng).toBeCloseTo(-68.3634, 9);
    expect(centre.lat).toBeCloseTo(18.5674, 9);
    // A pixel comes back where it was, given as [x, y] or as a Point; the corners are those of getBounds.
    for (const [x, y] of [[0, 0], [1440, 900], [312.5, 77]]) {
      const point = map.project(map.unproject([x, y]));
      expect(point.x).toBeCloseTo(x, 6);
      expect(point.y).toBeCloseTo(y, 6);
    }
    const northWest = map.unproject({ x: 0, y: 0 });
    expect(northWest.lng).toBeCloseTo(map.getBounds().getWest(), 9);
    expect(northWest.lat).toBeCloseTo(map.getBounds().getNorth(), 9);
    expect(() => map.unproject({ lng: -68.36, lat: 18.56 })).toThrow(TypeError);

    fake.state.resize(map, { width: 720, height: 450 });
    expect(canvasSize()).toEqual([720, 450]);
    expect(map.unproject([360, 225]).lng).toBeCloseTo(-68.3634, 9);
    fake.state.reset();
    expect(canvasSize()).toEqual([1440, 900]);
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

  it('setFilter replaces a layer\'s filter, null takes it away, and a context loss keeps it, like MapLibre 6.16', () => {
    const { fake, map } = newMap();
    const filter = ['!=', ['get', 'code'], 'A11'];
    expect(() => map.setFilter('dots', filter)).toThrow('Style is not done loading.');
    fake.state.emit(map, 'style.load');
    expect(map.getFilter('dots')).toBeUndefined();
    map.setFilter('dots', filter);
    expect(map.getFilter('dots')).toEqual(filter);
    expect(map.getLayer('dots').filter).toEqual(filter);
    expect(map.filterCalls).toEqual([{ id: 'dots', filter }]);
    // Stricter than MapLibre, which fires an error event: a missing layer throws.
    expect(() => map.setFilter('nope', filter)).toThrow(/does not exist/);

    // The style MapLibre rebuilds after a context loss keeps the filter the layer was last given.
    fake.state.loseContext(map);
    expect(map.snapshot.layers.find(layer => layer.id === 'dots').filter).toEqual(filter);
    fake.state.restoreContext(map);
    fake.state.emit(map, 'style.load');
    expect(map.getFilter('dots')).toEqual(filter);
    map.setFilter('dots', null);
    expect(map.getLayer('dots')).not.toHaveProperty('filter');
    expect(map.filterCalls.at(-1)).toEqual({ id: 'dots', filter: null });
  });

  it('a raster source takes new tiles with setTiles and a context loss rebuilds it with them, like MapLibre 6.16', () => {
    const fake = createFakeMapLibre();
    fake.module.setWorkerUrl(SERVED_WORKER_URL);
    const latest = 'https://gibs.example/clouds/default/default/{z}/{y}/{x}.png';
    const pinned = 'https://gibs.example/clouds/default/2026-11-13T14:50:00Z/{z}/{y}/{x}.png';
    const style = { ...STYLE, sources: { ...STYLE.sources, clouds: { type: 'raster', tiles: [latest], tileSize: 256 } } };
    const map = new fake.module.Map({ container: document.createElement('div'), style });
    fake.state.emit(map, 'style.load');
    const source = map.getSource('clouds');
    expect(source.tiles).toEqual([latest]);
    expect(source.serialize()).toEqual({ type: 'raster', tiles: [latest], tileSize: 256 });
    source.setTiles([pinned]);
    expect(source.setTilesCalls).toEqual([[pinned]]);
    expect(map.calls.filter(call => call.method === 'setTiles').map(call => call.args)).toEqual([['clouds', [pinned]]]);
    expect(source.serialize().tiles).toEqual([pinned]);
    // Stricter than MapLibre: tiles that are not a list throw. A GeoJSON source has no setTiles.
    expect(() => source.setTiles(pinned)).toThrow(TypeError);
    expect(map.getSource('points').setTiles).toBeUndefined();

    // The snapshot keeps the tiles a raster source was last given, and no data on it; a GeoJSON source keeps its data.
    fake.state.loseContext(map);
    expect(map.snapshot.sources.clouds).toEqual({ type: 'raster', tiles: [pinned], tileSize: 256 });
    expect(map.snapshot.sources.points).toHaveProperty('data');
    fake.state.restoreContext(map);
    fake.state.emit(map, 'style.load');
    expect(map.getSource('clouds').tiles).toEqual([pinned]);
    expect(map.getSource('clouds').setTilesCalls).toEqual([]);
  });

  it('a vector source reloads with setUrl or setTiles and serializes what it was last given, like MapLibre 6.16', () => {
    const fake = createFakeMapLibre();
    fake.module.setWorkerUrl(SERVED_WORKER_URL);
    const url = 'https://tiles.example/planet';
    const style = { ...STYLE, sources: { ...STYLE.sources, base: { type: 'vector', url } } };
    const map = new fake.module.Map({ container: document.createElement('div'), style });
    fake.state.emit(map, 'style.load');
    const source = map.getSource('base');
    expect(source.serialize()).toEqual({ type: 'vector', url });
    source.setUrl(url);
    expect(source.setUrlCalls).toEqual([url]);
    expect(map.calls.filter(call => call.method === 'setUrl').map(call => call.args)).toEqual([['base', url]]);
    const tiles = ['https://tiles.example/{z}/{x}/{y}.pbf'];
    source.setTiles(tiles);
    expect(source.setTilesCalls).toEqual([tiles]);
    expect(source.serialize()).toEqual({ type: 'vector', url, tiles });
    // Stricter than MapLibre: a URL that is not a string and tiles that are not a list throw.
    expect(() => source.setUrl([url])).toThrow(TypeError);
    expect(() => source.setTiles(tiles[0])).toThrow(TypeError);
  });

  it('a restore without WebGL2 rebuilds the style and fires error, never webglcontextrestored, like MapLibre 6.16', () => {
    const { fake, map } = newMap();
    fake.state.emit(map, 'style.load');
    const events = [];
    for (const type of ['error', 'webglcontextrestored', 'style.load']) map.on(type, event => events.push([type, event.error]));
    fake.state.loseContext(map);
    fake.state.failContextRestore(map);
    expect(events).toEqual([['error', expect.any(GPUInitializationError)]]);
    expect(map.isStyleLoaded()).toBe(false);
    // The rebuilt style still loads afterwards.
    fake.state.emit(map, 'style.load');
    expect(events.map(([type]) => type)).toEqual(['error', 'style.load']);
    expect(map.layerIds()).toEqual(['land', 'dots']);
  });

  it('updateData applies the diff as MapLibre 6.16 does, where removeAllProperties drops the properties it comes with', async () => {
    const { fake, map } = newMap();
    fake.state.emit(map, 'style.load');
    const source = map.getSource('points');
    const point = (id, x, properties) => ({ type: 'Feature', id, properties, geometry: { type: 'Point', coordinates: [x, 0] } });
    source.setData({ type: 'FeatureCollection', features: [point('a', 1, { state: 'free', code: 'a' }), point('b', 2, { state: 'free', code: 'b' })] });

    await source.updateData({
      add: [point('c', 3, { state: 'free', code: 'c' })],
      remove: ['b'],
      update: [{ id: 'a', newGeometry: { type: 'Point', coordinates: [9, 9] }, removeProperties: ['code'], addOrUpdateProperties: [{ key: 'state', value: 'busy' }] }],
    });
    expect(source.data.features).toEqual([
      { type: 'Feature', id: 'a', properties: { state: 'busy' }, geometry: { type: 'Point', coordinates: [9, 9] } },
      point('c', 3, { state: 'free', code: 'c' }),
    ]);
    expect(source.updateDataCalls).toHaveLength(1);
    // The trap: removeAllProperties with additions leaves the feature with no property at all.
    await source.updateData({ update: [{ id: 'c', removeAllProperties: true, addOrUpdateProperties: [{ key: 'state', value: 'busy' }] }] });
    expect(source.data.features[1].properties).toEqual({});
    await source.updateData({ removeAll: true, add: [point('d', 4, {})] });
    expect(source.data.features.map(feature => feature.id)).toEqual(['d']);
  });

  it('removeFeatureState refuses a key without a feature id and removes nothing, like MapLibre 6.16', () => {
    const { fake, map } = newMap();
    fake.state.emit(map, 'style.load');
    map.setFeatureState({ source: 'points', id: 1 }, { hover: true, selected: true });
    map.setFeatureState({ source: 'points', id: 2 }, { hover: true });
    expect(() => map.removeFeatureState({ source: 'points' }, 'hover'))
      .toThrow('A feature id is required to remove its specific state property.');
    expect(map.featureStateOf('points', 1)).toEqual({ hover: true, selected: true });
    expect(map.featureStateOf('points', 2)).toEqual({ hover: true });
    // One key of a feature, a feature's whole state (an empty key counts as none) and every state of the source.
    map.removeFeatureState({ source: 'points', id: 1 }, 'hover');
    expect(map.featureStateOf('points', 1)).toEqual({ selected: true });
    map.removeFeatureState({ source: 'points', id: 1 }, '');
    expect(map.featureStateOf('points', 1)).toBeUndefined();
    map.removeFeatureState({ source: 'points' });
    expect(map.featureStateOf('points', 2)).toBeUndefined();
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
