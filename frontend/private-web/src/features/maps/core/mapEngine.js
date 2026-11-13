import { BASEMAP_SOURCE_ID, SLOT_GROUP, nextSlot, slotMarkerId } from '../style/occStyle';
import { collapseCompactAttribution } from './attribution';
import { ensureWorkerUrl } from './workerUrl';

// The only module of the OCC maps that constructs a MapLibre Map (design A2). Everything a screen draws is declared in
// the style document (style/occStyle.js); the engine is the thin imperative shell around it:
// - it owns its container, created inside the host, so a StrictMode double mount never reuses a div;
// - only a throwing constructor, or a WebGL context that comes back without WebGL2, is fatal (`unavailable`, which is
//   terminal: the map is gone and the screen shows its fallback); the map is `ready` on `style.load`, because the
//   airfield and the stands are own data and work without the base map, whose health is reported apart (`degraded`
//   is a chip);
// - calls that need the style (data, feature state, visibility, zoom ranges, clusters, custom layers) wait until it
//   has loaded and then run in the order they were made;
// - after a WebGL context loss or a worker restart MapLibre 6.16 rebuilds the style with its data and images, but not
//   the custom layers or the feature state: the engine puts those back;
// - listeners are map-level only and read features with queryRenderedFeatures (MapLibre 6.16 does not restore
//   layer-scoped listeners);
// - the style is never swapped after start: there is no setStyle anywhere (noSetStyle.test.js).

/** How long the vector base map may go without a first tile before the engine reports it degraded. */
export const BASEMAP_TIMEOUT_MS = 8000;

const PICK_TOLERANCE_PX = 4;
const CLUSTER_EASE_MS = 500;
const INSET_SIDES = ['top', 'right', 'bottom', 'left'];
const ATTRIBUTION_SELECTOR = 'details.maplibregl-ctrl-attrib';

let liveEngines = 0;

/** How many engines hold a live map right now (a StrictMode double mount must leave exactly one). */
export function liveEngineCount() {
  return liveEngines;
}

function cameraOptions(camera) {
  if (!camera) return {};
  if (camera.bounds) {
    return camera.padding === undefined
      ? { bounds: camera.bounds }
      : { bounds: camera.bounds, fitBoundsOptions: { padding: camera.padding } };
  }
  const { center, zoom, bearing, pitch } = camera;
  return Object.fromEntries(Object.entries({ center, zoom, bearing, pitch }).filter(([, value]) => value !== undefined));
}

const isGpuError = (maplibre, error) =>
  typeof maplibre.GPUInitializationError === 'function' && error instanceof maplibre.GPUInitializationError;

const normalizeInsets = insets =>
  Object.fromEntries(INSET_SIDES.map(side => [side, Math.max(0, Number(insets?.[side]) || 0)]));

const stateKey = (source, id) => `${source}\u0000${typeof id}:${String(id)}`;

/**
 * Creates the map inside `host`.
 *
 * @param {object} options
 * @param {object} options.maplibre the `maplibre-gl` module (injected: tests pass tests/fakeMapLibre.js).
 * @param {HTMLElement} options.host the element the engine puts its own container in.
 * @param {object} options.style the StyleSpecification from buildOccStyle().
 * @param {object} [options.camera] `{ center, zoom, bearing, pitch }` or `{ bounds, padding }`.
 * @param {boolean} [options.interactive=true]
 * @param {string|string[]} [options.attribution] the custom attribution of the compact control.
 * @param {(id: string) => object|null} [options.imageResolver] images the style names (style/mapImages.js).
 * @param {object} [options.mapOptions] extra MapLibre options, applied last (the map lab passes `fadeDuration: 0`).
 * @param {(status: object) => void} [options.onStatus] `{ engine: 'starting'|'ready'|'unavailable', basemap:
 *   'off'|'loading'|'ok'|'degraded', reason: null|'webgl'|'error' }`, on every change. `unavailable` comes with
 *   `basemap: 'off'` and is the last status reported: the map never started, or the engine removed it when its WebGL
 *   context came back without WebGL2.
 * @param {(camera: object, details: { byUser: boolean }) => void} [options.onCamera] after every move.
 * @param {() => void} [options.onIdle] after every frame MapLibre draws with nothing left to load, place or move (its
 *   `idle` event): what renderedFeatures answers is then final, as the tiles of a new zoom have loaded.
 * @param {() => void} [options.onResize] after MapLibre has resized the map to its container (the fitted zooms change).
 * @param {(event: object) => void} [options.onClick] `{ point, lngLat, hit }`, `hit` as pickAt answers.
 * @param {(event: object|null) => void} [options.onPointerMove] the same while the pointer moves, `null` when it
 *   leaves; its `hit` is picked when first read, so a caller that reads it once per frame picks once per frame.
 */
export function createMapEngine({
  maplibre, host, style, camera, interactive = true, attribution, imageResolver, mapOptions,
  onStatus, onCamera, onIdle, onResize, onClick, onPointerMove,
} = {}) {
  if (!maplibre) throw new TypeError('createMapEngine needs the maplibre-gl module');
  if (!host?.ownerDocument) throw new TypeError('createMapEngine needs a host element');

  const container = host.ownerDocument.createElement('div');
  container.className = 'occ-map-engine';
  container.style.width = '100%';
  container.style.height = '100%';
  for (const side of INSET_SIDES) container.style.setProperty(`--occ-map-inset-${side}`, '0px');
  host.append(container);

  const styleLayers = new Map((style?.layers ?? []).map(layer => [layer.id, layer]));
  const pickableLayerIds = [...styleLayers.values()].filter(layer => layer.metadata?.['occ:pick']).map(layer => layer.id);
  const hasBasemap = Boolean(style?.sources?.[BASEMAP_SOURCE_ID]);

  let status = { engine: 'starting', basemap: hasBasemap ? 'loading' : 'off', reason: null };
  let map = null;
  let destroyed = false;
  let styleReady = false;
  let loadedOnce = false;
  let pending = [];
  let basemapTimer = null;
  let attributionControl = null;
  let scaleControl = null;
  let customAttribution = attribution;
  let attributionPristine = true;
  const listeners = [];
  const customLayers = new Map();
  const featureStates = new Map();
  const idleWaiters = new Set();

  // Every status change goes through here, and `unavailable` is terminal: once a map could not start or lost WebGL for
  // good, nothing changes the status again or brings back `ready`.
  function report(patch) {
    if (status.engine === 'unavailable') return;
    const next = { ...status, ...patch };
    if (next.engine === status.engine && next.basemap === status.basemap && next.reason === status.reason) return;
    status = next;
    if (!destroyed) onStatus?.({ ...status });
  }

  const live = () => map !== null && !destroyed;

  // Runs a call that needs the style now, or keeps it for when the style has loaded. `drop` settles a caller that
  // waits for the call when the map goes first (destroyed or unavailable).
  function whenStyleReady(run, drop) {
    if (!live()) {
      drop?.();
      return;
    }
    if (styleReady) run();
    else pending.push({ run, drop });
  }

  // Runs inside MapLibre's style.load, whose loader swallows exceptions: one failing call must neither hide the
  // others nor the ready status, so each failure is traced and the rest go on.
  function runWhileLoading(run) {
    try {
      run();
    } catch (error) {
      console.error('An OCC map call failed after the style loaded.', error);
    }
  }

  function flushPending() {
    const calls = pending;
    pending = [];
    for (const { run } of calls) runWhileLoading(run);
  }

  function clearBasemapTimer() {
    if (basemapTimer !== null) clearTimeout(basemapTimer);
    basemapTimer = null;
  }

  // Settles every call that waits for the style and every wait for an idle frame as never happening, then removes the
  // map. The engine's listeners go first, so nothing the map fires while it goes reaches the engine.
  function releaseMap() {
    const dropped = pending;
    pending = [];
    for (const { drop } of dropped) drop?.();
    if (map === null) return;
    const removed = map;
    map = null;
    liveEngines -= 1;
    for (const waiter of idleWaiters) {
      removed.off('idle', waiter.onIdle);
      waiter.settle(false);
    }
    idleWaiters.clear();
    for (const [type, handler] of listeners) removed.off(type, handler);
    listeners.length = 0;
    removed.remove();
  }

  // MapLibre 6.16 rebuilds the style before it creates its painter again. When the WebGL context comes back without
  // WebGL2 it fires `error` with a GPUInitializationError instead of `webglcontextrestored`, and the rebuilt style would
  // still load on a later frame and then render with the painter it lost, which throws on every frame. Such a map can
  // never draw again: the engine reports it unavailable, as it reports a constructor without WebGL2, and removes it at
  // once, as MapLibre's constructor cleans up after the same error. The rebuilt style never loads, no canvas or control
  // is left under the screen's fallback, and later calls are dropped as after destroy().
  function becomeUnavailable(reason) {
    if (!live()) return;
    clearBasemapTimer();
    report({ engine: 'unavailable', basemap: 'off', reason });
    releaseMap();
  }

  function beforeIdFor(slot) {
    const next = nextSlot(slot);
    if (next === null) return undefined;
    const marker = slotMarkerId(next);
    return map.getLayer(marker) ? marker : undefined;
  }

  function addCustomLayerNow(id) {
    const entry = customLayers.get(id);
    if (!entry || map.getLayer(id)) return;
    map.addLayer(entry.layer, beforeIdFor(entry.slot));
  }

  function applyFeatureState(source, id, state) {
    if (map.getSource(source)) map.setFeatureState({ source, id }, state);
  }

  // What MapLibre does not keep through a context loss or a worker restart.
  function restoreRuntimeState() {
    for (const id of customLayers.keys()) runWhileLoading(() => addCustomLayerNow(id));
    for (const { source, id, state } of featureStates.values()) runWhileLoading(() => applyFeatureState(source, id, state));
  }

  function markStyleReady({ restore }) {
    // A style that loads once the map is gone (unavailable or destroyed) puts nothing back and runs nothing.
    if (!live()) return;
    styleReady = true;
    if (restore) restoreRuntimeState();
    flushPending();
    report({ engine: 'ready' });
  }

  // MapLibre opens a compact attribution with content as soon as it is added, and again when its content first
  // arrives. Keep it closed until the person opens it.
  function keepAttributionClosed() {
    if (attributionPristine) collapseCompactAttribution(container);
  }

  // Bottom-right corner: MapLibre stacks a later bottom control above the earlier ones, so the attribution goes first
  // and keeps the corner, with the scale above it.
  function addBottomControls() {
    attributionControl = new maplibre.AttributionControl({ compact: true, customAttribution });
    map.addControl(attributionControl, 'bottom-right');
    scaleControl = new maplibre.ScaleControl({ unit: 'nautical' });
    map.addControl(scaleControl, 'bottom-right');
    attributionPristine = true;
    container.querySelector(`${ATTRIBUTION_SELECTOR} > summary`)?.addEventListener('click', () => {
      attributionPristine = false;
    }, { once: true });
    keepAttributionClosed();
  }

  function readCamera() {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }

  // The rectangle of the canvas that `insets` leave in sight, `[[left, top], [right, bottom]]` in pixels from its
  // top-left corner, or null when they leave no room (or the map has no size).
  function areaInSight(insets) {
    const { top, right, bottom, left } = normalizeInsets(insets);
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!(width - left - right > 0) || !(height - top - bottom > 0)) return null;
    return [[left, top], [width - right, height - bottom]];
  }

  function pickAt(point) {
    if (!live() || !styleReady || point == null) return null;
    const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
    const layers = pickableLayerIds.filter(id => map.getLayer(id));
    if (layers.length === 0) return null;
    const box = [[x - PICK_TOLERANCE_PX, y - PICK_TOLERANCE_PX], [x + PICK_TOLERANCE_PX, y + PICK_TOLERANCE_PX]];
    const [feature] = map.queryRenderedFeatures(box, { layers });
    if (!feature) return null;
    const metadata = styleLayers.get(feature.layer?.id)?.metadata ?? {};
    const idProperty = metadata['occ:pickId'];
    const id = idProperty === undefined ? feature.id : feature.properties?.[idProperty];
    return { kind: metadata['occ:pick'], id: id ?? null, feature };
  }

  function pointerEvent(event) {
    const point = event.point ? { x: event.point.x, y: event.point.y } : null;
    const lngLat = event.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null;
    return { point, lngLat, hit: point === null ? null : pickAt(point), originalEvent: event.originalEvent };
  }

  // A pointer move fires at the screen's rate: its `hit` is picked on first read, at most once.
  function pointerMoveEvent(event) {
    const point = event.point ? { x: event.point.x, y: event.point.y } : null;
    const lngLat = event.lngLat ? [event.lngLat.lng, event.lngLat.lat] : null;
    let hit;
    return Object.defineProperty({ point, lngLat, originalEvent: event.originalEvent }, 'hit', {
      enumerable: true,
      get() {
        if (hit === undefined) hit = point === null ? null : pickAt(point);
        return hit;
      },
    });
  }

  function listen(type, handler) {
    map.on(type, handler);
    listeners.push([type, handler]);
  }

  try {
    ensureWorkerUrl(maplibre);
    map = new maplibre.Map({
      attributionControl: false,
      pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      maxPitch: 65,
      minZoom: 4.5,
      maxZoom: 19.5,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: true },
      validateStyle: process.env.NODE_ENV !== 'production',
      fadeDuration: 150,
      interactive,
      ...cameraOptions(camera),
      ...mapOptions,
      container,
      style,
    });
  } catch (error) {
    const reason = isGpuError(maplibre, error) ? 'webgl' : 'error';
    // A missing WebGL2 is a fact of the browser; anything else is a fault worth a trace.
    if (reason === 'error') console.error('The OCC map could not start.', error);
    status = { engine: 'unavailable', basemap: 'off', reason };
    queueMicrotask(() => {
      if (!destroyed) onStatus?.({ ...status });
    });
  }

  if (map !== null) {
    liveEngines += 1;
    listen('style.load', () => {
      const restore = loadedOnce;
      loadedOnce = true;
      markStyleReady({ restore });
    });
    listen('webglcontextlost', () => {
      styleReady = false;
    });
    // MapLibre 6.16 rebuilds the style after this event and loads it on a later frame: restore on that style.load,
    // or now when the style is already there.
    listen('webglcontextrestored', () => {
      if (map.isStyleLoaded()) markStyleReady({ restore: true });
    });
    listen('error', event => {
      if (event?.sourceId === BASEMAP_SOURCE_ID) {
        clearBasemapTimer();
        report({ basemap: 'degraded' });
      } else if (isGpuError(maplibre, event?.error)) {
        becomeUnavailable('webgl');
      } else {
        console.error(event?.error ?? event);
      }
    });
    listen('sourcedata', event => {
      keepAttributionClosed();
      if (event?.sourceId === BASEMAP_SOURCE_ID && event.tile) {
        clearBasemapTimer();
        report({ basemap: 'ok' });
      }
    });
    listen('styledata', keepAttributionClosed);
    listen('moveend', event => {
      onCamera?.(readCamera(), { byUser: Boolean(event?.originalEvent) });
    });
    if (onIdle) listen('idle', () => onIdle());
    if (onResize) listen('resize', () => onResize());
    if (onClick) listen('click', event => onClick(pointerEvent(event)));
    if (onPointerMove) {
      listen('mousemove', event => onPointerMove(pointerMoveEvent(event)));
      listen('mouseout', () => onPointerMove(null));
    }

    if (imageResolver) {
      map.setMissingStyleImageResolver(id => {
        if (map === null || map.hasImage(id)) return;
        const image = imageResolver(id);
        if (!image) return;
        map.addImage(id, { width: image.width, height: image.height, data: image.data },
          { pixelRatio: image.pixelRatio, sdf: image.sdf });
      });
    }

    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    addBottomControls();

    if (hasBasemap) {
      basemapTimer = setTimeout(() => {
        basemapTimer = null;
        if (status.basemap === 'loading') report({ basemap: 'degraded' });
      }, BASEMAP_TIMEOUT_MS);
    }
  }

  return {
    container,

    /** The MapLibre map, or `null` when it could not start, once it is unavailable and after destroy(). */
    get map() {
      return live() ? map : null;
    },

    status: () => ({ ...status }),

    isReady: () => live() && status.engine === 'ready',

    /** Pixels covered by the page around the map: camera padding, and --occ-map-inset-* for the controls. */
    setInsets(insets) {
      const next = normalizeInsets(insets);
      for (const side of INSET_SIDES) container.style.setProperty(`--occ-map-inset-${side}`, `${next[side]}px`);
      if (live()) map.setPadding(next);
    },

    /** Shows or hides every layer of a layers-menu group (the slot markers are never shown). */
    setGroupVisibility(group, visible) {
      if (group === SLOT_GROUP) return;
      const ids = [...styleLayers.values()].filter(layer => layer.metadata?.['occ:group'] === group).map(layer => layer.id);
      whenStyleReady(() => {
        for (const id of ids) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
      });
    },

    setData(sourceId, data) {
      whenStyleReady(() => {
        map.getSource(sourceId)?.setData(data);
      });
    },

    /** Applies a GeoJSONSourceDiff; the promise settles when MapLibre has taken it (or at once without a map). */
    updateData(sourceId, diff) {
      return new Promise((resolve, reject) => {
        whenStyleReady(() => {
          const source = map.getSource(sourceId);
          if (!source) resolve();
          else Promise.resolve(source.updateData(diff)).then(resolve, reject);
        }, resolve);
      });
    },

    /** Merges `state` into a feature's state and remembers it, so it survives a context loss. */
    setFeatureState(sourceId, id, state) {
      const key = stateKey(sourceId, id);
      const entry = featureStates.get(key) ?? { source: sourceId, id, state: {} };
      entry.state = { ...entry.state, ...state };
      featureStates.set(key, entry);
      whenStyleReady(() => applyFeatureState(sourceId, id, state));
    },

    /**
     * Removes one key of a feature's state (`id` and `key`), a feature's whole state (no `key`) or every state of the
     * source (neither). A key without a feature id throws a TypeError and changes nothing: MapLibre refuses that
     * combination and removes nothing, and what the engine remembers, which it puts back after a context loss, must
     * stay what the map shows. As in MapLibre, an empty key counts as no key.
     */
    removeFeatureState(sourceId, id, key) {
      if (key && typeof id !== 'string' && typeof id !== 'number') {
        throw new TypeError(`removeFeatureState needs a feature id to remove the key "${key}", as MapLibre does`);
      }
      for (const [entryKey, entry] of featureStates) {
        if (entry.source !== sourceId || (id !== undefined && entryKey !== stateKey(sourceId, id))) continue;
        if (!key) featureStates.delete(entryKey);
        else {
          const rest = { ...entry.state };
          delete rest[key];
          entry.state = rest;
        }
      }
      whenStyleReady(() => {
        if (map.getSource(sourceId)) map.removeFeatureState(id === undefined ? { source: sourceId } : { source: sourceId, id }, key);
      });
    },

    /** Sets the zoom range of the layers whose metadata names a threshold: `{ polygons, codes, threeLine }`. */
    applyThresholds(thresholds) {
      const ranges = [];
      for (const layer of styleLayers.values()) {
        const minName = layer.metadata?.['occ:minThreshold'];
        const maxName = layer.metadata?.['occ:maxThreshold'];
        if (minName === undefined && maxName === undefined) continue;
        const minzoom = minName === undefined ? layer.minzoom ?? 0 : thresholds?.[minName];
        const maxzoom = maxName === undefined ? layer.maxzoom ?? 24 : thresholds?.[maxName];
        if (Number.isFinite(minzoom) && Number.isFinite(maxzoom)) ranges.push([layer.id, minzoom, maxzoom]);
      }
      whenStyleReady(() => {
        for (const [id, minzoom, maxzoom] of ranges) {
          if (map.getLayer(id)) map.setLayerZoomRange(id, minzoom, maxzoom);
        }
      });
    },

    setClusterOptions(sourceId, options) {
      whenStyleReady(() => {
        map.getSource(sourceId)?.setClusterOptions?.(options);
      });
    },

    cameraForBounds(bounds, options) {
      return live() ? map.cameraForBounds(bounds, options) ?? null : null;
    },

    fitBounds(bounds, options) {
      if (live()) map.fitBounds(bounds, options);
    },

    flyTo(options) {
      if (live()) map.flyTo(options);
    },

    easeTo(options) {
      if (live()) map.easeTo(options);
    },

    jumpTo(options) {
      if (live()) map.jumpTo(options);
    },

    /** `{ center: [lng, lat], zoom, bearing, pitch }`, or `null` without a map. */
    getCamera() {
      return live() ? readCamera() : null;
    },

    /** What the map shows, `[[west, south], [east, north]]` (the box around it when tilted), or `null` without a map. */
    getBounds() {
      if (!live()) return null;
      const bounds = map.getBounds();
      return [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]];
    },

    /**
     * What the map shows in the area that `insets` (`{ top, right, bottom, left }` in px, as setInsets takes them)
     * leave in sight: the box around the corners of that free rectangle, `[[west, south], [east, north]]`, or `null`
     * without a map or when the insets leave no room. The page's panels hide what lies under them. It never reaches
     * past getBounds(), which stops at the horizon of a tilted map, where unproject has no ground to answer.
     */
    getVisibleBounds(insets) {
      if (!live()) return null;
      const area = areaInSight(insets);
      if (area === null) return null;
      const [[left, top], [right, bottom]] = area;
      const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(point => map.unproject(point));
      const lngs = corners.map(corner => corner.lng);
      const lats = corners.map(corner => corner.lat);
      if (![...lngs, ...lats].every(Number.isFinite)) return null;
      const whole = map.getBounds();
      return [
        [Math.max(Math.min(...lngs), whole.getWest()), Math.max(Math.min(...lats), whole.getSouth())],
        [Math.min(Math.max(...lngs), whole.getEast()), Math.min(Math.max(...lats), whole.getNorth())],
      ];
    },

    /**
     * What MapLibre draws of `layers` in the area that `insets` leave in sight, as queryRenderedFeatures answers it (a
     * feature drawn in two tiles comes twice): `[]` without a map, before the style has loaded, when the insets leave
     * no room or when the style has none of the layers. A layer the style lacks is not queried (MapLibre would answer
     * nothing and fire an error). Right after a move the tiles of the new zoom may still be loading: the answer is final
     * on the next idle (onIdle).
     */
    renderedFeatures(layers, insets) {
      if (!live() || !styleReady) return [];
      const ids = (layers ?? []).filter(id => map.getLayer(id));
      const area = ids.length === 0 ? null : areaInSight(insets);
      return area === null ? [] : map.queryRenderedFeatures(area, { layers: ids });
    },

    /** The top feature of a pickable layer under `point`: `{ kind, id, feature }` from `occ:pick` / `occ:pickId`. */
    pickAt,

    /** Zooms into a cluster. MapLibre 6 answers the expansion zoom with a promise. */
    async expandCluster(sourceId, clusterId, lngLat) {
      if (!live() || !styleReady) return false;
      const source = map.getSource(sourceId);
      if (typeof source?.getClusterExpansionZoom !== 'function') return false;
      let zoom;
      try {
        zoom = await source.getClusterExpansionZoom(clusterId);
      } catch {
        return false;
      }
      if (!live()) return false;
      map.easeTo({ center: lngLat, zoom, duration: CLUSTER_EASE_MS });
      return true;
    },

    /** Adds a custom layer at the top of `slot` (below the next slot's marker) and keeps it through context losses. */
    addCustomLayer(layer, slot) {
      nextSlot(slot);
      customLayers.set(layer.id, { layer, slot });
      whenStyleReady(() => addCustomLayerNow(layer.id));
    },

    removeCustomLayer(id) {
      customLayers.delete(id);
      whenStyleReady(() => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
    },

    /** Replaces the custom attribution (for example when a traffic source becomes active). */
    setAttribution(html) {
      customAttribution = html;
      if (!live()) return;
      map.removeControl(scaleControl);
      map.removeControl(attributionControl);
      addBottomControls();
    },

    setCursor(cursor) {
      if (live()) map.getCanvas().style.cursor = cursor ?? '';
    },

    project(lngLat) {
      return live() ? map.project(lngLat) : null;
    },

    /**
     * Resolves `true` after the next frame MapLibre draws with nothing left to load, place or move (its `idle`
     * event, after a repaint asked for here), and `false` without a map or when the engine is destroyed first. The
     * visual suite waits on it before it takes a screenshot.
     */
    whenIdle() {
      if (!live()) return Promise.resolve(false);
      return new Promise(resolve => {
        const waiter = { settle: resolve };
        waiter.onIdle = () => {
          idleWaiters.delete(waiter);
          resolve(true);
        };
        idleWaiters.add(waiter);
        map.once('idle', waiter.onIdle);
        map.triggerRepaint();
      });
    },

    /**
     * Removes the map, its listeners, its timer and its container; safe to call twice. MapLibre observes the size of
     * its own container, so the engine has no ResizeObserver of its own to disconnect.
     */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearBasemapTimer();
      releaseMap();
      customLayers.clear();
      featureStates.clear();
      container.remove();
    },
  };
}
