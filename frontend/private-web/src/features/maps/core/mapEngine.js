import { BASEMAP_SOURCE_ID, SLOT_GROUP, nextSlot, slotMarkerId } from '../style/occStyle';
import { collapseCompactAttribution } from './attribution';
import { ensureWorkerUrl } from './workerUrl';
import { ORBIT } from '../kinematics/orbitCamera.js';

// The only module of the OCC maps that constructs a MapLibre Map (design A2). Everything a screen draws is declared in
// the style document (style/occStyle.js); the engine is the thin imperative shell around it:
// - it owns its container, created inside the host, so a StrictMode double mount never reuses a div;
// - only a throwing constructor, or a WebGL context that comes back without WebGL2, is fatal (`unavailable`, which is
//   terminal: the map is gone and the screen shows its fallback); the map is `ready` on `style.load`, because the
//   airfield and the stands are own data and work without the base map, whose health is reported apart (`degraded`
//   is a chip) and which recovers by itself: a missing base map is loaded again with back-off while the page is
//   visible, and one that is up reloads its source when single tiles fail (2026-11-28);
// - calls that need the style (data, feature state, visibility, filters, zoom ranges, clusters, custom layers) wait
//   until it has loaded and then run in the order they were made;
// - after a WebGL context loss or a worker restart MapLibre 6.16 rebuilds the style with its data and images, but not
//   the custom layers or the feature state: the engine puts those back;
// - listeners are map-level only and read features with queryRenderedFeatures (MapLibre 6.16 does not restore
//   layer-scoped listeners);
// - the style is never swapped after start: there is no setStyle anywhere (noSetStyle.test.js).

/** How long the vector base map may go without a first tile before the engine reports it degraded. */
export const BASEMAP_TIMEOUT_MS = 8000;
/**
 * The waits before each new attempt to load a missing base map (2026-11-28): 2 s, 5 s, 10 s, then every 30 s while the
 * page is visible, until a tile arrives.
 */
export const BASEMAP_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 10000, 30000]);
/**
 * A base map that is up asks again for the tiles that failed, and only those (map.refreshTiles), at most this often,
 * so the holes fill in without reloading its TileJSON or the tiles it already drew (2026-11-28).
 */
export const BASEMAP_TILE_RELOAD_MS = 10000;
/** The zoom range every OCC map starts with; `setCameraLimits` goes back to it for a limit given as `null`. */
export const ENGINE_MIN_ZOOM = 4.5;
export const ENGINE_MAX_ZOOM = 19.5;

const PICK_TOLERANCE_PX = 4;
const CLUSTER_EASE_MS = 500;
const INSET_SIDES = ['top', 'right', 'bottom', 'left'];
const ATTRIBUTION_SELECTOR = 'details.maplibregl-ctrl-attrib';

// The gestures of a person (follow mode, design A6). MapLibre 6.16 fires these with the DOM event that started them
// (`originalEvent`: a drag, the wheel, a pinch, a click on a zoom button, a key); the moves the code makes (jumpTo,
// easeTo, flyTo) carry none. Its keyboard handler pans with the arrow keys through an easeTo, which starts a move with
// the key and no drag.
const GESTURE_EVENTS = Object.freeze({ dragstart: 'pan', zoomstart: 'zoom', rotatestart: 'rotate', pitchstart: 'pitch' });
const PAN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

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
 * @param {object} [options.mapOptions] extra MapLibre options, applied last.
 * @param {(status: object) => void} [options.onStatus] `{ engine: 'starting'|'ready'|'unavailable', basemap:
 *   'off'|'loading'|'ok'|'degraded', reason: null|'webgl'|'error' }`, on every change. `unavailable` comes with
 *   `basemap: 'off'` and is the last status reported: the map never started, or the engine removed it when its WebGL
 *   context came back without WebGL2.
 * @param {(camera: object, details: { byUser: boolean }) => void} [options.onCamera] after every move.
 * @param {() => void} [options.onIdle] after every frame MapLibre draws with nothing left to load, place or move (its
 *   `idle` event): what renderedFeatures answers is then final, as the tiles of a new zoom have loaded.
 * @param {() => void} [options.onRender] after every frame MapLibre draws (its `render` event; PR M2: the frame meter).
 * @param {() => void} [options.onResize] after MapLibre has resized the map to its container (the fitted zooms change).
 * @param {(event: object) => void} [options.onClick] `{ point, lngLat, hit }`, `hit` as pickAt answers.
 * @param {(event: object) => void} [options.onDoubleClick] the same for a double click (M4, «Seguir en 3D»), with
 *   `preventDefault()`: called, MapLibre's own double-click zoom does nothing (MapLibre 6.16 skips its handler for a
 *   `dblclick` whose default was prevented); not called, the map zooms in as always.
 * @param {(event: object|null) => void} [options.onPointerMove] the same while the pointer moves, `null` when it
 *   leaves; its `hit` is picked when first read, so a caller that reads it once per frame picks once per frame.
 * @param {(gesture: { kind: 'pan'|'zoom'|'rotate'|'pitch' }) => void} [options.onUserGesture] when a person starts to
 *   move the map: a drag or an arrow key pans, the wheel, a pinch or a zoom button zooms, and the map rotates or tilts.
 *   Moves made by code never call it. From then until the move ends `isInteracting()` is true.
 * @param {(event: { sourceId: string, tile: object|null, error: unknown }) => boolean} [options.onSourceError] when a
 *   source other than the base map reports an error MapLibre fires (hotfix of 2026-11-28: a frame of the satellite
 *   loop); `true` means it was handled and is not logged. An error of a raster source given new tiles and not yet
 *   reloaded belongs to its tiles before and is not reported. MapLibre 6.16 fires none for a 404 tile (failedTiles).
 */
export function createMapEngine({
  maplibre, host, style, camera, interactive = true, attribution, imageResolver, mapOptions,
  onStatus, onCamera, onIdle, onRender, onResize, onClick, onDoubleClick, onPointerMove, onUserGesture, onSourceError,
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
  // The recovery of the base map (2026-11-28): the next attempt while it is missing, how many came before it, and the
  // tiles that failed on a base map that is up, asked again together. A hidden page makes no attempt; it resumes when
  // shown.
  let basemapRetryTimer = null;
  let basemapAttempts = 0;
  let basemapRetryPaused = false;
  let tileReloadTimer = null;
  let tileReloadPaused = false;
  const failedTiles = new Map();
  let lastTileReloadAt = -Infinity;
  let attributionControl = null;
  let scaleControl = null;
  let customAttribution = attribution;
  let attributionPristine = true;
  // Whether a person is moving the map: from the start of a gesture until the move ends.
  let interacting = false;
  const listeners = [];
  const customLayers = new Map();
  const featureStates = new Map();
  // The tiles a raster source was given at run time (PR M8: the satellite images pinned to their time), by source.
  const rasterTiles = new Map();
  // The raster sources given new tiles that MapLibre has not reloaded yet (hotfix of 2026-11-28): until their next
  // `content` source data, the tiles MapLibre holds of them, failed or not, are of their tiles before.
  const reloadingRaster = new Set();
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

  const ownerDocument = host.ownerDocument;
  const pageHidden = () => ownerDocument.visibilityState === 'hidden';

  // Loads the base map again through MapLibre's public API, never setStyle: the same TileJSON URL again (setUrl asks
  // for the TileJSON and then its tiles), or the same tile list (setTiles). Only the base-map source is touched.
  function reloadBasemap() {
    if (!live() || !styleReady) return;
    try {
      const source = map.getSource(BASEMAP_SOURCE_ID);
      const spec = typeof source?.serialize === 'function' ? source.serialize() : null;
      if (typeof spec?.url === 'string' && typeof source.setUrl === 'function') source.setUrl(spec.url);
      else if (Array.isArray(spec?.tiles) && typeof source.setTiles === 'function') source.setTiles([...spec.tiles]);
    } catch (error) {
      console.error('The OCC map could not reload its base map.', error);
    }
  }

  function clearBasemapRetry() {
    if (basemapRetryTimer !== null) clearTimeout(basemapRetryTimer);
    basemapRetryTimer = null;
    if (tileReloadTimer !== null) clearTimeout(tileReloadTimer);
    tileReloadTimer = null;
  }

  // While the base map is missing: one attempt after each wait of BASEMAP_RETRY_DELAYS_MS, the next one planned with it
  // (a request that hangs fires no error), until a tile arrives. An error while an attempt is planned changes nothing.
  function scheduleBasemapRetry() {
    if (!live() || basemapRetryTimer !== null || status.basemap !== 'degraded') return;
    if (pageHidden()) {
      basemapRetryPaused = true;
      return;
    }
    const delay = BASEMAP_RETRY_DELAYS_MS[Math.min(basemapAttempts, BASEMAP_RETRY_DELAYS_MS.length - 1)];
    basemapAttempts += 1;
    basemapRetryTimer = setTimeout(() => {
      basemapRetryTimer = null;
      if (!live() || status.basemap !== 'degraded') return;
      if (pageHidden()) {
        basemapRetryPaused = true;
        return;
      }
      reloadBasemap();
      scheduleBasemapRetry();
    }, delay);
  }

  // The tiles of a base map that is up which failed since the last refresh, by canonical tile ID.
  function rememberFailedTile(tile) {
    const canonical = tile?.tileID?.canonical;
    if (!Number.isInteger(canonical?.z) || !Number.isInteger(canonical?.x) || !Number.isInteger(canonical?.y)) {
      return false;
    }
    const { x, y, z } = canonical;
    failedTiles.set(`${z}/${x}/${y}`, { x, y, z });
    return true;
  }

  // Asks MapLibre again for the failed tiles only: map.refreshTiles reloads those (errored ones included) and leaves the
  // TileJSON, the other tiles and the tiles out of view as they are.
  function refreshFailedTiles() {
    const ids = [...failedTiles.values()];
    failedTiles.clear();
    if (!live() || !styleReady || ids.length === 0) return;
    try {
      map.refreshTiles(BASEMAP_SOURCE_ID, ids);
    } catch (error) {
      console.error('The OCC map could not ask again for its base-map tiles.', error);
    }
  }

  // A base map that is up and loses single tiles: one refresh of those tiles, at most once every BASEMAP_TILE_RELOAD_MS.
  function scheduleTileReload() {
    if (!live() || tileReloadTimer !== null || failedTiles.size === 0) return;
    if (pageHidden()) {
      tileReloadPaused = true;
      return;
    }
    const delay = Math.max(0, lastTileReloadAt + BASEMAP_TILE_RELOAD_MS - Date.now());
    tileReloadTimer = setTimeout(() => {
      tileReloadTimer = null;
      if (!live() || status.basemap !== 'ok') return;
      if (pageHidden()) {
        tileReloadPaused = true;
        return;
      }
      lastTileReloadAt = Date.now();
      refreshFailedTiles();
    }, delay);
  }

  function basemapMissing() {
    clearBasemapTimer();
    if (tileReloadTimer !== null) clearTimeout(tileReloadTimer);
    tileReloadTimer = null;
    tileReloadPaused = false;
    failedTiles.clear();
    report({ basemap: 'degraded' });
    scheduleBasemapRetry();
  }

  function basemapTile() {
    clearBasemapTimer();
    if (basemapRetryTimer !== null) clearTimeout(basemapRetryTimer);
    basemapRetryTimer = null;
    basemapAttempts = 0;
    basemapRetryPaused = false;
    report({ basemap: 'ok' });
  }

  function onVisibilityChange() {
    if (!live()) return;
    if (pageHidden()) {
      // No attempt while nobody looks: the planned ones wait for the page to be shown again.
      if (basemapRetryTimer !== null) basemapRetryPaused = true;
      if (tileReloadTimer !== null) tileReloadPaused = true;
      clearBasemapRetry();
      return;
    }
    if (basemapRetryPaused) {
      basemapRetryPaused = false;
      basemapAttempts = 0;
      scheduleBasemapRetry();
    }
    if (tileReloadPaused) {
      tileReloadPaused = false;
      if (status.basemap === 'ok') scheduleTileReload();
    }
  }

  function stopBasemapRecovery() {
    clearBasemapTimer();
    clearBasemapRetry();
    basemapRetryPaused = false;
    tileReloadPaused = false;
    failedTiles.clear();
    ownerDocument.removeEventListener('visibilitychange', onVisibilityChange);
  }

  // Settles every call that waits for the style and every wait for an idle frame as never happening, then removes the
  // map. The engine's listeners go first, so nothing the map fires while it goes reaches the engine.
  function releaseMap() {
    dropLimitsWaiter();
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
    stopBasemapRecovery();
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

  // The tiles MapLibre holds of a source that `matches` (failedTiles, heldTiles): 0 without a map or a style, for a
  // source it does not have, and for a raster source given new tiles that it has not reloaded yet. No request.
  function countTiles(sourceId, matches) {
    if (!live() || reloadingRaster.has(sourceId)) return 0;
    const managers = map.style?.tileManagers ?? map.style?.sourceCaches ?? null;
    const manager = managers?.[sourceId];
    if (typeof manager?.getIds !== 'function' || typeof manager.getTileByID !== 'function') return 0;
    let count = 0;
    for (const id of manager.getIds()) if (matches(manager.getTileByID(id))) count += 1;
    return count;
  }

  // A raster source takes `tiles` only when it does not have them already: MapLibre reloads a source on every setTiles.
  function applyRasterTiles(sourceId, tiles) {
    const source = map.getSource(sourceId);
    if (typeof source?.setTiles !== 'function') return;
    const current = typeof source.serialize === 'function' ? source.serialize()?.tiles : source.tiles;
    if (JSON.stringify(current ?? null) === JSON.stringify(tiles)) return;
    source.setTiles([...tiles]);
    reloadingRaster.add(sourceId);
  }

  // What MapLibre does not keep through a context loss or a worker restart. MapLibre 6.16 rebuilds a raster source with
  // the tiles it was last given; the engine puts them back only when a rebuilt style comes without them.
  function restoreRuntimeState() {
    for (const id of customLayers.keys()) runWhileLoading(() => addCustomLayerNow(id));
    for (const { source, id, state } of featureStates.values()) runWhileLoading(() => applyFeatureState(source, id, state));
    for (const [sourceId, tiles] of rasterTiles) runWhileLoading(() => applyRasterTiles(sourceId, tiles));
    if (sky !== null) runWhileLoading(applySky);
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

  // The gestures and limits «Seguir en 3D» took from MapLibre (setOrbitMode), to give back.
  let orbitSaved = null;
  // The camera limits setCameraLimits waits to apply until the move on the way ends (M9), and the listener that does it.
  let limitsWaiter = null;

  function dropLimitsWaiter() {
    if (limitsWaiter === null) return;
    map?.off?.('moveend', limitsWaiter);
    limitsWaiter = null;
  }

  // Integration of M4 and M9: while «Seguir en 3D» holds the orbit (setOrbitMode), the maximum zoom given here is the one
  // the orbit gives back when it ends (the latest the screen set, whichever came first), and the map keeps at least the
  // orbit's zoom 22 until then.
  function applyLimits({ maxBounds = null, minZoom = null, maxZoom = null }) {
    const limit = Number.isFinite(maxZoom) ? maxZoom : ENGINE_MAX_ZOOM;
    map.setMaxBounds?.(maxBounds ?? null);
    map.setMinZoom?.(Number.isFinite(minZoom) ? minZoom : ENGINE_MIN_ZOOM);
    if (orbitSaved !== null) {
      orbitSaved.maxZoom = limit;
      map.setMaxZoom?.(Math.max(limit, ORBIT.maxZoom));
      return;
    }
    map.setMaxZoom?.(limit);
  }

  // The sky (M4, setSky): the SkySpecification the map shows, or null for none; put back after a context loss.
  let sky = null;
  let skyKey = 'null';
  function applySky() {
    if (typeof map.setSky === 'function') map.setSky(sky ?? undefined);
  }

  // Close up (M4, setCloseUp): the layers whose metadata says `'occ:closeUp': 'hide'` are hidden whatever their group,
  // and those with an `'occ:closeUpFilter'` draw only what it lets through, on top of their own filter. The visibility
  // each group was last given (setGroupVisibility) is what a hidden layer gets back.
  let closeUp = false;
  const groupVisible = new Map();
  const closeUpHidden = [...styleLayers.values()].filter(layer => layer.metadata?.['occ:closeUp'] === 'hide');
  const closeUpFiltered = [...styleLayers.values()].filter(layer => Array.isArray(layer.metadata?.['occ:closeUpFilter']));
  function layerVisibility(layer) {
    if (closeUp && layer.metadata?.['occ:closeUp'] === 'hide') return 'none';
    const group = layer.metadata?.['occ:group'];
    if (groupVisible.has(group)) return groupVisible.get(group) ? 'visible' : 'none';
    return layer.layout?.visibility ?? 'visible';
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
      minZoom: ENGINE_MIN_ZOOM,
      maxZoom: ENGINE_MAX_ZOOM,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: true },
      validateStyle: process.env.NODE_ENV !== 'production',
      // PR M2 (2026-11-28): a 150 ms symbol fade. With 0 (CN-18), every frame MapLibre draws starts and finishes a full
      // placement of every label; with a fade the placement runs again at most once per fade, in slices of a few
      // milliseconds, so the frames the animated traffic draws continuously cost no placement. The traffic itself is
      // never written every frame (CN-18), and while the 3D layer animates it, twice a second (core/OccMap.jsx).
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
        // A base map that is up keeps it and asks again for the tiles that failed (an error without a tile, such as a
        // TileJSON read again, changes nothing: it keeps the one it has); one that is missing says so and tries again.
        if (status.basemap !== 'ok') basemapMissing();
        else if (rememberFailedTile(event.tile)) scheduleTileReload();
      } else if (isGpuError(maplibre, event?.error)) {
        becomeUnavailable('webgl');
      } else {
        const sourceId = typeof event?.sourceId === 'string' ? event.sourceId : null;
        if (sourceId !== null && reloadingRaster.has(sourceId)) return;
        if (sourceId !== null && onSourceError?.({ sourceId, tile: event.tile ?? null, error: event.error }) === true) return;
        console.error(event?.error ?? event);
      }
    });
    listen('sourcedata', event => {
      if (event?.sourceDataType === 'content') reloadingRaster.delete(event.sourceId);
      keepAttributionClosed();
      if (event?.sourceId === BASEMAP_SOURCE_ID && event.tile) basemapTile();
    });
    listen('styledata', keepAttributionClosed);
    const gesture = kind => {
      interacting = true;
      onUserGesture?.({ kind });
    };
    for (const [type, kind] of Object.entries(GESTURE_EVENTS)) {
      listen(type, event => {
        if (event?.originalEvent) gesture(kind);
      });
    }
    listen('movestart', event => {
      const key = event?.originalEvent;
      if (key?.type === 'keydown' && PAN_KEYS.has(key.key) && !key.shiftKey) gesture('pan');
    });
    listen('moveend', event => {
      interacting = false;
      onCamera?.(readCamera(), { byUser: Boolean(event?.originalEvent) });
    });
    if (onIdle) listen('idle', () => onIdle());
    if (onRender) listen('render', () => onRender());
    if (onResize) listen('resize', () => onResize());
    if (onClick) listen('click', event => onClick(pointerEvent(event)));
    if (onDoubleClick) {
      listen('dblclick', event => onDoubleClick({ ...pointerEvent(event), preventDefault: () => event.preventDefault?.() }));
    }
    if (onPointerMove) {
      listen('mousemove', event => onPointerMove(pointerMoveEvent(event)));
      listen('mouseout', () => onPointerMove(null));
    }

    // An icon or a pattern the style names: the pixels go to MapLibre with what the resolver says of them (the pixel
    // ratio, whether it is an SDF, and where an image stretched around a text may stretch).
    if (imageResolver) {
      map.setMissingStyleImageResolver(id => {
        if (map === null || map.hasImage(id)) return;
        const image = imageResolver(id);
        if (!image) return;
        const { width, height, data, ...metadata } = image;
        map.addImage(id, { width, height, data }, metadata);
      });
    }

    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    addBottomControls();

    if (hasBasemap) {
      basemapTimer = setTimeout(() => {
        basemapTimer = null;
        if (status.basemap === 'loading') basemapMissing();
      }, BASEMAP_TIMEOUT_MS);
      ownerDocument.addEventListener('visibilitychange', onVisibilityChange);
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
      groupVisible.set(group, Boolean(visible));
      const layers = [...styleLayers.values()].filter(layer => layer.metadata?.['occ:group'] === group);
      whenStyleReady(() => {
        for (const layer of layers) {
          if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', layerVisibility(layer));
        }
      });
    },

    /**
     * Close up (M4: «Seguir en 3D» past zoom 19.5): `true` hides the labels that would crowd the followed aircraft (the
     * layers marked `'occ:closeUp': 'hide'`: every tag, the selection rings, the stand designators, the references'
     * words) and narrows those with an `'occ:closeUpFilter'` (the trails, the estimated rings and the «Demo» plates:
     * all but the followed aircraft's, which sat on its model's tail); `false` gives back what their groups show. One
     * call per change; nothing without a map.
     */
    setCloseUp(on) {
      const next = on === true;
      if (!live() || next === closeUp) return;
      closeUp = next;
      whenStyleReady(() => {
        for (const layer of closeUpHidden) {
          if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', layerVisibility(layer));
        }
        for (const layer of closeUpFiltered) {
          if (!map.getLayer(layer.id)) continue;
          const own = layer.filter ?? null;
          const narrowed = own === null ? layer.metadata['occ:closeUpFilter'] : ['all', own, layer.metadata['occ:closeUpFilter']];
          map.setFilter(layer.id, closeUp ? narrowed : own);
        }
      });
    },

    /** Whether the map is close up (setCloseUp). */
    isCloseUp() {
      return closeUp;
    },

    /**
     * The sky (M4: core/mapSky.js, on in the 3D views and while following in 3D): a MapLibre SkySpecification, or
     * null to take it away. MapLibre's setSky changes a property of the style, never the style (no setStyle). The same
     * sky again changes nothing; a map without one is never told to have none. Nothing without a map.
     */
    setSky(next) {
      if (!live()) return;
      const value = next == null ? null : structuredClone(next);
      const key = JSON.stringify(value);
      if (key === skyKey) return;
      sky = value;
      skyKey = key;
      whenStyleReady(applySky);
    },

    /** The sky set (setSky), a copy, or null. */
    getSky() {
      return sky === null ? null : structuredClone(sky);
    },

    setData(sourceId, data) {
      whenStyleReady(() => {
        map.getSource(sourceId)?.setData(data);
      });
    },

    /**
     * Gives a raster source of the style new tile URL templates (PR M8: a satellite image pinned to the time GIBS
     * reports) and remembers them, so a style rebuilt without them after a context loss gets them back. The same tiles
     * again change nothing. Throws a TypeError for anything but a list of URL templates.
     */
    setRasterTiles(sourceId, tiles) {
      if (!Array.isArray(tiles) || tiles.length === 0 || !tiles.every(tile => typeof tile === 'string' && tile !== '')) {
        throw new TypeError(`setRasterTiles needs a list of tile URL templates for ${sourceId}`);
      }
      const list = Object.freeze([...tiles]);
      rasterTiles.set(sourceId, list);
      whenStyleReady(() => applyRasterTiles(sourceId, list));
    },

    /**
     * How many tiles MapLibre holds of the source `sourceId` that failed to load (hotfix of 2026-11-28: a frame of the
     * satellite loop GIBS answers with 404, which MapLibre 6.16 keeps quiet, tile_manager.ts `_loadTile`), read from its
     * tile manager; 0 without a map or a style, for a source it does not have, and for a raster source given new tiles
     * that it has not reloaded yet. It reads what MapLibre holds: no request.
     */
    failedTiles(sourceId) {
      return countTiles(sourceId, tile => tile?.state === 'errored');
    },

    /**
     * How many tiles MapLibre holds of the source `sourceId`, in any state (hotfix of 2026-11-28, HOTFIX-GOES-2: the
     * loop skips a satellite frame only when most of them failed), read the same guarded way as `failedTiles`.
     */
    heldTiles(sourceId) {
      return countTiles(sourceId, () => true);
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

    /**
     * Gives a layer of the style `filter` in place of its own (`null` takes it away; N29: the stand labels leave out
     * the selected stand's). MapLibre keeps it in the style it rebuilds after a context loss or a worker restart, as it
     * keeps the zoom ranges, so the engine has nothing to put back. A layer the style lacks is left alone.
     */
    setFilter(layerId, filter) {
      whenStyleReady(() => {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter ?? null);
      });
    },

    /**
     * Sets one paint property of a layer of the style (lane M7: the raster-opacity of a frame of a weather loop, the
     * saturation of the loop's band). MapLibre takes the same value again as no change. Not remembered: the loop's
     * clock sets it again on its next frame, also after a context loss. A layer the style lacks is left alone.
     */
    setPaint(layerId, property, value) {
      whenStyleReady(() => {
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
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

    /**
     * «Seguir en 3D» (CN-30): `true` hands the gestures to the orbit of follow mode (OccMap): MapLibre's own drag, rotate,
     * zoom, double click and keys stop, the tilt may reach 85° and the centre may stand above the ground (the followed
     * aircraft in the air) and the zoom 22 (M4, «Muy cerca»); `false` gives them back as they were. Nothing without a
     * map.
     */
    setOrbitMode(on) {
      if (!live()) return;
      const handlers = ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom',
        'touchPitch'];
      if (on === true) {
        if (orbitSaved !== null) return;
        orbitSaved = {
          handlers: handlers.filter(name => map[name]?.isEnabled?.() === true),
          maxPitch: map.getMaxPitch?.() ?? null,
          maxZoom: map.getMaxZoom?.() ?? null,
          clamped: map.getCenterClampedToGround?.() ?? null,
        };
        for (const name of orbitSaved.handlers) map[name].disable();
        map.setMaxPitch?.(85);
        // M4 (2026-11-27): «Muy cerca» and the ultra zoom reach 22 (kinematics/orbitCamera.js: ORBIT.maxZoom).
        map.setMaxZoom?.(ORBIT.maxZoom);
        map.setCenterClampedToGround?.(false);
        return;
      }
      if (orbitSaved === null) return;
      const saved = orbitSaved;
      orbitSaved = null;
      // The zoom limit first: the jump below ends a move, and limits that waited for it (setCameraLimits with afterMove)
      // then apply on top of it rather than under it. setMaxZoom eases a camera beyond the old limit back within it.
      if (Number.isFinite(saved.maxZoom)) map.setMaxZoom?.(saved.maxZoom);
      map.jumpTo?.({ elevation: 0 });
      map.setCenterClampedToGround?.(saved.clamped ?? true);
      if (Number.isFinite(saved.maxPitch)) map.setMaxPitch?.(saved.maxPitch);
      for (const name of saved.handlers) map[name]?.enable?.();
    },

    /**
     * The camera's limits (M9: a map fixed on the airport lets its camera go while it follows an aircraft):
     * `{ maxBounds, minZoom, maxZoom }`, each `null` for none (bounds) or the engine's own (zoom). With `afterMove`, a
     * move on the way (the flight back of «Seguir en 3D», a drag) ends first, so the new bounds do not cut it short; a
     * later call replaces a wait not yet applied. Nothing without a map.
     */
    setCameraLimits(limits = {}, { afterMove = false } = {}) {
      if (!live()) return;
      dropLimitsWaiter();
      if (afterMove && map.isMoving?.() === true) {
        limitsWaiter = () => {
          limitsWaiter = null;
          map.off('moveend', handler);
          if (live()) applyLimits(limits);
        };
        const handler = limitsWaiter;
        map.on('moveend', handler);
        return;
      }
      applyLimits(limits);
    },

    /** Whether a person is moving the map now (see `onUserGesture`): a move then must not take the camera from them. */
    isInteracting() {
      return live() && interacting;
    },

    /** The size of the map on screen, `{ width, height }` in CSS px, or `null` without a map or before it has one. */
    getViewport() {
      if (!live()) return null;
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      return width > 0 && height > 0 ? { width, height } : null;
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

    /**
     * The GPU the map draws with (PR M2: the frame meter and the visual suite's GPU runs), `{ renderer, vendor }` as
     * WebGL reports them (unmasked where the browser allows it), or null without a map or a context.
     */
    rendererInfo() {
      if (!live()) return null;
      const gl = map.painter?.context?.gl ?? null;
      if (!gl || typeof gl.getParameter !== 'function') return null;
      const debug = typeof gl.getExtension === 'function' ? gl.getExtension('WEBGL_debug_renderer_info') : null;
      const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      const vendor = gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
      return { renderer: typeof renderer === 'string' ? renderer : null, vendor: typeof vendor === 'string' ? vendor : null };
    },

    /**
     * What MapLibre has to go through each frame (PR M2, 2026-11-28: the map lab's CPU profile of «Seguir en 3D»), or
     * null without a style: `{ zoom, pitch, layers, sources: [{ id, tiles }] }`, the layers it draws at this zoom and,
     * for each source one of them reads, the tiles it holds for the frame. Read from MapLibre's internals, for the lab.
     */
    renderStats() {
      const style = live() ? map.style : null;
      if (!style?._layers) return null;
      const zoom = map.getZoom();
      const layers = Object.values(style._layers).filter(layer => layer.type !== 'custom' && !layer.isHidden?.(zoom));
      const used = new Set(layers.map(layer => layer.source).filter(Boolean));
      const managers = style.tileManagers ?? style.sourceCaches ?? {};
      const sources = [...used].map(id => ({ id, tiles: managers[id]?.getRenderableIds?.().length ?? null }));
      return { zoom, pitch: map.getPitch(), layers: layers.length, sources };
    },

    /** The pixel ratio the map draws at, or null without a map (PR M7: the 3D governor lowers it). */
    getPixelRatio() {
      return live() && typeof map.getPixelRatio === 'function' ? map.getPixelRatio() : null;
    },

    setPixelRatio(ratio) {
      if (live() && Number.isFinite(ratio) && ratio > 0 && typeof map.setPixelRatio === 'function') map.setPixelRatio(ratio);
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
     * Removes the map, its listeners, its timers and its container; safe to call twice. MapLibre observes the size of
     * its own container, so the engine has no ResizeObserver of its own to disconnect.
     */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopBasemapRecovery();
      releaseMap();
      customLayers.clear();
      featureStates.clear();
      rasterTiles.clear();
      container.remove();
    },
  };
}
