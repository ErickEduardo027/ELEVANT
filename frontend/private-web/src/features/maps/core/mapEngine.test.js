import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { createImageResolver } from '../style/mapImages';
import { buildOccStyle, groupLayerIds } from '../style/occStyle';
import { BASEMAP_TIMEOUT_MS, createMapEngine, liveEngineCount } from './mapEngine';
import { MAPLIBRE_WORKER_URL } from './workerUrl';

// Point stands with clusters, their codes behind a derived threshold, and flights: enough to exercise every call.
const OVERLAY = {
  sources: {
    'occ-stands': { type: 'geojson', promoteId: 'code', cluster: true, clusterRadius: 40 },
    'occ-flights': { type: 'geojson', promoteId: 'id' },
  },
  layers: [
    {
      slot: 'stands', id: 'occ-stand-clusters', type: 'circle', source: 'occ-stands', filter: ['has', 'point_count'],
      metadata: { 'occ:group': 'stands', 'occ:pick': 'cluster', 'occ:pickId': 'cluster_id', 'occ:maxThreshold': 'polygons' },
    },
    {
      slot: 'stands', id: 'occ-stand-points', type: 'circle', source: 'occ-stands', filter: ['!', ['has', 'point_count']],
      metadata: { 'occ:group': 'stands', 'occ:pick': 'stand', 'occ:pickId': 'code' },
    },
    {
      slot: 'standLabels', id: 'occ-stand-codes', type: 'symbol', source: 'occ-stands', minzoom: 13, maxzoom: 22,
      layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Bold'] },
      metadata: { 'occ:group': 'stands', 'occ:minThreshold': 'codes' },
    },
    {
      slot: 'traffic', id: 'occ-flights', type: 'circle', source: 'occ-flights',
      metadata: { 'occ:group': 'traffic', 'occ:pick': 'flight' },
    },
  ],
};
const STYLE = buildOccStyle({ overlays: [OVERLAY] });
const STANDS = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { code: 'A1' }, geometry: { type: 'Point', coordinates: [-68.3655, 18.5701] } }],
};
const squareRasterizer = (shape, pixelRatio) => {
  const width = Math.round(shape.width * pixelRatio);
  const height = Math.round(shape.height * pixelRatio);
  return { width, height, alpha: new Uint8ClampedArray(width * height).fill(255, width * 4, width * 8) };
};

const engines = [];

function setup({ fake = createFakeMapLibre(), style = STYLE, ...options } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const engine = createMapEngine({ maplibre: fake.module, host, style, ...options });
  engines.push(engine);
  return { engine, host, fake, state: fake.state, map: fake.state.maps.at(-1) ?? null };
}

const ready = context => {
  context.state.emit(context.map, 'style.load');
  return context;
};

afterEach(() => {
  engines.splice(0).forEach(engine => engine.destroy());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('map engine', () => {
  it('sets the worker URL before creating the map and passes the engine map options', () => {
    const { engine, host, map, state } = setup({ camera: { center: [-68.3634, 18.5674], zoom: 15, pitch: 0 } });
    expect(state.calls.map(call => call.fn)).toEqual(['setWorkerUrl', 'prewarm', 'Map']);
    expect(state.calls[0].args).toEqual([MAPLIBRE_WORKER_URL]);
    expect(map.options).toMatchObject({
      attributionControl: false,
      pixelRatio: 1,
      maxPitch: 65,
      minZoom: 4.5,
      maxZoom: 19.5,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: true },
      validateStyle: true,
      fadeDuration: 150,
      interactive: true,
      center: [-68.3634, 18.5674],
      zoom: 15,
      pitch: 0,
    });
    expect(map.options.style).toBe(STYLE);
    // The engine's own container, inside the host.
    expect(map.options.container).toBe(engine.container);
    expect(engine.container.classList.contains('occ-map-engine')).toBe(true);
    expect(engine.container.parentElement).toBe(host);

    // The pixel ratio is capped at 2; the map lab's options come last; bounds become a fit.
    vi.stubGlobal('devicePixelRatio', 3);
    const lab = setup({
      camera: { bounds: [[-68.38, 18.55], [-68.34, 18.58]], padding: 40 }, interactive: false, mapOptions: { fadeDuration: 0 },
    });
    expect(lab.map.options).toMatchObject({
      pixelRatio: 2, fadeDuration: 0, interactive: false, bounds: [[-68.38, 18.55], [-68.34, 18.58]],
      fitBoundsOptions: { padding: 40 },
    });
    expect(lab.state.calls.map(call => call.fn)).toEqual(['setWorkerUrl', 'prewarm', 'Map']);
  });

  it('reports unavailable (webgl) when the constructor throws GPUInitializationError and creates no map', async () => {
    const before = liveEngineCount();
    const onStatus = vi.fn();
    const { engine, state, host } = setup({
      fake: createFakeMapLibre({ constructorError: new GPUInitializationError() }), onStatus,
    });
    expect(state.maps).toHaveLength(0);
    expect(engine.map).toBeNull();
    expect(engine.status()).toEqual({ engine: 'unavailable', basemap: 'off', reason: 'webgl' });
    expect(engine.isReady()).toBe(false);
    expect(liveEngineCount()).toBe(before);
    expect(host.contains(engine.container)).toBe(true);
    // Reported in a microtask, after the caller has its engine.
    expect(onStatus).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onStatus).toHaveBeenCalledExactlyOnceWith({ engine: 'unavailable', basemap: 'off', reason: 'webgl' });

    // Every call is harmless without a map.
    engine.setData('occ-stands', STANDS);
    engine.setInsets({ top: 10 });
    await expect(engine.updateData('occ-flights', { add: [] })).resolves.toBeUndefined();
    await expect(engine.expandCluster('occ-stands', 1, [0, 0])).resolves.toBe(false);
    expect(engine.pickAt([1, 2])).toBeNull();
    expect(engine.getCamera()).toBeNull();
    expect(engine.cameraForBounds([[0, 0], [1, 1]])).toBeNull();

    // Any other constructor failure is unavailable too, with reason «error» and a trace.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = setup({ fake: createFakeMapLibre({ constructorError: new Error('Invalid style') }) });
    expect(other.engine.status()).toEqual({ engine: 'unavailable', basemap: 'off', reason: 'error' });
    expect(error).toHaveBeenCalledOnce();
  });

  it('is ready on style.load, not on idle', () => {
    const onStatus = vi.fn();
    const { engine, map, state } = setup({ onStatus });
    expect(engine.status()).toEqual({ engine: 'starting', basemap: 'loading', reason: null });
    state.emit(map, 'idle');
    expect(engine.isReady()).toBe(false);
    expect(onStatus).not.toHaveBeenCalled();
    state.emit(map, 'style.load');
    expect(engine.isReady()).toBe(true);
    expect(onStatus).toHaveBeenCalledExactlyOnceWith({ engine: 'ready', basemap: 'loading', reason: null });
  });

  it('reports a degraded base map on an openmaptiles error and after 8 s without tiles, without hiding the map', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onStatus = vi.fn();
    const { engine, map, state } = ready(setup({ onStatus }));
    vi.advanceTimersByTime(BASEMAP_TIMEOUT_MS - 1);
    expect(engine.status().basemap).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(engine.status()).toEqual({ engine: 'ready', basemap: 'degraded', reason: null });
    expect(onStatus).toHaveBeenLastCalledWith({ engine: 'ready', basemap: 'degraded', reason: null });
    // A chip, not a fallback: the map stays.
    expect(engine.isReady()).toBe(true);
    expect(engine.map).toBe(map);
    expect(engine.container.isConnected).toBe(true);
    expect(engine.container.style.display).toBe('');

    // A tile of the base map brings it back; an error of another source does not touch it; one of the base map does.
    state.emit(map, 'sourcedata', { sourceId: 'openmaptiles', tile: {} });
    expect(engine.status().basemap).toBe('ok');
    state.emit(map, 'error', { sourceId: 'occ-stands', error: new Error('Bad GeoJSON') });
    expect(engine.status().basemap).toBe('ok');
    state.emit(map, 'error', { sourceId: 'openmaptiles', error: new Error('Failed to fetch') });
    expect(engine.status()).toEqual({ engine: 'ready', basemap: 'degraded', reason: null });

    // A first tile in time means the timer never fires.
    const early = ready(setup());
    early.state.emit(early.map, 'sourcedata', { sourceId: 'openmaptiles', tile: {} });
    vi.advanceTimersByTime(BASEMAP_TIMEOUT_MS * 2);
    expect(early.engine.status().basemap).toBe('ok');
    // Source data without a tile (the TileJSON arriving) is not a tile.
    const metadataOnly = setup();
    metadataOnly.state.emit(metadataOnly.map, 'sourcedata', { sourceId: 'openmaptiles', sourceDataType: 'metadata' });
    expect(metadataOnly.engine.status().basemap).toBe('loading');
  });

  it('reports the base map off when the style has no vector source', () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const { engine } = ready(setup({ style: buildOccStyle({ basemap: false, overlays: [OVERLAY] }), onStatus }));
    vi.advanceTimersByTime(BASEMAP_TIMEOUT_MS * 2);
    expect(engine.status()).toEqual({ engine: 'ready', basemap: 'off', reason: null });
    expect(onStatus).toHaveBeenCalledExactlyOnceWith({ engine: 'ready', basemap: 'off', reason: null });
  });

  it('adds its own navigation, nautical scale and compact attribution controls', () => {
    const { fake, map, state } = setup({ attribution: 'Datos de aeronaves: adsb.fi' });
    expect(map.options.attributionControl).toBe(false);
    const [navigation, attribution, scale] = map.controls;
    expect(navigation.control).toBeInstanceOf(fake.module.NavigationControl);
    expect(navigation).toMatchObject({ position: 'top-right', control: { options: { visualizePitch: true } } });
    expect(attribution.control).toBeInstanceOf(fake.module.AttributionControl);
    expect(attribution).toMatchObject({
      position: 'bottom-right', control: { options: { compact: true, customAttribution: 'Datos de aeronaves: adsb.fi' } },
    });
    expect(scale.control).toBeInstanceOf(fake.module.ScaleControl);
    expect(scale).toMatchObject({ position: 'bottom-right', control: { options: { unit: 'nautical' } } });

    // The attribution keeps the corner, with the scale above it, and starts closed.
    const corner = map.controlPositions['bottom-right'];
    expect(corner.firstElementChild).toBe(scale.control.element);
    const details = corner.lastElementChild;
    expect(details.matches('details.maplibregl-ctrl-attrib')).toBe(true);
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.classList.contains('maplibregl-compact-show')).toBe(false);
    // MapLibre reopens it when its content changes; the engine closes it again until the person opens it.
    details.setAttribute('open', '');
    state.emit(map, 'styledata');
    expect(details.hasAttribute('open')).toBe(false);
    details.querySelector('summary').click();
    details.setAttribute('open', '');
    state.emit(map, 'sourcedata', { sourceId: 'occ-stands' });
    expect(details.hasAttribute('open')).toBe(true);
  });

  it('queues data, feature-state, visibility and zoom-range calls made before style.load and flushes them in order', async () => {
    const { engine, map, state } = setup();
    const before = map.calls.length;
    engine.setData('occ-stands', STANDS);
    engine.setFeatureState('occ-stands', 'A1', { selected: true });
    engine.setGroupVisibility('traffic', false);
    engine.applyThresholds({ polygons: 14.2, codes: 15.1, threeLine: 16.4 });
    const update = engine.updateData('occ-flights', { add: [] });
    engine.setClusterOptions('occ-stands', { cluster: false });
    expect(map.calls).toHaveLength(before);

    state.emit(map, 'style.load');
    expect(map.calls.slice(before).map(call => call.method)).toEqual([
      'setData', 'setFeatureState', 'setLayoutProperty', 'setLayerZoomRange', 'setLayerZoomRange', 'updateData',
      'setClusterOptions',
    ]);
    await expect(update).resolves.toBeUndefined();
    expect(map.getSource('occ-stands').data).toEqual(STANDS);
    expect(map.featureStateOf('occ-stands', 'A1')).toEqual({ selected: true });
    expect(map.getLayer('occ-flights').layout.visibility).toBe('none');
    // A min threshold keeps the layer's own maximum and the other way round.
    expect(map.zoomRangeCalls).toEqual([
      { id: 'occ-stand-clusters', minzoom: 0, maxzoom: 14.2 },
      { id: 'occ-stand-codes', minzoom: 15.1, maxzoom: 22 },
    ]);
    expect(map.getSource('occ-stands').clusterOptions.cluster).toBe(false);

    // Once ready, calls run at once; a threshold that is not a number leaves the layer alone.
    engine.setData('occ-flights', STANDS);
    expect(map.calls.at(-1)).toEqual({ method: 'setData', args: ['occ-flights', STANDS] });
    engine.applyThresholds({ polygons: Number.NaN, codes: 15.4 });
    expect(map.zoomRangeCalls.at(-1)).toEqual({ id: 'occ-stand-codes', minzoom: 15.4, maxzoom: 22 });
    expect(map.zoomRangeCalls).toHaveLength(3);
  });

  it('a queued call that fails is traced, the others still run and the map still reports ready', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onStatus = vi.fn();
    const { engine, map, state } = setup({ onStatus });
    // MapLibre refuses a feature state without an id; the fake throws.
    engine.setFeatureState('occ-stands', undefined, { selected: true });
    engine.setData('occ-stands', STANDS);
    state.emit(map, 'style.load');
    expect(error).toHaveBeenCalledOnce();
    expect(map.getSource('occ-stands').data).toEqual(STANDS);
    expect(onStatus).toHaveBeenLastCalledWith({ engine: 'ready', basemap: 'loading', reason: null });
  });

  it('setInsets sets the map padding and the --occ-map-inset-* variables', () => {
    const { engine, map } = setup();
    const insetOf = side => engine.container.style.getPropertyValue(`--occ-map-inset-${side}`);
    expect(['top', 'right', 'bottom', 'left'].map(insetOf)).toEqual(['0px', '0px', '0px', '0px']);
    // Padding is camera state: it applies before the style loads.
    engine.setInsets({ top: 56, right: 320, bottom: 48 });
    expect(map.getPadding()).toEqual({ top: 56, right: 320, bottom: 48, left: 0 });
    expect(['top', 'right', 'bottom', 'left'].map(insetOf)).toEqual(['56px', '320px', '48px', '0px']);
    engine.setInsets({ top: -4, right: 'wide', bottom: null });
    expect(map.getPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(insetOf('top')).toBe('0px');
  });

  it('setGroupVisibility toggles only the layers of that group', () => {
    const { engine, map } = ready(setup());
    const stands = groupLayerIds(STYLE, 'stands');
    const visibility = () => Object.fromEntries(map.layers.map(layer => [layer.id, layer.layout.visibility]));
    const start = visibility();
    engine.setGroupVisibility('stands', false);
    expect(map.layoutCalls.map(call => call.id)).toEqual(stands);
    const hidden = visibility();
    for (const id of Object.keys(start)) expect(hidden[id], id).toBe(stands.includes(id) ? 'none' : start[id]);
    engine.setGroupVisibility('stands', true);
    for (const id of stands) expect(map.getLayer(id).layout.visibility).toBe('visible');
    engine.setGroupVisibility('buildings-3d', true);
    expect(map.getLayer('building-3d').layout.visibility).toBe('visible');
    // The slot markers are never shown.
    const calls = map.layoutCalls.length;
    engine.setGroupVisibility('slot', true);
    expect(map.layoutCalls).toHaveLength(calls);
    expect(map.getLayer('slot-stands').layout.visibility).toBe('none');
  });

  it('pickAt returns the kind and id from layer metadata and queries only existing layers', () => {
    const early = setup();
    expect(early.engine.pickAt({ x: 1, y: 1 })).toBeNull();
    expect(early.map.calls.some(call => call.method === 'queryRenderedFeatures')).toBe(false);

    const { engine, map, state } = ready(setup());
    const queries = [];
    let answer = [{ id: 7, layer: { id: 'occ-stand-points' }, properties: { code: 'A5' } }];
    state.setRenderedFeatures(map, (geometry, options) => {
      queries.push({ geometry, options });
      return answer;
    });
    expect(engine.pickAt({ x: 100, y: 200 })).toEqual({ kind: 'stand', id: 'A5', feature: answer[0] });
    expect(queries[0]).toEqual({
      geometry: [[96, 196], [104, 204]], options: { layers: ['occ-stand-clusters', 'occ-stand-points', 'occ-flights'] },
    });
    answer = [{ id: 'f:p:1', layer: { id: 'occ-flights' }, properties: {} }];
    expect(engine.pickAt([10, 20])).toMatchObject({ kind: 'flight', id: 'f:p:1' });
    answer = [{ id: 3, layer: { id: 'occ-stand-clusters' }, properties: { cluster_id: 42, point_count: 5 } }];
    expect(engine.pickAt([10, 20])).toMatchObject({ kind: 'cluster', id: 42 });
    answer = [];
    expect(engine.pickAt([10, 20])).toBeNull();

    // A layer that is gone is not queried (MapLibre would answer nothing and fire an error).
    map.removeLayer('occ-flights');
    engine.pickAt([10, 20]);
    expect(queries.at(-1).options.layers).toEqual(['occ-stand-clusters', 'occ-stand-points']);
  });

  it('expandCluster awaits the expansion zoom before easing (MapLibre 6 promise)', async () => {
    const { engine, map } = ready(setup());
    const source = map.getSource('occ-stands');
    let answerZoom;
    source.getClusterExpansionZoom = vi.fn(() => new Promise(resolve => {
      answerZoom = resolve;
    }));
    const expanded = engine.expandCluster('occ-stands', 12, [-68.3655, 18.5701]);
    await Promise.resolve();
    expect(map.cameraCalls.filter(call => call.method === 'easeTo')).toEqual([]);
    answerZoom(16.5);
    await expect(expanded).resolves.toBe(true);
    expect(source.getClusterExpansionZoom).toHaveBeenCalledExactlyOnceWith(12);
    expect(map.cameraCalls.at(-1)).toEqual({
      method: 'easeTo', options: { center: [-68.3655, 18.5701], zoom: 16.5, duration: 500 },
    });

    source.getClusterExpansionZoom = vi.fn(() => Promise.reject(new Error('No cluster with the specified id.')));
    await expect(engine.expandCluster('occ-stands', 99, [0, 0])).resolves.toBe(false);
    await expect(engine.expandCluster('occ-unknown', 1, [0, 0])).resolves.toBe(false);
    expect(map.cameraCalls.filter(call => call.method === 'easeTo')).toHaveLength(1);
  });

  it('addCustomLayer inserts below the marker of the next slot', () => {
    const { engine, map, state } = setup();
    const models = { id: 'occ-aircraft-3d', type: 'custom', renderingMode: '3d', onAdd: vi.fn(), render() {} };
    engine.addCustomLayer(models, 'models');
    expect(map.layerIds()).toEqual([]);
    state.emit(map, 'style.load');
    const ids = map.layerIds();
    expect(ids.indexOf('occ-aircraft-3d')).toBe(ids.indexOf('slot-standLabels') - 1);
    expect(ids.indexOf('occ-aircraft-3d')).toBeGreaterThan(ids.indexOf('slot-models'));
    expect(map.getLayer('occ-aircraft-3d')).toBe(models);
    expect(models.onAdd).toHaveBeenCalledOnce();

    engine.addCustomLayer({ id: 'occ-top', type: 'custom', render() {} }, 'selection');
    expect(map.layerIds().at(-1)).toBe('occ-top');
    expect(() => engine.addCustomLayer({ id: 'x', type: 'custom', render() {} }, 'ramp')).toThrow(RangeError);
    engine.removeCustomLayer('occ-top');
    expect(map.getLayer('occ-top')).toBeUndefined();
  });

  it('re-adds custom layers and re-applies feature state on webglcontextrestored', () => {
    const { engine, map, state } = ready(setup());
    const models = { id: 'occ-aircraft-3d', type: 'custom', render() {} };
    engine.addCustomLayer(models, 'models');
    engine.setData('occ-stands', STANDS);
    engine.setFeatureState('occ-stands', 'A1', { selected: true });
    engine.setFeatureState('occ-stands', 'A1', { related: true });
    engine.setFeatureState('occ-flights', 'f:1', { hover: true });
    engine.removeFeatureState('occ-flights', 'f:1');
    engine.setFeatureState('occ-flights', 'f:2', { hover: true, selected: true });
    engine.removeFeatureState('occ-flights', 'f:2', 'hover');

    state.loseContext(map);
    // MapLibre has no style while the context is lost: calls wait instead of throwing.
    engine.setFeatureState('occ-stands', 'A2', { selected: true });
    engine.setGroupVisibility('traffic', false);
    state.restoreContext(map);
    // The rebuilt style loads after the event: nothing can be added yet.
    expect(map.layerIds()).toEqual([]);
    state.emit(map, 'style.load');

    const ids = map.layerIds();
    expect(ids.filter(id => id === 'occ-aircraft-3d')).toHaveLength(1);
    expect(ids.indexOf('occ-aircraft-3d')).toBe(ids.indexOf('slot-standLabels') - 1);
    expect(map.featureStateOf('occ-stands', 'A1')).toEqual({ selected: true, related: true });
    expect(map.featureStateOf('occ-stands', 'A2')).toEqual({ selected: true });
    expect(map.featureStateOf('occ-flights', 'f:1')).toBeUndefined();
    expect(map.featureStateOf('occ-flights', 'f:2')).toEqual({ selected: true });
    expect(map.getLayer('occ-flights').layout.visibility).toBe('none');
    // MapLibre kept the data itself.
    expect(map.getSource('occ-stands').data).toEqual(STANDS);
    expect(engine.isReady()).toBe(true);

    // The synthetic pair of a worker restart is handled the same way.
    state.restartWorkers(map);
    state.emit(map, 'style.load');
    expect(map.layerIds().filter(id => id === 'occ-aircraft-3d')).toHaveLength(1);
    expect(map.featureStateOf('occ-stands', 'A1')).toEqual({ selected: true, related: true });

    // When the style is already there at the event, the engine restores at once.
    map.removeLayer('occ-aircraft-3d');
    map.featureStates.clear();
    state.emit(map, 'webglcontextrestored');
    expect(map.getLayer('occ-aircraft-3d')).toBe(models);
    expect(map.featureStateOf('occ-stands', 'A2')).toEqual({ selected: true });
  });

  it('destroy removes the map, its listeners and its container and is idempotent', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const { engine, map, host } = setup({ onStatus });
    const pendingUpdate = engine.updateData('occ-flights', { add: [] });
    const before = liveEngineCount();
    expect(map.listenerCount()).toBeGreaterThan(0);

    engine.destroy();
    expect(map.removed).toBe(true);
    expect(map.listenerCount()).toBe(0);
    expect(host.querySelector('.occ-map-engine')).toBeNull();
    expect(engine.container.isConnected).toBe(false);
    expect(engine.map).toBeNull();
    expect(engine.isReady()).toBe(false);
    expect(liveEngineCount()).toBe(before - 1);
    // A call that was waiting for the style settles instead of hanging.
    await expect(pendingUpdate).resolves.toBeUndefined();

    engine.destroy();
    expect(liveEngineCount()).toBe(before - 1);
    expect(map.calls.filter(call => call.method === 'remove')).toHaveLength(1);
    // The base-map timer is gone and nothing is reported after destroy.
    vi.advanceTimersByTime(BASEMAP_TIMEOUT_MS * 2);
    expect(onStatus).not.toHaveBeenCalled();
    engine.setData('occ-stands', STANDS);
    engine.flyTo({ zoom: 12 });
    expect(map.calls.at(-1).method).toBe('remove');
  });

  it('a StrictMode-like create-destroy-create leaves exactly one live map and one container in the host', () => {
    const before = liveEngineCount();
    const fake = createFakeMapLibre();
    const host = document.createElement('div');
    document.body.append(host);
    const first = createMapEngine({ maplibre: fake.module, host, style: STYLE });
    first.destroy();
    const second = createMapEngine({ maplibre: fake.module, host, style: STYLE });
    engines.push(second);

    expect(host.querySelectorAll('.occ-map-engine')).toHaveLength(1);
    expect(host.firstElementChild).toBe(second.container);
    expect(host.querySelectorAll('canvas.maplibregl-canvas')).toHaveLength(1);
    expect(fake.state.maps).toHaveLength(2);
    expect(fake.state.liveMaps()).toEqual([fake.state.maps[1]]);
    // Never the same div twice, and one worker pool for both maps.
    expect(fake.state.maps[1].container).not.toBe(fake.state.maps[0].container);
    expect(fake.state.prewarmCount).toBe(1);
    expect(liveEngineCount()).toBe(before + 1);
  });

  it('never calls setStyle during the whole lifecycle', () => {
    const { engine, map, state } = setup({
      imageResolver: createImageResolver({ rasterize: squareRasterizer }), attribution: 'OCC',
    });
    expect(engine).not.toHaveProperty('applyStyle');
    expect(engine).not.toHaveProperty('setStyle');
    state.emit(map, 'style.load');
    engine.setData('occ-stands', STANDS);
    engine.setFeatureState('occ-stands', 'A1', { selected: true });
    engine.setGroupVisibility('stands', false);
    engine.applyThresholds({ polygons: 14, codes: 15, threeLine: 16 });
    engine.setInsets({ top: 40 });
    engine.flyTo({ center: [-68.36, 18.57], zoom: 16 });
    engine.setAttribution('OCC · Datos de aeronaves: adsb.fi');
    engine.addCustomLayer({ id: 'occ-aircraft-3d', type: 'custom', render() {} }, 'models');
    state.requestImage(map, 'airport-arp');
    state.loseContext(map);
    state.restoreContext(map);
    state.emit(map, 'style.load');
    engine.destroy();
    expect(map.styleCalls).toEqual([]);
    expect(map.calls.filter(call => call.method === 'setStyle')).toEqual([]);
  });

  it('hands the images the style names to MapLibre as SDF images from the resolver', () => {
    const { map, state } = ready(setup({ imageResolver: createImageResolver({ rasterize: squareRasterizer }) }));
    const added = state.requestImage(map, 'airport-arp');
    expect(added.options).toEqual({ pixelRatio: 2, sdf: true });
    expect(added.image).toMatchObject({ width: 40, height: 40 });
    expect(added.image.data).toHaveLength(40 * 40 * 4);
    // Asking again adds nothing (the fake would throw on a second addImage); an unknown id adds nothing.
    expect(state.requestImage(map, 'airport-arp')).toBe(added);
    expect(state.requestImage(map, 'not-an-icon')).toBeNull();
  });

  it('reports camera moves, clicks and pointer moves with what is under the pointer', () => {
    const onCamera = vi.fn();
    const onClick = vi.fn();
    const onPointerMove = vi.fn();
    const { engine, map, state } = ready(setup({ onCamera, onClick, onPointerMove }));
    engine.jumpTo({ center: [-68.36, 18.57], zoom: 16, bearing: -17, pitch: 55 });
    expect(onCamera).toHaveBeenLastCalledWith({ center: [-68.36, 18.57], zoom: 16, bearing: -17, pitch: 55 }, { byUser: false });
    expect(engine.getCamera()).toEqual({ center: [-68.36, 18.57], zoom: 16, bearing: -17, pitch: 55 });
    state.emit(map, 'moveend', { originalEvent: new MouseEvent('mouseup') });
    expect(onCamera).toHaveBeenLastCalledWith(expect.any(Object), { byUser: true });

    const feature = { id: 1, layer: { id: 'occ-stand-points' }, properties: { code: 'B21' } };
    state.setRenderedFeatures(map, () => [feature]);
    state.emit(map, 'click', { point: { x: 10, y: 20 }, lngLat: { lng: -68.36, lat: 18.57 } });
    expect(onClick).toHaveBeenCalledExactlyOnceWith({
      point: { x: 10, y: 20 }, lngLat: [-68.36, 18.57], hit: { kind: 'stand', id: 'B21', feature }, originalEvent: undefined,
    });
    state.emit(map, 'mousemove', { point: { x: 11, y: 21 }, lngLat: { lng: -68.36, lat: 18.57 } });
    expect(onPointerMove).toHaveBeenLastCalledWith(expect.objectContaining({ hit: { kind: 'stand', id: 'B21', feature } }));
    state.emit(map, 'mouseout');
    expect(onPointerMove).toHaveBeenLastCalledWith(null);

    engine.setCursor('pointer');
    expect(map.getCanvas().style.cursor).toBe('pointer');
    expect(engine.project([-68.36, 18.57])).toEqual({ x: 720, y: 450 });
    expect(engine.cameraForBounds([[-68.4, 18.55], [-68.33, 18.59]])).toMatchObject({ bearing: 0 });

    // Without handlers the engine does not listen to clicks or the pointer at all.
    const quiet = setup();
    expect(quiet.map.listenerCount('click') + quiet.map.listenerCount('mousemove')).toBe(0);
  });

  it('reports resizes and the bounds on screen, and picks under a moving pointer only when the hit is read', () => {
    const onResize = vi.fn();
    const onPointerMove = vi.fn();
    const { engine, map, state } = ready(setup({ onResize, onPointerMove, camera: { center: [-68.3634, 18.5674], zoom: 15 } }));
    const [[west, south], [east, north]] = engine.getBounds();
    expect([west < -68.3634, east > -68.3634, south < 18.5674, north > 18.5674]).toEqual([true, true, true, true]);

    // MapLibre resized the map to its container: the caller hears it after the new size is in.
    state.resize(map, { width: 720 });
    expect(onResize).toHaveBeenCalledOnce();
    const [[narrowWest], [narrowEast]] = engine.getBounds();
    expect(narrowEast - narrowWest).toBeCloseTo((east - west) / 2, 9);

    const queries = [];
    const feature = { id: 1, layer: { id: 'occ-stand-points' }, properties: { code: 'B21' } };
    state.setRenderedFeatures(map, geometry => {
      queries.push(geometry);
      return [feature];
    });
    state.emit(map, 'mousemove', { point: { x: 11, y: 21 }, lngLat: { lng: -68.36, lat: 18.57 } });
    state.emit(map, 'mousemove', { point: { x: 12, y: 22 }, lngLat: { lng: -68.36, lat: 18.57 } });
    expect(onPointerMove).toHaveBeenCalledTimes(2);
    expect(queries).toEqual([]);
    const latest = onPointerMove.mock.calls.at(-1)[0];
    expect(latest).toMatchObject({ point: { x: 12, y: 22 }, lngLat: [-68.36, 18.57] });
    expect(latest.hit).toEqual({ kind: 'stand', id: 'B21', feature });
    expect(latest.hit).toBe(latest.hit);
    expect(queries).toEqual([[[8, 18], [16, 26]]]);

    // Without a handler there is no resize listener; without a map there are no bounds.
    expect(setup().map.listenerCount('resize')).toBe(0);
    engine.destroy();
    expect(engine.getBounds()).toBeNull();
    expect(onResize).toHaveBeenCalledOnce();
  });

  it('setAttribution replaces the attribution and keeps it in the corner, closed', () => {
    const { engine, map } = setup({ attribution: 'OCC' });
    engine.setAttribution('OCC · Datos de aeronaves: adsb.fi');
    expect(map.controls).toHaveLength(3);
    const corner = map.controlPositions['bottom-right'];
    expect(corner.children).toHaveLength(2);
    expect(corner.firstElementChild.className).toContain('maplibregl-ctrl-scale');
    expect(corner.lastElementChild.textContent).toBe('OCC · Datos de aeronaves: adsb.fi');
    expect(corner.lastElementChild.hasAttribute('open')).toBe(false);
  });
});
