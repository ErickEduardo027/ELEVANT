import {
  LOOP_BANDS, RADAR_CREDITS, RADAR_FRAME_COUNT, RADAR_OPACITY, LOOP_FRAME_COUNT, SIGMET_SOURCE, STATIONS_SOURCE,
  WEATHER_GROUPS, frameOpacities, loopBandAt, loopFrameIndex, loopFrames, loopLayerId, loopPaint, radarFrames,
  loopSourceId, radarLayerId, sigmetFeatures, stationFeatures,
} from '../traffic/weatherLayers';

// The regional weather of an OCC map that opts in (lane M7: OccMap's `regionWeather`, what
// features/weather/useRegionWeather.js answers): what the map draws of it and how it writes it to its engine, kept
// apart from OccMap so the component only wires it. The satellite loop and the radar run by switching the opacity of
// their frame layers on one interval (LOOP_FRAME_MS), never by giving a source new tiles per frame; each source is
// pinned once, when its frame changes.

const EMPTY_FRAMES = Object.freeze([]);
const NO_LOOP = Object.freeze({ status: 'loading', band: 'ir', frames: EMPTY_FRAMES, demo: false });
const NO_RADAR = Object.freeze({ frames: EMPTY_FRAMES, provider: null, demo: false });
const WITH_DATA = new Set(['Live', 'Stale']);
const NO_MARKS = Object.freeze({});
const LOOP_SOURCE_PREFIX = loopSourceId('');
/** How often the frame loop changes frame, in ms (traffic/weatherLayers.js LOOP_FRAME_MS divides it). */
export const REGIONAL_TICK_MS = 300;

/**
 * The frames of the satellite loop at the server's minute `nowMs`, from the images GIBS has of the band it shows
 * (`images`, useSatelliteImagery's `loop`: `{ status, band, times }`; hotfix of 2026-11-28): the latest six of that band,
 * skipping the holes of its domain, never another band's time. Until they arrive the band is the one of the hour
 * (GeoColor by day at PUJ, the infrared at night). `status` is `ready` with frames, `unavailable` when GIBS has no image,
 * else `loading`.
 *
 * `missing` (`{ [sourceId]: tileTemplate }`, markLoopFrameMissing) are the frames whose tiles failed at the time they
 * are pinned to (hotfix of 2026-11-28, step 2): each frame says whether it is `missing`, the loop skips those, and when
 * every frame is missing the loop keeps its frames pinned but is `unavailable`. A mark of another template (the frame
 * pinned to a new time since) is no mark.
 */
export function regionalLoop(images, nowMs, demo = false, missing = NO_MARKS) {
  const hourBand = loopBandAt(nowMs);
  if (images?.status === 'unavailable') return Object.freeze({ ...NO_LOOP, status: 'unavailable', band: hourBand, demo });
  const ready = images?.status === 'ready' && Object.hasOwn(LOOP_BANDS, images.band ?? '');
  const band = ready ? images.band : hourBand;
  const frames = (ready ? loopFrames({ band, times: images.times }) : EMPTY_FRAMES)
    .map(frame => Object.freeze({ ...frame, missing: loopFrameMissing(missing, frame) }));
  const shown = frames.filter(frame => !frame.missing).length;
  const status = frames.length === 0 ? 'loading' : shown === 0 ? 'unavailable' : 'ready';
  return Object.freeze({ status, band, frames: Object.freeze(frames), demo });
}

/** Whether `sourceId` is the source of a frame of the satellite loop (traffic/weatherLayers.js loopSourceId). */
export const isLoopFrameSource = sourceId => typeof sourceId === 'string' && sourceId.startsWith(LOOP_SOURCE_PREFIX);

/** Whether the marks (`{ [sourceId]: tileTemplate }`) say `frame` failed at the tiles it is pinned to. */
export function loopFrameMissing(marks, frame) {
  const current = marks ?? NO_MARKS;
  return typeof frame?.source === 'string' && Object.hasOwn(current, frame.source)
    && current[frame.source] === frame.tiles?.[0];
}

/**
 * The marks of the loop frames that failed (hotfix of 2026-11-28, step 2) once the loop source `sourceId` reported a
 * tile it could not load: `marks` with that source marked at the tiles the engine holds for it (`pinned`,
 * createRegionalApplied's `tiles`), keeping only the marks that still match what is pinned (a frame pinned to a new
 * time loses its mark). The same `marks` when nothing changes (not a loop source, nothing pinned, already marked).
 */
export function markLoopFrameMissing(marks, pinned, sourceId) {
  const template = isLoopFrameSource(sourceId) ? pinned?.[sourceId] : undefined;
  const current = marks ?? NO_MARKS;
  if (typeof template !== 'string' || current[sourceId] === template) return current;
  const next = {};
  for (const [source, tiles] of Object.entries(current)) if (pinned[source] === tiles) next[source] = tiles;
  next[sourceId] = template;
  return Object.freeze(next);
}

/** The radar frames of the regional read (`{ status, data }`), with the provider that serves them. */
export function regionalRadar(read, demo = false) {
  const frames = radarFrames(read?.data);
  if (frames.length === 0) return NO_RADAR;
  return Object.freeze({ frames, provider: read.data.provider ?? null, demo });
}

/**
 * What the map draws of `regionWeather` (`{ region, sigmets, wind, radar, demo }`) and of the loop's images
 * (`loopImages`, useSatelliteImagery's `loop`; `loopMissing`, the frames that failed) at `nowMs`: `{ loop, radar,
 * stations, sigmets, notes }`, the FeatureCollections of the stations and the SIGMETs, and the reads the layers menu
 * explains (weatherLayerNotes' `regional`).
 */
export function regionalDrawing({ regionWeather, loopImages, loopMissing = NO_MARKS, nowMs, language = 'es' }) {
  const demo = regionWeather?.demo === true;
  const loop = regionalLoop(loopImages, nowMs, demo, loopMissing);
  const radar = regionalRadar(regionWeather?.radar, demo);
  return Object.freeze({
    loop,
    radar,
    stations: stationFeatures(regionWeather?.region?.data, { nowMs, demo }),
    sigmets: sigmetFeatures(regionWeather?.sigmets?.data, { nowMs, demo, language }),
    notes: Object.freeze({ loop, radar: regionWeather?.radar ?? null, stations: regionWeather?.region ?? null,
      sigmet: regionWeather?.sigmets ?? null }),
  });
}

/** The layers-menu groups with the loop and the radar hidden until the map has frames to pin them to. */
export function withPinnedRegional(groups, drawing) {
  if (!drawing) return groups;
  const next = { ...groups };
  const pinned = { loop: drawing.loop.frames.length > 0, radar: drawing.radar.frames.length > 0 };
  for (const key of ['loop', 'radar']) {
    const group = WEATHER_GROUPS[key];
    if (Object.hasOwn(next, group)) next[group] = next[group] === true && pinned[key];
  }
  return next;
}

/** The credit of the radar provider on screen, for the map's attribution, or null. */
export function radarCredit(provider) {
  return Object.hasOwn(RADAR_CREDITS, provider ?? '') ? RADAR_CREDITS[provider] : null;
}

/** What one engine was given of the regional weather; a new engine starts from it. */
export function createRegionalApplied() {
  return { stations: null, sigmets: null, tiles: {}, band: null };
}

/**
 * Writes `drawing` to `engine`: the stations and the SIGMETs (one setData when their features change), each frame
 * source pinned once to its tiles, and the loop's saturation when the band changes. Returns whether it wrote anything.
 */
export function applyRegionalDrawing(engine, applied, drawing) {
  if (!engine || !applied || !drawing) return false;
  let wrote = false;
  const stationsKey = JSON.stringify(drawing.stations.features);
  if (applied.stations !== stationsKey) {
    applied.stations = stationsKey;
    engine.setData(STATIONS_SOURCE, drawing.stations);
    wrote = true;
  }
  const sigmetsKey = JSON.stringify(drawing.sigmets.features);
  if (applied.sigmets !== sigmetsKey) {
    applied.sigmets = sigmetsKey;
    engine.setData(SIGMET_SOURCE, drawing.sigmets);
    wrote = true;
  }
  for (const frame of [...drawing.loop.frames, ...drawing.radar.frames]) {
    if (applied.tiles[frame.source] === frame.tiles[0]) continue;
    applied.tiles[frame.source] = frame.tiles[0];
    engine.setRasterTiles(frame.source, frame.tiles);
    wrote = true;
  }
  if (drawing.loop.frames.length > 0 && applied.band !== drawing.loop.band) {
    applied.band = drawing.loop.band;
    const { saturation } = loopPaint(drawing.loop.band);
    for (let index = 0; index < LOOP_FRAME_COUNT; index += 1) {
      engine.setPaint(loopLayerId(index), 'raster-saturation', saturation);
    }
    wrote = true;
  }
  return wrote;
}

/**
 * The opacities of every loop and radar layer `elapsedMs` after the loop started (`{ [layerId]: opacity }`): the
 * frame of that moment at its band's or the radar's opacity, the others at 0. `still` (reduced motion, a frozen clock)
 * holds the latest frame. A frame that is `missing` (its tiles failed, hotfix of 2026-11-28) is skipped: the loop runs
 * over the others, so the frame before it stays on screen instead of a blank one; with every frame missing, every
 * layer is at 0.
 */
export function regionalOpacities(drawing, elapsedMs, { still = false } = {}) {
  const out = {};
  const write = (frames, count, layerOf, opacity) => {
    const shown = [];
    frames.forEach((frame, position) => {
      if (frame?.missing !== true) shown.push(position);
    });
    const active = shown[loopFrameIndex(still ? Number.NaN : elapsedMs, shown.length)] ?? -1;
    const values = frameOpacities(active, frames.length, opacity);
    for (let index = 0; index < count; index += 1) out[layerOf(index)] = values[index] ?? 0;
  };
  write(drawing?.loop.frames ?? EMPTY_FRAMES, LOOP_FRAME_COUNT, loopLayerId,
    (LOOP_BANDS[drawing?.loop.band] ?? LOOP_BANDS.ir).opacity);
  write(drawing?.radar.frames ?? EMPTY_FRAMES, RADAR_FRAME_COUNT, radarLayerId, RADAR_OPACITY);
  return out;
}

/**
 * The share of the tiles a loop frame holds that must have failed for the loop to skip it (hotfix of 2026-11-28,
 * HOTFIX-GOES-2): most of them fail when GIBS has no image at that instant; a tile lost to a flaky network leaves only
 * a gap in that frame.
 */
export const LOOP_FRAME_FAILED_SHARE = 0.5;

// Whether the loop frame `sourceId` failed: some of its tiles failed and they are at least LOOP_FRAME_FAILED_SHARE of
// the tiles it holds. An engine without `heldTiles` keeps the rule of step 2 (any failed tile).
function loopFrameFailed(engine, sourceId) {
  const failed = engine.failedTiles(sourceId);
  if (!(failed > 0)) return false;
  if (typeof engine.heldTiles !== 'function') return true;
  return failed >= engine.heldTiles(sourceId) * LOOP_FRAME_FAILED_SHARE;
}

/**
 * Runs the loop of one engine: every REGIONAL_TICK_MS it sets the opacity of each frame layer that changed for the
 * drawing `getDrawing()` returns (the same value again changes nothing), held on the latest frame while `isStill()`
 * and paused while the tab is hidden. Returns the function that stops it; `rewrite()` on the returned object writes
 * every opacity again on the next tick (a new drawing, a context loss).
 *
 * Each tick it also asks the engine whether a loop frame not yet `missing` holds tiles that failed
 * (`engine.failedTiles`; MapLibre 6.16 keeps a 404 quiet, without an `error` event, and puts a tile lost to the network
 * in `errored` too) and, when they are at least LOOP_FRAME_FAILED_SHARE of the tiles it holds (`engine.heldTiles`),
 * calls `onFrameFailed(sourceId)` (hotfix of 2026-11-28, step 2 and HOTFIX-GOES-2). It reads what MapLibre already holds: no request, no write.
 */
export function startRegionalLoop(engine, { getDrawing, isStill = () => false, now = () => Date.now(),
  onFrameFailed = null, setTimer = (callback, ms) => setInterval(callback, ms),
  clearTimer = timer => clearInterval(timer) } = {}) {
  const started = now();
  let written = {};
  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const drawing = getDrawing();
    if (!drawing) return;
    if (typeof onFrameFailed === 'function' && typeof engine.failedTiles === 'function') {
      for (const frame of drawing.loop.frames) {
        if (frame.missing !== true && loopFrameFailed(engine, frame.source)) onFrameFailed(frame.source);
      }
    }
    const next = regionalOpacities(drawing, now() - started, { still: isStill() });
    for (const [layer, opacity] of Object.entries(next)) {
      if (written[layer] === opacity) continue;
      written[layer] = opacity;
      engine.setPaint(layer, 'raster-opacity', opacity);
    }
  };
  tick();
  const timer = setTimer(tick, REGIONAL_TICK_MS);
  return Object.freeze({
    stop: () => clearTimer(timer),
    rewrite: () => { written = {}; tick(); },
  });
}

/** Whether a regional read carries data to draw (Live or Stale). */
export const regionalReadDraws = read => WITH_DATA.has(read?.data?.status);
