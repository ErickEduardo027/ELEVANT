import {
  LOOP_BANDS, RADAR_CREDITS, RADAR_FRAME_COUNT, RADAR_OPACITY, LOOP_FRAME_COUNT, SIGMET_SOURCE, STATIONS_SOURCE,
  WEATHER_GROUPS, frameOpacities, loopBandAt, loopFrameIndex, loopFrames, loopLayerId, loopPaint, radarFrames,
  radarLayerId, sigmetFeatures, stationFeatures,
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
/** How often the frame loop changes frame, in ms (traffic/weatherLayers.js LOOP_FRAME_MS divides it). */
export const REGIONAL_TICK_MS = 300;

/**
 * The frames of the satellite loop at the server's minute `nowMs`, from the images GIBS has of the band it shows
 * (`images`, useSatelliteImagery's `loop`: `{ status, band, times }`; hotfix of 2026-11-28): the latest six of that band,
 * skipping the holes of its domain, never another band's time. Until they arrive the band is the one of the hour
 * (GeoColor by day at PUJ, the infrared at night). `status` is `ready` with frames, `unavailable` when GIBS has no image,
 * else `loading`.
 */
export function regionalLoop(images, nowMs, demo = false) {
  const hourBand = loopBandAt(nowMs);
  if (images?.status === 'unavailable') return Object.freeze({ ...NO_LOOP, status: 'unavailable', band: hourBand, demo });
  const ready = images?.status === 'ready' && Object.hasOwn(LOOP_BANDS, images.band ?? '');
  const band = ready ? images.band : hourBand;
  const frames = ready ? loopFrames({ band, times: images.times }) : EMPTY_FRAMES;
  return Object.freeze({ status: frames.length > 0 ? 'ready' : 'loading', band, frames, demo });
}

/** The radar frames of the regional read (`{ status, data }`), with the provider that serves them. */
export function regionalRadar(read, demo = false) {
  const frames = radarFrames(read?.data);
  if (frames.length === 0) return NO_RADAR;
  return Object.freeze({ frames, provider: read.data.provider ?? null, demo });
}

/**
 * What the map draws of `regionWeather` (`{ region, sigmets, wind, radar, demo }`) and of the loop's images
 * (`loopImages`, useSatelliteImagery's `loop`) at `nowMs`: `{ loop, radar,
 * stations, sigmets, notes }`, the FeatureCollections of the stations and the SIGMETs, and the reads the layers menu
 * explains (weatherLayerNotes' `regional`).
 */
export function regionalDrawing({ regionWeather, loopImages, nowMs, language = 'es' }) {
  const demo = regionWeather?.demo === true;
  const loop = regionalLoop(loopImages, nowMs, demo);
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
 * holds the latest frame.
 */
export function regionalOpacities(drawing, elapsedMs, { still = false } = {}) {
  const out = {};
  const write = (frames, count, layerOf, opacity) => {
    const active = loopFrameIndex(still ? Number.NaN : elapsedMs, frames.length);
    const values = frameOpacities(active, frames.length, opacity);
    for (let index = 0; index < count; index += 1) out[layerOf(index)] = values[index] ?? 0;
  };
  write(drawing?.loop.frames ?? EMPTY_FRAMES, LOOP_FRAME_COUNT, loopLayerId,
    (LOOP_BANDS[drawing?.loop.band] ?? LOOP_BANDS.ir).opacity);
  write(drawing?.radar.frames ?? EMPTY_FRAMES, RADAR_FRAME_COUNT, radarLayerId, RADAR_OPACITY);
  return out;
}

/**
 * Runs the loop of one engine: every REGIONAL_TICK_MS it sets the opacity of each frame layer that changed for the
 * drawing `getDrawing()` returns (the same value again changes nothing), held on the latest frame while `isStill()`
 * and paused while the tab is hidden. Returns the function that stops it; `rewrite()` on the returned object writes
 * every opacity again on the next tick (a new drawing, a context loss).
 */
export function startRegionalLoop(engine, { getDrawing, isStill = () => false, now = () => Date.now(),
  setTimer = (callback, ms) => setInterval(callback, ms), clearTimer = timer => clearInterval(timer) } = {}) {
  const started = now();
  let written = {};
  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const drawing = getDrawing();
    if (!drawing) return;
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
