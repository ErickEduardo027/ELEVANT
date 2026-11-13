// A recording stand-in for the `maplibre-gl` module, shared by the map tests (design I2 of the OCC maps).
//
// It reproduces what the OCC map code relies on in MapLibre 6.16, and it is stricter than MapLibre wherever a mistake
// would otherwise pass unnoticed:
// - `new Map()` throws until the served worker URL is set, and throws `constructorError` when one is given;
// - style calls throw before `style.load` ("Style is not done loading.", as MapLibre does) and while the WebGL context
//   is lost (MapLibre then has no style at all);
// - a layer-scoped listener (`map.on(type, layerId, fn)`) throws: MapLibre 6.16 does not restore those after a context
//   loss or a worker restart, so the OCC maps listen on the map and read features with queryRenderedFeatures;
// - adding a layer twice or before a missing layer, querying a missing layer, and passing the query point as a plain
//   object (MapLibre would read it as the options) throw.
// Camera moves are applied at once and fire `moveend` synchronously.
//
// Engine tests create one fake per test and inject `module`. Component tests share one fake through vi.mock:
//   vi.mock('maplibre-gl', async () => (await import('<path>/tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

// The path the worker is served from (scripts/copy-maplibre-worker.mjs).
export const SERVED_WORKER_URL = '/assets/maplibre/maplibre-gl-worker.mjs';

const TILE_SIZE = 512;
const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** What the MapLibre constructor throws when the browser cannot create a WebGL2 context. */
export class GPUInitializationError extends Error {
  constructor(message = 'Failed to initialize WebGL2') {
    super(message);
    this.name = 'GPUInitializationError';
  }
}

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

class FakeLngLat {
  constructor(lng, lat) {
    this.lng = lng;
    this.lat = lat;
  }

  toArray() {
    return [this.lng, this.lat];
  }

  static convert(input) {
    if (input instanceof FakeLngLat) return input;
    if (Array.isArray(input)) return new FakeLngLat(input[0], input[1]);
    if (input && typeof input === 'object' && 'lng' in input) return new FakeLngLat(input.lng, input.lat);
    if (input && typeof input === 'object' && 'lon' in input) return new FakeLngLat(input.lon, input.lat);
    throw new TypeError(`Not a LngLatLike: ${JSON.stringify(input)}`);
  }
}

class FakeLngLatBounds {
  constructor(sw, ne) {
    this._sw = sw === undefined ? null : FakeLngLat.convert(sw);
    this._ne = ne === undefined ? null : FakeLngLat.convert(ne);
  }

  extend(input) {
    const points = input instanceof FakeLngLatBounds ? [input._sw, input._ne] : [FakeLngLat.convert(input)];
    for (const point of points) {
      if (this._sw === null) {
        this._sw = new FakeLngLat(point.lng, point.lat);
        this._ne = new FakeLngLat(point.lng, point.lat);
      } else {
        this._sw = new FakeLngLat(Math.min(this._sw.lng, point.lng), Math.min(this._sw.lat, point.lat));
        this._ne = new FakeLngLat(Math.max(this._ne.lng, point.lng), Math.max(this._ne.lat, point.lat));
      }
    }
    return this;
  }

  getWest() { return this._sw.lng; }

  getSouth() { return this._sw.lat; }

  getEast() { return this._ne.lng; }

  getNorth() { return this._ne.lat; }

  toArray() {
    return [this._sw.toArray(), this._ne.toArray()];
  }
}

// [[west, south], [east, north]] from a LngLatBounds, a pair of corners or [west, south, east, north].
function boundsCorners(bounds) {
  if (typeof bounds?.toArray === 'function') return bounds.toArray();
  if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)) {
    return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
  }
  if (Array.isArray(bounds) && bounds.length === 2) return bounds.map(corner => FakeLngLat.convert(corner).toArray());
  throw new TypeError(`Not a LngLatBoundsLike: ${JSON.stringify(bounds)}`);
}

function paddingOf(padding) {
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding };
  return { top: 0, right: 0, bottom: 0, left: 0, ...padding };
}

function featureKey({ source, sourceLayer, id }) {
  return `${source}\u0000${sourceLayer ?? ''}\u0000${typeof id}:${id}`;
}

class FakeControl {
  constructor(options = {}) {
    this.options = options;
    this.map = null;
    this.element = null;
  }

  onAdd(map) {
    this.map = map;
    this.element = document.createElement('div');
    this.element.className = `maplibregl-ctrl ${this.constructor.controlClass}`;
    return this.element;
  }

  onRemove() {
    this.element?.remove();
    this.map = null;
  }
}

class FakeNavigationControl extends FakeControl {
  static controlClass = 'maplibregl-ctrl-group';
}

class FakeScaleControl extends FakeControl {
  static controlClass = 'maplibregl-ctrl-scale';
}

class FakeAttributionControl extends FakeControl {
  static controlClass = 'maplibregl-ctrl-attrib';

  getDefaultPosition() {
    return 'bottom-right';
  }

  // The <details> of MapLibre 6.16: a compact attribution with content is added open and «shown»; an attribution
  // without content is marked empty.
  onAdd(map) {
    this.map = map;
    const details = document.createElement('details');
    details.className = 'maplibregl-ctrl maplibregl-ctrl-attrib';
    const summary = document.createElement('summary');
    summary.className = 'maplibregl-ctrl-attrib-button';
    const inner = document.createElement('div');
    inner.className = 'maplibregl-ctrl-attrib-inner';
    const texts = [this.options.customAttribution].flat().filter(text => typeof text === 'string' && text.trim() !== '');
    this.attribution = texts.join(' | ');
    inner.textContent = this.attribution;
    details.append(summary, inner);
    if (texts.length === 0) details.classList.add('maplibregl-attrib-empty');
    else if (this.options.compact !== false) {
      details.setAttribute('open', '');
      details.classList.add('maplibregl-compact', 'maplibregl-compact-show');
    } else details.setAttribute('open', '');
    this.element = details;
    return details;
  }
}

function createState({ constructorError = null, width = 1440, height = 900, expansionZoom = 16 } = {}) {
  return {
    workerUrl: null,
    prewarmCount: 0,
    now: null,
    calls: [],
    maps: [],
    constructorError,
    size: { width, height },
    expansionZoom,
  };
}

function createModule(state) {
  function createSource(map, id, spec) {
    return {
      id,
      type: spec.type,
      spec,
      data: spec.data ?? null,
      setDataCalls: [],
      updateDataCalls: [],
      clusterOptions: spec.type === 'geojson'
        ? { cluster: spec.cluster === true, clusterMaxZoom: spec.clusterMaxZoom, clusterRadius: spec.clusterRadius }
        : null,
      clusterOptionCalls: [],
      expansionZoom: state.expansionZoom,
      expansionZoomCalls: [],
      setData(data) {
        map._record('setData', [id, data]);
        this.data = data;
        this.setDataCalls.push(data);
        return Promise.resolve();
      },
      updateData(diff) {
        map._record('updateData', [id, diff]);
        this.updateDataCalls.push(diff);
        return Promise.resolve();
      },
      setClusterOptions(options) {
        map._record('setClusterOptions', [id, options]);
        this.clusterOptions = { ...this.clusterOptions, ...options };
        this.clusterOptionCalls.push(options);
        return Promise.resolve();
      },
      getClusterOptions() {
        return { ...this.clusterOptions };
      },
      // MapLibre 6 answers with a promise; the callback form of earlier versions is gone.
      getClusterExpansionZoom(clusterId) {
        this.expansionZoomCalls.push(clusterId);
        return Promise.resolve(this.expansionZoom);
      },
    };
  }

  const normalizeLayer = layer => ({ ...layer, layout: { ...layer.layout }, paint: { ...layer.paint } });

  class FakeMap {
    constructor(options = {}) {
      state.calls.push({ fn: 'Map', args: [options] });
      if (state.workerUrl !== SERVED_WORKER_URL) {
        throw new Error(`MapLibre worker URL must be configured before creating a map (it is ${state.workerUrl})`);
      }
      if (state.constructorError) throw state.constructorError;
      const { container } = options;
      if (!(container instanceof HTMLElement)) throw new TypeError("Invalid type: 'container' must be an HTMLElement.");

      this.options = options;
      this.container = container;
      this.removed = false;
      this.styleLoaded = false;
      this.contextLost = false;
      this.pendingStyle = options.style ?? null;
      this.snapshot = null;
      this.calls = [];
      this.sources = new Map();
      this.layers = [];
      this.paintCalls = [];
      this.layoutCalls = [];
      this.zoomRangeCalls = [];
      this.featureStates = new Map();
      this.cameraCalls = [];
      this.controls = [];
      this.padding = { top: 0, right: 0, bottom: 0, left: 0 };
      this.styleCalls = [];
      this.images = new Map();
      this.missingImageResolver = null;
      this.listeners = new Map();
      this.renderedFeatures = () => [];

      // The DOM of MapLibre's _setupContainer: a canvas and the four control corners inside the container.
      container.classList.add('maplibregl-map');
      this.canvasContainer = document.createElement('div');
      this.canvasContainer.className = 'maplibregl-canvas-container';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'maplibregl-canvas';
      this.canvasContainer.append(this.canvas);
      this.controlContainer = document.createElement('div');
      this.controlContainer.className = 'maplibregl-control-container';
      this.controlPositions = Object.fromEntries(POSITIONS.map(position => {
        const corner = document.createElement('div');
        corner.className = `maplibregl-ctrl-${position}`;
        this.controlContainer.append(corner);
        return [position, corner];
      }));
      container.append(this.canvasContainer, this.controlContainer);

      this.camera = { center: new FakeLngLat(0, 0), zoom: 0, bearing: 0, pitch: 0 };
      this._setCamera(options);
      if (options.bounds) this._setCamera(this.cameraForBounds(options.bounds, options.fitBoundsOptions));
      state.maps.push(this);
    }

    _record(method, args) {
      this.calls.push({ method, args });
    }

    _fire(type, payload = {}) {
      const event = { type, target: this, ...payload };
      for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    }

    // Style calls need a loaded style, as in MapLibre; after a context loss MapLibre has no style object at all.
    _requireStyle() {
      if (this.removed) throw new Error('The map was removed.');
      if (this.contextLost) throw new TypeError("Cannot read properties of null (reading 'style')");
      if (!this.styleLoaded) throw new Error('Style is not done loading.');
    }

    _readStyle() {
      if (this.contextLost) throw new TypeError("Cannot read properties of null (reading 'style')");
      return this.styleLoaded;
    }

    _installStyle(style) {
      this.sources = new Map(Object.entries(style?.sources ?? {})
        .map(([id, spec]) => [id, createSource(this, id, clone(spec))]));
      this.layers = clone(style?.layers ?? []).map(normalizeLayer);
      this.styleLoaded = true;
    }

    _layer(id) {
      const layer = this.layers.find(item => item.id === id);
      if (!layer) throw new Error(`The layer '${id}' does not exist in the map's style.`);
      return layer;
    }

    _setCamera({ center, zoom, bearing, pitch }) {
      if (center !== undefined) this.camera.center = FakeLngLat.convert(center);
      if (zoom !== undefined) {
        this.camera.zoom = Math.min(Math.max(zoom, this.options.minZoom ?? 0), this.options.maxZoom ?? 22);
      }
      if (bearing !== undefined) this.camera.bearing = bearing;
      if (pitch !== undefined) this.camera.pitch = Math.min(Math.max(pitch, 0), this.options.maxPitch ?? 60);
    }

    _move(method, options, camera = options) {
      this._record(method, [options]);
      this.cameraCalls.push({ method, options });
      if (camera.padding !== undefined) this.padding = paddingOf(camera.padding);
      this._setCamera(camera);
      this._fire('movestart', { originalEvent: options?.originalEvent });
      this._fire('moveend', { originalEvent: options?.originalEvent });
      return this;
    }

    // Events.
    on(type, layerOrListener, listener) {
      if (typeof layerOrListener !== 'function' || listener !== undefined) {
        throw new Error(`map.on('${type}', '${layerOrListener}', …) is a layer-scoped listener: MapLibre 6.16 does not `
          + 'restore those after a context loss or a worker restart. Listen on the map and use queryRenderedFeatures.');
      }
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(layerOrListener);
      return this;
    }

    off(type, listener) {
      this.listeners.get(type)?.delete(listener);
      return this;
    }

    once(type, listener) {
      const wrapper = event => {
        this.off(type, wrapper);
        listener(event);
      };
      return this.on(type, wrapper);
    }

    listenerCount(type) {
      if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
      return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
    }

    // Sources and layers.
    addSource(id, spec) {
      this._requireStyle();
      this._record('addSource', [id, spec]);
      if (this.sources.has(id)) throw new Error(`There is already a source with ID "${id}".`);
      this.sources.set(id, createSource(this, id, clone(spec)));
      return this;
    }

    getSource(id) {
      return this._readStyle() ? this.sources.get(id) : undefined;
    }

    removeSource(id) {
      this._requireStyle();
      this._record('removeSource', [id]);
      this.sources.delete(id);
      return this;
    }

    addLayer(layer, beforeId) {
      this._requireStyle();
      this._record('addLayer', [layer.id, beforeId]);
      if (this.layers.some(item => item.id === layer.id)) throw new Error(`Layer "${layer.id}" already exists on this map.`);
      if (layer.type !== 'custom' && typeof layer.source === 'string' && !this.sources.has(layer.source)) {
        throw new Error(`Source "${layer.source}" not found for layer "${layer.id}".`);
      }
      const record = layer.type === 'custom' ? layer : normalizeLayer(clone(layer));
      if (beforeId === undefined) this.layers.push(record);
      else {
        const index = this.layers.findIndex(item => item.id === beforeId);
        if (index < 0) throw new Error(`Cannot add layer "${layer.id}" before non-existing layer "${beforeId}".`);
        this.layers.splice(index, 0, record);
      }
      if (layer.type === 'custom') layer.onAdd?.(this, null);
      return this;
    }

    getLayer(id) {
      return this._readStyle() ? this.layers.find(layer => layer.id === id) : undefined;
    }

    removeLayer(id) {
      this._requireStyle();
      this._record('removeLayer', [id]);
      const layer = this._layer(id);
      this.layers = this.layers.filter(item => item !== layer);
      if (layer.type === 'custom') layer.onRemove?.(this, null);
      return this;
    }

    layerIds() {
      return this.layers.map(layer => layer.id);
    }

    setLayoutProperty(id, name, value) {
      this._requireStyle();
      this._record('setLayoutProperty', [id, name, value]);
      this._layer(id).layout[name] = value;
      this.layoutCalls.push({ id, name, value });
      return this;
    }

    getLayoutProperty(id, name) {
      this._requireStyle();
      return this._layer(id).layout?.[name];
    }

    setPaintProperty(id, name, value) {
      this._requireStyle();
      this._record('setPaintProperty', [id, name, value]);
      this._layer(id).paint[name] = value;
      this.paintCalls.push({ id, name, value });
      return this;
    }

    setLayerZoomRange(id, minzoom, maxzoom) {
      this._requireStyle();
      this._record('setLayerZoomRange', [id, minzoom, maxzoom]);
      const layer = this._layer(id);
      layer.minzoom = minzoom;
      layer.maxzoom = maxzoom;
      this.zoomRangeCalls.push({ id, minzoom, maxzoom });
      return this;
    }

    // Feature state.
    setFeatureState(target, featureState) {
      this._requireStyle();
      this._record('setFeatureState', [target, featureState]);
      if (!this.sources.has(target.source)) throw new Error(`The source '${target.source}' does not exist in the map's style.`);
      if (target.id === undefined) throw new Error('The feature id parameter must be provided.');
      const key = featureKey(target);
      this.featureStates.set(key, { ...this.featureStates.get(key), ...featureState });
      return this;
    }

    removeFeatureState(target, key) {
      this._requireStyle();
      this._record('removeFeatureState', [target, key]);
      if (target.id === undefined) {
        const prefix = `${target.source}\u0000`;
        for (const stateKey of [...this.featureStates.keys()]) {
          if (stateKey.startsWith(prefix)) this.featureStates.delete(stateKey);
        }
      } else if (key === undefined) this.featureStates.delete(featureKey(target));
      else {
        const current = this.featureStates.get(featureKey(target));
        if (current) delete current[key];
      }
      return this;
    }

    getFeatureState(target) {
      return this.featureStates.get(featureKey(target)) ?? {};
    }

    featureStateOf(source, id) {
      return this.featureStates.get(featureKey({ source, id }));
    }

    queryRenderedFeatures(geometry, options = {}) {
      this._record('queryRenderedFeatures', [geometry, options]);
      if (geometry !== undefined && !Array.isArray(geometry)) {
        throw new TypeError('Pass the query geometry as [x, y] or [[x1, y1], [x2, y2]]: MapLibre reads a plain object as '
          + 'the options.');
      }
      if (this.contextLost || !this.styleLoaded) return [];
      for (const id of options.layers ?? []) {
        if (!this.layers.some(layer => layer.id === id)) {
          throw new Error(`The layer '${id}' does not exist in the map's style and cannot be queried for features.`);
        }
      }
      return this.renderedFeatures(geometry, options) ?? [];
    }

    // Images.
    addImage(id, image, options = {}) {
      this._record('addImage', [id, options]);
      if (this.images.has(id)) throw new Error(`An image named "${id}" already exists.`);
      this.images.set(id, { image, options });
      return this;
    }

    hasImage(id) {
      return this.images.has(id);
    }

    removeImage(id) {
      this.images.delete(id);
      return this;
    }

    setMissingStyleImageResolver(resolver) {
      this._record('setMissingStyleImageResolver', [resolver]);
      this.missingImageResolver = resolver;
      return this;
    }

    // Controls.
    addControl(control, position = control.getDefaultPosition?.() ?? 'top-right') {
      this._record('addControl', [control, position]);
      const element = control.onAdd(this);
      this.controls.push({ control, position });
      const corner = this.controlPositions[position];
      if (position.includes('bottom')) corner.insertBefore(element, corner.firstChild);
      else corner.append(element);
      return this;
    }

    removeControl(control) {
      this._record('removeControl', [control]);
      const index = this.controls.findIndex(entry => entry.control === control);
      if (index >= 0) {
        this.controls.splice(index, 1);
        control.onRemove(this);
      }
      return this;
    }

    hasControl(control) {
      return this.controls.some(entry => entry.control === control);
    }

    // Camera.
    jumpTo(options = {}) {
      return this._move('jumpTo', options);
    }

    easeTo(options = {}) {
      return this._move('easeTo', options);
    }

    flyTo(options = {}) {
      return this._move('flyTo', options);
    }

    fitBounds(bounds, options = {}) {
      const camera = this.cameraForBounds(bounds, options);
      return this._move('fitBounds', { bounds: boundsCorners(bounds), ...options }, camera);
    }

    // Deterministic: the zoom at which the width of the bounds fills the fake width (1440 px unless given), less the
    // horizontal padding. It ignores the latitude and the height of the bounds.
    cameraForBounds(bounds, options = {}) {
      const [[west, south], [east, north]] = boundsCorners(bounds);
      const padding = paddingOf(options.padding);
      const width = Math.max(1, state.size.width - padding.left - padding.right);
      const boundsWidthAtZoomZero = (TILE_SIZE * Math.max(east - west, 1e-9)) / 360;
      const zoom = Math.min(Math.log2(width / boundsWidthAtZoomZero), options.maxZoom ?? this.options.maxZoom ?? 22);
      return { center: new FakeLngLat((west + east) / 2, (south + north) / 2), zoom, bearing: options.bearing ?? 0 };
    }

    setPadding(padding) {
      this._record('setPadding', [padding]);
      this.cameraCalls.push({ method: 'setPadding', options: padding });
      this.padding = paddingOf(padding);
      this._fire('movestart');
      this._fire('moveend');
      return this;
    }

    getPadding() {
      return { ...this.padding };
    }

    getCenter() {
      return new FakeLngLat(this.camera.center.lng, this.camera.center.lat);
    }

    getZoom() {
      return this.camera.zoom;
    }

    getBearing() {
      return this.camera.bearing;
    }

    getPitch() {
      return this.camera.pitch;
    }

    // Web Mercator around the current centre, in pixels of the fake viewport.
    project(lngLat) {
      const scale = TILE_SIZE * 2 ** this.camera.zoom;
      const toPixels = ({ lng, lat }) => {
        const sin = Math.sin((lat * Math.PI) / 180);
        return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
      };
      const centre = toPixels(this.camera.center);
      const point = toPixels(FakeLngLat.convert(lngLat));
      return { x: point.x - centre.x + state.size.width / 2, y: point.y - centre.y + state.size.height / 2 };
    }

    // Everything else the OCC maps use.
    getContainer() {
      return this.container;
    }

    getCanvas() {
      return this.canvas;
    }

    getCanvasContainer() {
      return this.canvasContainer;
    }

    isStyleLoaded() {
      return this.styleLoaded && !this.contextLost;
    }

    loaded() {
      return this.isStyleLoaded();
    }

    getStyle() {
      return {
        version: 8,
        sources: Object.fromEntries([...this.sources].map(([id, source]) => [id, { ...source.spec, data: source.data }])),
        layers: this.layers.filter(layer => layer.type !== 'custom').map(clone),
      };
    }

    // Recorded only: the OCC maps never swap the style after start.
    setStyle(style, options) {
      this._record('setStyle', [style, options]);
      this.styleCalls.push({ style, options });
      return this;
    }

    resize() {
      this._record('resize', []);
      return this;
    }

    triggerRepaint() {
      this._record('triggerRepaint', []);
    }

    remove() {
      if (this.removed) return;
      this._record('remove', []);
      for (const { control } of [...this.controls]) control.onRemove(this);
      this.controls = [];
      this.canvasContainer.remove();
      this.controlContainer.remove();
      this.container.classList.remove('maplibregl-map');
      this.removed = true;
      this._fire('remove');
    }
  }

  return {
    Map: FakeMap,
    NavigationControl: FakeNavigationControl,
    ScaleControl: FakeScaleControl,
    AttributionControl: FakeAttributionControl,
    LngLat: FakeLngLat,
    LngLatBounds: FakeLngLatBounds,
    GPUInitializationError,
    setWorkerUrl(url) {
      state.calls.push({ fn: 'setWorkerUrl', args: [url] });
      state.workerUrl = url;
    },
    getWorkerUrl() {
      return state.workerUrl;
    },
    prewarm() {
      state.calls.push({ fn: 'prewarm', args: [] });
      state.prewarmCount += 1;
    },
    setNow(timestamp) {
      state.calls.push({ fn: 'setNow', args: [timestamp] });
      state.now = timestamp;
    },
    restoreNow() {
      state.calls.push({ fn: 'restoreNow', args: [] });
      state.now = null;
    },
  };
}

function addHelpers(state) {
  return Object.assign(state, {
    liveMaps() {
      return state.maps.filter(map => !map.removed);
    },

    // Fires an event on a map. The first `style.load` installs the style given to the constructor, and the one after
    // a context restore installs the snapshot, as MapLibre loads a style before it announces it.
    emit(map, type, payload = {}) {
      if (type === 'style.load' && !map.styleLoaded && !map.contextLost) map._installStyle(map.pendingStyle);
      map._fire(type, payload);
    },

    // What queryRenderedFeatures answers: `resolver(geometry, options)` returns the features.
    setRenderedFeatures(map, resolver) {
      map.renderedFeatures = resolver;
    },

    // MapLibre asking for an image that the style names and the map does not have.
    requestImage(map, id) {
      if (!map.hasImage(id)) map.missingImageResolver?.(id);
      return map.images.get(id) ?? null;
    },

    // MapLibre 6.16 on a lost WebGL context: it keeps a snapshot of the style (sources with their data, layers with
    // their layout, paint and zoom ranges, images), drops the style, and loses custom layers and feature state.
    loseContext(map) {
      map.snapshot = {
        version: 8,
        sources: Object.fromEntries([...map.sources].map(([id, source]) => [id, { ...source.spec, data: source.data }])),
        layers: map.layers.filter(layer => layer.type !== 'custom').map(clone),
      };
      map.sources = new Map();
      map.layers = [];
      map.featureStates.clear();
      map.styleLoaded = false;
      map.contextLost = true;
      map._fire('webglcontextlost');
    },

    // ...and on its restore: the snapshot becomes the style to load, which happens after the event, on the next
    // `style.load` (call `emit(map, 'style.load')`).
    restoreContext(map) {
      map.contextLost = false;
      map.pendingStyle = map.snapshot;
      map._fire('webglcontextrestored');
    },

    // A worker restart fires the same synthetic pair.
    restartWorkers(map) {
      state.loseContext(map);
      state.restoreContext(map);
    },

    // Forgets the maps and the recorded calls. The worker URL stays set: like in MapLibre it is configuration of the
    // page, and the engine sets it once per module.
    reset({ constructorError = null } = {}) {
      state.maps.length = 0;
      state.calls.length = 0;
      state.prewarmCount = 0;
      state.now = null;
      state.constructorError = constructorError;
    },
  });
}

/** A fresh fake: `module` stands for `maplibre-gl`, `state` records what the code under test did with it. */
export function createFakeMapLibre(options = {}) {
  const state = addHelpers(createState(options));
  return { module: createModule(state), state };
}

let shared = null;

/** One fake per test file for vi.mock('maplibre-gl'); call `state.reset()` between tests. */
export function sharedFakeMapLibre() {
  shared ??= createFakeMapLibre();
  return shared;
}
