import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { createImageResolver } from '../style/mapImages';
import { buildOccStyle, groupLayerIds } from '../style/occStyle';
import { BASEMAP_TIMEOUT_MS, createMapEngine, ENGINE_MAX_ZOOM, ENGINE_MIN_ZOOM, liveEngineCount } from './mapEngine';
import { occSky } from './mapSky';
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
      fadeDuration: 0,
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

  it('setCameraLimits sets the bounds and zoom range, null for the engine defaults, and waits for a move with afterMove', () => {
    const { engine, map } = setup();
    expect(map.options).toMatchObject({ minZoom: ENGINE_MIN_ZOOM, maxZoom: ENGINE_MAX_ZOOM });
    const box = [[-68.42, 18.53], [-68.32, 18.6]];
    engine.setCameraLimits({ maxBounds: box, minZoom: 13 });
    expect(map.options).toMatchObject({ maxBounds: box, minZoom: 13, maxZoom: ENGINE_MAX_ZOOM });
    engine.setCameraLimits({ maxBounds: null, minZoom: null, maxZoom: 22 });
    expect(map.options).toMatchObject({ maxBounds: null, minZoom: ENGINE_MIN_ZOOM, maxZoom: 22 });
    // A move on its way: the limits wait for its end; a later call replaces a wait not yet applied.
    map.moving = true;
    engine.setCameraLimits({ maxBounds: box, minZoom: 12 }, { afterMove: true });
    engine.setCameraLimits({ maxBounds: box, minZoom: 13 }, { afterMove: true });
    expect(map.options.maxBounds).toBeNull();
    map.moving = false;
    map._fire('moveend', {});
    expect(map.options).toMatchObject({ maxBounds: box, minZoom: 13, maxZoom: ENGINE_MAX_ZOOM });
    expect(map.calls.filter(call => call.method === 'setMinZoom').map(call => call.args[0])).toEqual([13, ENGINE_MIN_ZOOM, 13]);
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

  it('setRasterTiles sets the tiles and restores them after a context loss', () => {
    // A raster source of PR M8 (a satellite image of GIBS), its tiles the latest image until they are pinned.
    const latest = 'https://gibs.example/wmts/epsg3857/best/Clouds/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png';
    const pinned = latest.replace('/default/default/', '/default/2026-11-13T14:50:00Z/');
    const style = buildOccStyle({ overlays: [OVERLAY, {
      sources: { 'occ-weather-goes': { type: 'raster', tiles: [latest], tileSize: 256, maxzoom: 6 } },
      layers: [{ slot: 'weather', id: 'occ-weather-goes-image', type: 'raster', source: 'occ-weather-goes',
        layout: { visibility: 'none' }, metadata: { 'occ:group': 'weather.goes' } }],
    }] });
    const { engine, map, state } = setup({ style });
    // Asked before the style loads, it waits for it, like every call that needs the style.
    engine.setRasterTiles('occ-weather-goes', [pinned]);
    state.emit(map, 'style.load');
    const source = map.getSource('occ-weather-goes');
    expect(source.setTilesCalls).toEqual([[pinned]]);
    expect(source.serialize().tiles).toEqual([pinned]);
    // The same tiles again: MapLibre would reload the source for nothing, so nothing is called.
    engine.setRasterTiles('occ-weather-goes', [pinned]);
    expect(source.setTilesCalls).toHaveLength(1);

    // A context loss: MapLibre 6.16 rebuilds the source with the tiles it was last given, and the engine adds nothing.
    state.loseContext(map);
    state.restoreContext(map);
    state.emit(map, 'style.load');
    expect(map.getSource('occ-weather-goes').serialize().tiles).toEqual([pinned]);
    expect(map.getSource('occ-weather-goes').setTilesCalls).toEqual([]);
    // A style rebuilt without them (another MapLibre, a worker restart that lost them) gets them back from the engine.
    state.loseContext(map);
    map.snapshot.sources['occ-weather-goes'].tiles = [latest];
    state.restoreContext(map);
    state.emit(map, 'style.load');
    expect(map.getSource('occ-weather-goes').setTilesCalls).toEqual([[pinned]]);
    expect(map.getSource('occ-weather-goes').tiles).toEqual([pinned]);

    // Only a list of URL templates; a source that is not a raster, or none, is left alone.
    for (const tiles of [[], pinned, null, [''], [42]]) {
      expect(() => engine.setRasterTiles('occ-weather-goes', tiles), JSON.stringify(tiles)).toThrow(TypeError);
    }
    expect(() => engine.setRasterTiles('occ-stands', [pinned])).not.toThrow();
    expect(() => engine.setRasterTiles('nowhere', [pinned])).not.toThrow();
    // After destroy nothing reaches MapLibre.
    engine.destroy();
    expect(() => engine.setRasterTiles('occ-weather-goes', [latest])).not.toThrow();
    expect(map.calls.filter(call => call.method === 'setTiles')).toHaveLength(2);
  });

  it('setPaint sets a paint property of a layer once the style has loaded, and leaves a missing layer alone', () => {
    // Lane M7: the frames of a weather loop switch their raster-opacity.
    const { engine, map, state } = setup();
    const paintCalls = () => map.calls.filter(call => call.method === 'setPaintProperty');
    engine.setPaint('occ-stand-codes', 'text-opacity', 0.5);
    expect(paintCalls()).toEqual([]);
    state.emit(map, 'style.load');
    expect(map.getLayer('occ-stand-codes').paint['text-opacity']).toBe(0.5);
    expect(() => engine.setPaint('occ-nowhere', 'raster-opacity', 0)).not.toThrow();
    expect(paintCalls().map(call => call.args)).toEqual([['occ-stand-codes', 'text-opacity', 0.5]]);
    engine.destroy();
    expect(() => engine.setPaint('occ-stand-codes', 'text-opacity', 1)).not.toThrow();
    expect(paintCalls()).toHaveLength(1);
  });

  it('setFilter gives a layer its filter once the style has loaded, and MapLibre keeps it through a context loss', () => {
    const { engine, map, state } = setup();
    const filter = ['!=', ['get', 'code'], 'A11'];
    const filterCalls = () => map.calls.filter(call => call.method === 'setFilter');
    // Asked before the style loads, it waits for it, like every call that needs the style.
    engine.setFilter('occ-stand-codes', filter);
    expect(filterCalls()).toEqual([]);
    state.emit(map, 'style.load');
    expect(map.getLayer('occ-stand-codes').filter).toEqual(filter);
    // It replaces the layer's filter; null takes it away. A layer the style lacks is left alone.
    engine.setFilter('occ-stand-points', null);
    expect(map.getLayer('occ-stand-points')).not.toHaveProperty('filter');
    expect(() => engine.setFilter('occ-nowhere', filter)).not.toThrow();
    expect(filterCalls().map(call => call.args.slice(0, 2))).toEqual([['occ-stand-codes', filter], ['occ-stand-points', null]]);

    // MapLibre 6.16 rebuilds the style after a context loss or a worker restart with the filters it was last given, so
    // the engine puts nothing back.
    state.loseContext(map);
    state.restoreContext(map);
    state.emit(map, 'style.load');
    expect(map.getLayer('occ-stand-codes').filter).toEqual(filter);
    expect(map.getLayer('occ-stand-points')).not.toHaveProperty('filter');
    state.restartWorkers(map);
    state.emit(map, 'style.load');
    expect(map.getLayer('occ-stand-codes').filter).toEqual(filter);
    expect(filterCalls()).toHaveLength(2);
    // After destroy nothing reaches MapLibre.
    engine.destroy();
    expect(() => engine.setFilter('occ-stand-codes', null)).not.toThrow();
    expect(filterCalls()).toHaveLength(2);
  });

  it('stays unavailable when the context comes back without WebGL2 and removes the map at once', async () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const { engine, map, state } = ready(setup({ onStatus }));
    engine.addCustomLayer({ id: 'occ-aircraft-3d', type: 'custom', render() {} }, 'models');
    engine.setFeatureState('occ-stands', 'A1', { selected: true });
    const before = liveEngineCount();
    state.loseContext(map);
    // Calls made while the context is lost wait for the rebuilt style.
    const update = engine.updateData('occ-flights', { add: [] });
    const idle = engine.whenIdle();

    // MapLibre 6.16 rebuilds the style, cannot create its painter and fires error instead of webglcontextrestored.
    state.failContextRestore(map);
    const unavailable = { engine: 'unavailable', basemap: 'off', reason: 'webgl' };
    expect(engine.status()).toEqual(unavailable);
    expect(onStatus).toHaveBeenLastCalledWith(unavailable);
    expect(engine.isReady()).toBe(false);
    expect(engine.map).toBeNull();
    // The engine removed the map, as MapLibre's constructor cleans up after the same error: no canvas or control is
    // left in the container under the screen's fallback, and no listener of the engine is left on the map.
    expect(map.removed).toBe(true);
    expect(map.listenerCount()).toBe(0);
    expect(liveEngineCount()).toBe(before - 1);
    expect(engine.container.isConnected).toBe(true);
    expect(engine.container.childElementCount).toBe(0);
    // What was waiting settles instead of hanging.
    await expect(update).resolves.toBeUndefined();
    await expect(idle).resolves.toBe(false);

    // The style it rebuilt loading on a later frame, a tile of the base map, its timer or a worker restart change
    // nothing: the map does not come back, nothing is put back on it, and later calls are dropped instead of waiting
    // for a style that will never draw.
    const calls = map.calls.length;
    state.emit(map, 'style.load');
    state.emit(map, 'sourcedata', { sourceId: 'openmaptiles', tile: {} });
    vi.advanceTimersByTime(BASEMAP_TIMEOUT_MS * 2);
    state.restartWorkers(map);
    state.emit(map, 'style.load');
    expect(engine.status()).toEqual(unavailable);
    expect(engine.isReady()).toBe(false);
    expect(map.getLayer('occ-aircraft-3d')).toBeUndefined();
    expect(map.featureStateOf('occ-stands', 'A1')).toBeUndefined();
    engine.setData('occ-stands', STANDS);
    engine.setFeatureState('occ-stands', 'A2', { selected: true });
    engine.setGroupVisibility('traffic', false);
    engine.addCustomLayer({ id: 'occ-top', type: 'custom', render() {} }, 'selection');
    engine.flyTo({ center: [-68.36, 18.57], zoom: 16 });
    await expect(engine.updateData('occ-flights', { add: [] })).resolves.toBeUndefined();
    expect(map.calls).toHaveLength(calls);
    expect(engine.pickAt([10, 20])).toBeNull();
    expect(engine.getCamera()).toBeNull();
    await expect(engine.whenIdle()).resolves.toBe(false);
    expect(onStatus.mock.calls.map(([status]) => status.engine)).toEqual(['ready', 'unavailable']);

    // destroy has only the container left to take away.
    engine.destroy();
    expect(engine.container.isConnected).toBe(false);
    expect(map.calls.filter(call => call.method === 'remove')).toHaveLength(1);
    expect(liveEngineCount()).toBe(before - 1);
  });

  it('refuses to remove a key without a feature id, as MapLibre does, so a context loss puts back what the map shows', () => {
    const { engine, map, state } = ready(setup());
    const shown = () => [
      map.featureStateOf('occ-flights', 'f:1'), map.featureStateOf('occ-flights', 'f:2'), map.featureStateOf('occ-stands', 'A1'),
    ];
    const loseAndRestore = () => {
      state.loseContext(map);
      state.restoreContext(map);
      state.emit(map, 'style.load');
    };
    engine.setFeatureState('occ-flights', 'f:1', { hover: true, selected: true });
    engine.setFeatureState('occ-flights', 'f:2', { hover: true });
    const calls = map.calls.length;
    expect(() => engine.removeFeatureState('occ-flights', undefined, 'hover')).toThrow(TypeError);
    expect(() => engine.removeFeatureState('occ-flights', null, 'hover')).toThrow(TypeError);
    // Nothing reached MapLibre, which refuses the combination and removes nothing (the fake throws on it).
    expect(map.calls).toHaveLength(calls);
    expect(shown()).toEqual([{ hover: true, selected: true }, { hover: true }, undefined]);
    // Neither did the engine's memory: after a context loss it puts back what the map showed.
    loseAndRestore();
    expect(shown()).toEqual([{ hover: true, selected: true }, { hover: true }, undefined]);

    // MapLibre's three forms stay in step through a context loss: one key, a feature's whole state (an empty key counts
    // as none) and every state of the source.
    engine.removeFeatureState('occ-flights', 'f:1', 'hover');
    engine.removeFeatureState('occ-flights', 'f:2', '');
    engine.setFeatureState('occ-stands', 'A1', { selected: true });
    expect(shown()).toEqual([{ selected: true }, undefined, { selected: true }]);
    loseAndRestore();
    expect(shown()).toEqual([{ selected: true }, undefined, { selected: true }]);
    engine.removeFeatureState('occ-flights');
    expect(shown()).toEqual([undefined, undefined, { selected: true }]);
    loseAndRestore();
    expect(shown()).toEqual([undefined, undefined, { selected: true }]);
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

  it('whenIdle asks for a frame and resolves on the next idle event, and false once the map is gone', async () => {
    const { engine, map, state } = ready(setup());
    const idle = engine.whenIdle();
    expect(map.calls.at(-1).method).toBe('triggerRepaint');
    let settled = false;
    void idle.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    state.emit(map, 'idle');
    await expect(idle).resolves.toBe(true);
    expect(map.listenerCount('idle')).toBe(0);

    // A wait cut short by destroy settles false and leaves no listener behind.
    const cut = engine.whenIdle();
    engine.destroy();
    await expect(cut).resolves.toBe(false);
    expect(map.listenerCount()).toBe(0);
    await expect(engine.whenIdle()).resolves.toBe(false);

    // Without a map there is nothing to wait for.
    const failing = setup({ fake: createFakeMapLibre({ constructorError: new GPUInitializationError() }) });
    await expect(failing.engine.whenIdle()).resolves.toBe(false);
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

  it('hands the images the style names to MapLibre with what the resolver says of them', () => {
    const { map, state } = ready(setup({ imageResolver: createImageResolver({ rasterize: squareRasterizer }) }));
    const added = state.requestImage(map, 'airport-arp');
    expect(added.options).toEqual({ pixelRatio: 2, sdf: true });
    expect(added.image).toMatchObject({ width: 56, height: 40 });
    expect(added.image.data).toHaveLength(56 * 40 * 4);
    // Asking again adds nothing (the fake would throw on a second addImage); an unknown id adds nothing.
    expect(state.requestImage(map, 'airport-arp')).toBe(added);
    expect(state.requestImage(map, 'not-an-icon')).toBeNull();
    // A pattern is painted, not an SDF; an image stretched around a text says where it stretches, in image pixels.
    expect(state.requestImage(map, 'stand-hatch-pattern').options).toEqual({ pixelRatio: 2, sdf: false });
    expect(state.requestImage(map, 'stand-chip').options).toEqual({
      pixelRatio: 2, sdf: true, stretchX: [[12, 28]], stretchY: [[12, 20]], content: [10, 10, 30, 22],
    });
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

  it('reports a double click with what is under it; prevented, MapLibre does not zoom, else it zooms in (M4)', () => {
    let prevent = true;
    const onDoubleClick = vi.fn(event => { if (prevent) event.preventDefault(); });
    const { engine, map, state } = ready(setup({ onDoubleClick }));
    engine.jumpTo({ center: [-68.36, 18.57], zoom: 16 });
    const feature = { id: 1, layer: { id: 'occ-stand-points' }, properties: { code: 'B21' } };
    state.setRenderedFeatures(map, () => [feature]);
    const at = { point: { x: 10, y: 20 }, lngLat: { lng: -68.36, lat: 18.57 } };
    expect(state.doubleClick(map, at)).toBe(true);
    expect(onDoubleClick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      point: { x: 10, y: 20 }, lngLat: [-68.36, 18.57], hit: { kind: 'stand', id: 'B21', feature },
      preventDefault: expect.any(Function),
    }));
    expect(map.getZoom()).toBe(16);
    // Not prevented (nothing to follow under it): MapLibre's own zoom, one level in.
    prevent = false;
    expect(state.doubleClick(map, at)).toBe(false);
    expect(map.getZoom()).toBe(17);
    // Without the handler the engine does not listen to double clicks.
    expect(setup().map.listenerCount('dblclick')).toBe(0);
  });

  it('setOrbitMode lifts the zoom limit to 22 with the tilt and gives both back, easing the camera within (M4)', () => {
    const { engine, map } = ready(setup({ camera: { center: [-68.36, 18.57], zoom: 17 } }));
    expect(map.getMaxZoom()).toBe(19.5);
    engine.setOrbitMode(true);
    expect([map.getMaxZoom(), map.getMaxPitch()]).toEqual([22, 85]);
    expect(map.doubleClickZoom.isEnabled()).toBe(false);
    engine.jumpTo({ zoom: 21.6, pitch: 80 });
    expect(map.getZoom()).toBe(21.6);
    // Twice is once: the limits saved are the map's own, not the orbit's.
    engine.setOrbitMode(true);
    engine.setOrbitMode(false);
    expect([map.getMaxZoom(), map.getMaxPitch()]).toEqual([19.5, 65]);
    expect(map.getZoom()).toBe(19.5);
    expect(map.doubleClickZoom.isEnabled()).toBe(true);
  });

  it('setCameraLimits and setOrbitMode do not fight: the orbit keeps zoom 22 and gives back the latest limits (M4, M9)', () => {
    const { engine, map } = ready(setup({ camera: { center: [-68.36, 18.57], zoom: 15 } }));
    const box = [[-68.42, 18.53], [-68.32, 18.6]];
    // The airport lock of Mapa de posiciones (M9), then «Seguir en 3D» and, after it, the release of the lock.
    engine.setCameraLimits({ maxBounds: box, minZoom: 13 });
    engine.setOrbitMode(true);
    expect(map.getMaxZoom()).toBe(22);
    engine.setCameraLimits({ maxBounds: null, minZoom: null, maxZoom: 22 });
    expect(map.options).toMatchObject({ maxBounds: null, minZoom: ENGINE_MIN_ZOOM, maxZoom: 22 });
    // A screen's lower limit during the orbit waits for its end: the orbit keeps 22 meanwhile.
    engine.setCameraLimits({ maxBounds: null, minZoom: null, maxZoom: 20 });
    expect(map.getMaxZoom()).toBe(22);
    engine.jumpTo({ zoom: 21.6 });
    engine.setOrbitMode(false);
    expect([map.getMaxZoom(), map.getZoom()]).toEqual([20, 20]);
    // As OccMap ends it: the orbit off, the flight home under way, then the lock back once it lands (afterMove), which
    // restores the screen's own range.
    engine.setOrbitMode(true);
    engine.setOrbitMode(false);
    map.moving = true;
    engine.setCameraLimits({ maxBounds: box, minZoom: 13 }, { afterMove: true });
    expect(map.getMaxZoom()).toBe(20);
    map.moving = false;
    map._fire('moveend', {});
    expect(map.options).toMatchObject({ maxBounds: box, minZoom: 13, maxZoom: ENGINE_MAX_ZOOM });
    // A wait still pending when the orbit ends applies at the end of its jump, not under the limit it gives back.
    engine.setOrbitMode(true);
    engine.setCameraLimits({ maxBounds: null, minZoom: null, maxZoom: 22 });
    map.moving = true;
    engine.setCameraLimits({ maxBounds: box, minZoom: 13 }, { afterMove: true });
    engine.setOrbitMode(false);
    map.moving = false;
    map._fire('moveend', {});
    expect(map.options).toMatchObject({ maxBounds: box, minZoom: 13, maxZoom: ENGINE_MAX_ZOOM });
    // Without the release (Panorama, Monitoreo) the orbit gives back the map's own limit.
    engine.setOrbitMode(true);
    engine.setOrbitMode(false);
    expect(map.getMaxZoom()).toBe(ENGINE_MAX_ZOOM);
  });

  it('setCloseUp hides the layers marked for it and narrows the filtered ones; their groups win back (M4)', () => {
    const overlay = {
      sources: { 'occ-traffic': { type: 'geojson', promoteId: 'id' }, 'occ-stands': { type: 'geojson' } },
      layers: [
        { slot: 'traffic', id: 'occ-traffic-points', type: 'circle', source: 'occ-traffic',
          metadata: { 'occ:group': 'traffic' } },
        { slot: 'traffic', id: 'occ-traffic-tags', type: 'symbol', source: 'occ-traffic', filter: ['==', ['get', 'own'], false],
          layout: { visibility: 'none' }, metadata: { 'occ:group': 'traffic.labels', 'occ:closeUp': 'hide' } },
        { slot: 'traffic', id: 'occ-aviam-tags', type: 'symbol', source: 'occ-traffic', filter: ['get', 'own'],
          metadata: { 'occ:group': 'traffic', 'occ:closeUpFilter': ['get', 'selected'] } },
        { slot: 'standLabels', id: 'occ-stand-codes', type: 'symbol', source: 'occ-stands',
          metadata: { 'occ:group': 'stands', 'occ:closeUp': 'hide' } },
      ],
    };
    const style = buildOccStyle({ overlays: [overlay] });
    const { engine, map } = ready(setup({ style }));
    const shown = id => map.getLayer(id).layout.visibility ?? 'visible';
    expect(engine.isCloseUp()).toBe(false);
    // The other traffic's tags are on from the layers menu.
    engine.setGroupVisibility('traffic.labels', true);
    engine.setCloseUp(true);
    expect(engine.isCloseUp()).toBe(true);
    expect(['occ-traffic-points', 'occ-traffic-tags', 'occ-stand-codes', 'occ-aviam-tags'].map(shown))
      .toEqual(['visible', 'none', 'none', 'visible']);
    expect(map.getFilter('occ-aviam-tags')).toEqual(['all', ['get', 'own'], ['get', 'selected']]);
    // Nothing more while the answer stays.
    const calls = map.layoutCalls.length + map.filterCalls.length;
    engine.setCloseUp(true);
    expect(map.layoutCalls.length + map.filterCalls.length).toBe(calls);
    // A group turned on close up stays hidden until the camera goes back; one turned off stays off after it.
    engine.setGroupVisibility('stands', true);
    expect(shown('occ-stand-codes')).toBe('none');
    engine.setGroupVisibility('traffic.labels', false);
    engine.setCloseUp(false);
    expect(['occ-traffic-tags', 'occ-stand-codes'].map(shown)).toEqual(['none', 'visible']);
    expect(map.getFilter('occ-aviam-tags')).toEqual(['get', 'own']);
    engine.setGroupVisibility('traffic.labels', true);
    engine.setCloseUp(true);
    engine.setCloseUp(false);
    expect(shown('occ-traffic-tags')).toBe('visible');
  });

  it('setSky waits for the style, sets the sky once, takes it away and puts it back after a context loss (M4)', () => {
    const context = setup();
    const { engine, map, state } = context;
    const skyCalls = () => map.calls.filter(call => call.method === 'setSky');
    const sky = occSky('dark');
    // No sky asked for: MapLibre is never told to have none.
    engine.setSky(null);
    expect(engine.getSky()).toBeNull();
    // Before the style has loaded the call waits.
    engine.setSky(sky);
    expect(skyCalls()).toHaveLength(0);
    ready(context);
    expect(skyCalls()).toHaveLength(1);
    expect(map.getSky()).toEqual(sky);
    expect(engine.getSky()).toEqual(sky);
    // The same sky again, even as another object, changes nothing; a copy is kept, so changing the caller's does not.
    engine.setSky(occSky('dark'));
    sky['sky-color'] = '#ff0000';
    expect(skyCalls()).toHaveLength(1);
    expect(engine.getSky()['sky-color']).toBe(occSky('dark')['sky-color']);
    // A context loss drops it with the style; the rebuilt style gets it back.
    state.loseContext(map);
    state.restoreContext(map);
    state.emit(map, 'style.load');
    expect(skyCalls()).toHaveLength(2);
    expect(map.getSky()).toEqual(occSky('dark'));
    // null takes it away (MapLibre's setSky(undefined)), and a context loss then brings none back.
    engine.setSky(null);
    expect(skyCalls().at(-1).args).toEqual([undefined]);
    expect(map.getSky()).toBeUndefined();
    state.loseContext(map);
    state.restoreContext(map);
    state.emit(map, 'style.load');
    expect(skyCalls()).toHaveLength(3);
    // The sky is a property of the style: never a setStyle.
    expect(map.styleCalls).toHaveLength(0);
  });

  it('onUserGesture hears a person pan, zoom, rotate and tilt the map, never a move the code makes', () => {
    const onUserGesture = vi.fn();
    const onCamera = vi.fn();
    const { engine, map, state } = ready(setup({ onUserGesture, onCamera, camera: { center: [-68.36, 18.57], zoom: 12 } }));
    const person = type => ({ originalEvent: new MouseEvent(type) });
    // The moves the code makes, whatever they change, carry no DOM event: no gesture, nobody interacting.
    engine.jumpTo({ center: [-68.37, 18.58], zoom: 13, bearing: -17, pitch: 40 });
    engine.easeTo({ zoom: 14, duration: 0 });
    engine.flyTo({ zoom: 10, duration: 0 });
    state.emit(map, 'zoomstart');
    expect(onUserGesture).not.toHaveBeenCalled();
    expect(engine.isInteracting()).toBe(false);
    // A drag pans; it lasts until its move ends, and meanwhile the person is moving the map.
    state.emit(map, 'dragstart', person('mousedown'));
    expect(onUserGesture).toHaveBeenLastCalledWith({ kind: 'pan' });
    expect(engine.isInteracting()).toBe(true);
    state.emit(map, 'moveend', person('mouseup'));
    expect(engine.isInteracting()).toBe(false);
    expect(onCamera).toHaveBeenLastCalledWith(expect.any(Object), { byUser: true });
    // The wheel (or a zoom button) zooms, the right button rotates and tilts.
    for (const [type, kind] of [['zoomstart', 'zoom'], ['rotatestart', 'rotate'], ['pitchstart', 'pitch']]) {
      state.emit(map, type, person('wheel'));
      expect(onUserGesture, type).toHaveBeenLastCalledWith({ kind });
      expect(engine.isInteracting(), type).toBe(true);
      state.emit(map, 'moveend', person('mouseup'));
    }
    // A zoom the map makes for a person (its zoom buttons pass the click) is theirs too.
    map.easeTo({ zoom: 11, originalEvent: new MouseEvent('click') });
    expect(onUserGesture).toHaveBeenLastCalledWith({ kind: 'zoom' });
    expect(engine.isInteracting()).toBe(false);
    // MapLibre's keyboard pans with the arrow keys: a move that starts with one is a pan; Shift rotates or tilts, and
    // the + and − keys zoom (their zoomstart says so).
    const calls = onUserGesture.mock.calls.length;
    state.emit(map, 'movestart', { originalEvent: new KeyboardEvent('keydown', { key: 'ArrowLeft' }) });
    expect(onUserGesture).toHaveBeenLastCalledWith({ kind: 'pan' });
    state.emit(map, 'movestart', { originalEvent: new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true }) });
    state.emit(map, 'movestart', { originalEvent: new KeyboardEvent('keydown', { key: '+' }) });
    state.emit(map, 'movestart', person('wheel'));
    expect(onUserGesture).toHaveBeenCalledTimes(calls + 1);
    state.emit(map, 'moveend');
    // Without a handler the engine still knows who moves the map; without a map nobody does.
    const quiet = ready(setup());
    quiet.state.emit(quiet.map, 'dragstart', person('mousedown'));
    expect(quiet.engine.isInteracting()).toBe(true);
    quiet.engine.destroy();
    expect(quiet.engine.isInteracting()).toBe(false);
  });

  it('getViewport is the size of the map on screen, or nothing without one', () => {
    const { engine, state, map } = ready(setup());
    expect(engine.getViewport()).toEqual({ width: 1440, height: 900 });
    state.resize(map, { width: 1920, height: 1080 });
    expect(engine.getViewport()).toEqual({ width: 1920, height: 1080 });
    state.resize(map, { width: 0, height: 1080 });
    expect(engine.getViewport()).toBeNull();
    engine.destroy();
    expect(engine.getViewport()).toBeNull();
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

  it('renderedFeatures answers what is drawn of the given layers in the area the insets leave in sight', () => {
    const early = setup();
    expect(early.engine.renderedFeatures(['occ-stand-points'])).toEqual([]);
    expect(early.map.calls.some(call => call.method === 'queryRenderedFeatures')).toBe(false);

    const { engine, map, state } = ready(setup());
    const queries = [];
    const drawn = [{ id: 'A5', layer: { id: 'occ-stand-points' }, properties: { code: 'A5' } }];
    state.setRenderedFeatures(map, (geometry, options) => {
      queries.push({ geometry, options });
      return drawn;
    });
    // Without insets the whole 1440 × 900 map; with them the rectangle between the panels.
    expect(engine.renderedFeatures(['occ-stand-points', 'occ-stand-clusters'])).toBe(drawn);
    expect(queries).toEqual([{ geometry: [[0, 0], [1440, 900]], options: { layers: ['occ-stand-points', 'occ-stand-clusters'] } }]);
    engine.renderedFeatures(['occ-stand-points'], { top: 56, right: 320, bottom: 48, left: 0 });
    expect(queries.at(-1).geometry).toEqual([[0, 56], [1120, 852]]);
    // A layer the style lacks is not queried (MapLibre would answer nothing and fire an error).
    engine.renderedFeatures(['occ-stand-points', 'occ-missing']);
    expect(queries.at(-1).options.layers).toEqual(['occ-stand-points']);
    // No layer of the style, or insets that leave no room: nothing to ask.
    const asked = queries.length;
    expect(engine.renderedFeatures(['occ-missing'])).toEqual([]);
    expect(engine.renderedFeatures([])).toEqual([]);
    expect(engine.renderedFeatures(['occ-stand-points'], { left: 800, right: 700 })).toEqual([]);
    // Nothing while the WebGL context is lost, nor once the map is gone.
    state.loseContext(map);
    expect(engine.renderedFeatures(['occ-stand-points'])).toEqual([]);
    engine.destroy();
    expect(engine.renderedFeatures(['occ-stand-points'])).toEqual([]);
    expect(queries).toHaveLength(asked);
  });

  it('reports every idle frame to onIdle, and listens to idle only with a handler', () => {
    const onIdle = vi.fn();
    const { engine, map, state } = ready(setup({ onIdle }));
    state.emit(map, 'idle');
    state.emit(map, 'idle');
    expect(onIdle).toHaveBeenCalledTimes(2);
    expect(onIdle.mock.calls[0]).toEqual([]);
    // A wait for an idle frame goes on working beside it, and destroy removes both.
    const idle = engine.whenIdle();
    state.emit(map, 'idle');
    expect(onIdle).toHaveBeenCalledTimes(3);
    engine.destroy();
    expect(map.listenerCount()).toBe(0);
    expect(setup().map.listenerCount('idle')).toBe(0);
    return expect(idle).resolves.toBe(true);
  });

  it('getVisibleBounds is the part of the map the insets leave in sight, never more than getBounds', () => {
    const { engine, fake, map, state } = ready(setup({ camera: { center: [-68.3634, 18.5674], zoom: 15 } }));
    const [[west, south], [east, north]] = engine.getBounds();
    const expectBox = (box, expected) => box.flat().forEach((value, index) => expect(value).toBeCloseTo(expected.flat()[index], 9));

    // No insets, or insets that are not lengths: the whole map.
    expectBox(engine.getVisibleBounds(), [[west, south], [east, north]]);
    expectBox(engine.getVisibleBounds({ top: -4, right: 'wide', bottom: null }), [[west, south], [east, north]]);

    // Panels on three sides of the 1440 × 900 map: the box of the rectangle between them.
    const insets = { top: 56, right: 320, bottom: 48, left: 0 };
    const visible = engine.getVisibleBounds(insets);
    expect(visible[0][0]).toBeCloseTo(west, 9);
    expect(map.project([visible[1][0], 18.5674]).x).toBeCloseTo(1440 - 320, 6);
    expect(map.project([-68.3634, visible[1][1]]).y).toBeCloseTo(56, 6);
    expect(map.project([-68.3634, visible[0][1]]).y).toBeCloseTo(900 - 48, 6);
    // What lies under the right panel is not in sight; what is next to it is.
    const underPanel = map.unproject([1300, 450]);
    const beside = map.unproject([1100, 450]);
    expect(underPanel.lng > visible[1][0] && underPanel.lng < east).toBe(true);
    expect(beside.lng < visible[1][0]).toBe(true);
    // The insets are read as setInsets reads them and do not move the camera.
    expect(map.cameraCalls).toEqual([]);

    // Insets that cover the map, or a map without a size, leave nothing in sight.
    expect(engine.getVisibleBounds({ left: 800, right: 700 })).toBeNull();
    expect(engine.getVisibleBounds({ top: 450, bottom: 450 })).toBeNull();
    state.resize(map, { width: 0 });
    expect(engine.getVisibleBounds()).toBeNull();
    state.resize(map, { width: 1440 });

    // Tilted, a corner above the horizon has no ground: unproject answers a point far away, and the box stops at
    // getBounds, which MapLibre cuts at the horizon.
    const ground = map.unproject.bind(map);
    vi.spyOn(map, 'unproject').mockImplementation(point => (point[1] < 100 ? new fake.module.LngLat(-60, 40) : ground(point)));
    const tilted = engine.getVisibleBounds({ top: 10 });
    expect(tilted[1][0]).toBeCloseTo(east, 9);
    expect(tilted[1][1]).toBeCloseTo(north, 9);
    expect(tilted[0][0]).toBeCloseTo(west, 9);

    engine.destroy();
    expect(engine.getVisibleBounds(insets)).toBeNull();
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
