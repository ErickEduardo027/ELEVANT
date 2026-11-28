import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { METRES_PER_NM, haversineM } from '../airport/geo';
import { createAttitudeTracker } from '../aircraft/attitude';
import {
  AIRCRAFT_3D_RADIUS_NM, GROUND_TRAFFIC_3D_RADIUS_M, aircraft3dColors, instanceKey, planInstances, planLabels,
  planSprites,
} from '../aircraft/instancePlan';
import { resolveLivery } from '../aircraft/liveries';
import { loadAircraft3d } from '../aircraft/loadAircraft3d';
import { resolveAircraftType } from '../aircraft/types';
import { interpolate, keyframesMoving } from '../traffic/keyframes';
import { sunPosition } from '../traffic/solar';
import { TRAFFIC_SOURCE, isDrawn, tagTextOf } from '../traffic/trafficFeatures';
import { TAG_DECLUTTER_UNTIL_ZOOM } from '../traffic/trafficLayers';
import { isInBounds, isRetired, standCodeOf } from './cameraPresets';

// The 3D aircraft of an OccMap (PR M7, design G1 to G4 as contracts 2.3 amend them): the person's 2D/3D choice, the
// stands' parked aircraft for the instance plan, the translation of a 3D pick into the map's selection, the frame-time
// governor and the controller that loads the 3D chunk, adds and removes the custom layer on the map's engine and tells
// the map which aircraft the 3D draws, so their 2D symbols give way. The controller has no clock and no read of its
// own: OccMap hands it the aircraft of each write of its traffic, on its one frame loop (core/frameLoop.js), and the
// layer reads the plan of that write.
//
// PR M2, the animated traffic: with `animate` on and the write's keyframes (traffic/keyframes.js), the layer draws
// every aircraft of the traffic, in 2D or 3D, at the positions of each frame: the controller interpolates the keyframes
// at the frame loop's instant (`frameTime`) for the aircraft in or around the area in sight (`frameZone`), and plans
// their models (3D on, in sight at any distance, never smaller than MIN_MODEL_PX) and flat sprites (the rest: the
// silhouettes, dashed rings and «Demo» plates the GeoJSON layers drew; aircraft/instancePlan.js: planSprites). A frame
// where nothing moves reuses the last answer. Until the layer draws (the chunk loading, no WebGL2, a failed renderer or
// atlas) and while its context is lost, the map keeps its GeoJSON icons, as before. The tags and the chosen aircraft's
// ring move with them (aircraft/trafficLabels.js: planLabels, laid out by the layer), and the groups the layers menu
// hides (`shown`) and other traffic on the ground below its threshold (`otherGroundMinZoom`) are left out, as the GeoJSON
// layers leave them out.

/** Where a browser keeps the 2D/3D choice of the OCC maps (design G4). */
export const MODE_3D_STORAGE_KEY = 'elevant-occ-map-3d:v1';

/**
 * The governor (design G4, contracts 2.3): frames slower than `slowFrameMs` on average over `windowMs` of continuous
 * drawing take one step down; `stableMs` of fast frames take one step back up (never out of the pause, which waits
 * for «Volver a 3D»). A gap longer than `maxGapMs` is the map idling, not a slow frame. The steps: full quality, no
 * shadows and drop lines, the pixel ratios of `pixelRatios`, then the 3D paused (never while a flight is followed).
 *
 * PR M2 (2026-11-28): only frames the map draws while it animates continuously are measured (the animated traffic
 * moving, «Seguir en 3D», the camera moving), and only when the frame before was one too: then the time between two
 * draws is what a frame costs. The few renders each write of the traffic asks for with a still camera (2 to 15 a
 * second, CN-18) leave gaps that are the write's cadence, not slow frames, and read as the map idling.
 */
export const GOVERNOR = Object.freeze({
  slowFrameMs: 22, windowMs: 2_000, stableMs: 30_000, maxGapMs: 250, pixelRatios: Object.freeze([1.25, 1]),
});

/** The last step of the governor: the 3D paused. */
export const GOVERNOR_PAUSED = 2 + GOVERNOR.pixelRatios.length;

/**
 * The size floor of the traffic's models, in CSS pixels (aircraft/aircraft3dLayer.js: minModelPx): at the Aeródromo
 * zoom an airliner is a few pixels long, so an aircraft of the traffic is drawn at least this long, as its 2D symbol;
 * one on its stand keeps the stand's scale, as its footprint.
 */
export const MIN_MODEL_PX = 30;

/** After a failed load of the 3D chunk the map waits this long before it tries again. */
export const RETRY_LOAD_MS = 30_000;

/** The slot of the map's style the 3D aircraft draw in: above the footprints and the buildings, under the tags. */
export const AIRCRAFT_3D_SLOT = 'models';

/**
 * From this zoom the chosen aircraft is drawn with its detailed model and its airline's livery (CN-30,
 * aircraft/aircraftDetail.js); the followed aircraft («Seguir en 3D») always is.
 */
export const DETAIL_MIN_ZOOM = 16.5;

/**
 * What the 3D may draw under the map's projection (M8): in Mercator, `minZoom` and `followedId` as given; on the globe,
 * nothing below `globeMercatorZoom` (style/occStyle.js: GLOBE_MERCATOR_ZOOM), where the globe is Mercator again, because
 * the layer composes Mercator frames: the 3D threshold is at least that zoom and the followed aircraft («Seguir en 3D»)
 * keeps its 2D symbol below it. `animates` (integration of M8 with M2) says whether the layer may animate the traffic:
 * always in Mercator, and on the globe only from that zoom, so below it the GeoJSON icons draw every aircraft as before
 * (no aircraft of Monitoreo's world view ever goes missing).
 */
export function projected3d({ projection = 'mercator', zoom, minZoom, followedId = null, globeMercatorZoom }) {
  if (projection !== 'globe' || !Number.isFinite(globeMercatorZoom)) return { minZoom, followedId, animates: true };
  const mercator = Number.isFinite(zoom) && zoom >= globeMercatorZoom;
  return {
    minZoom: Number.isFinite(minZoom) ? Math.max(minZoom, globeMercatorZoom) : minZoom,
    followedId: mercator ? followedId : null,
    animates: mercator,
  };
}

const NO_IDS = Object.freeze(new Set());
// The layer a 3D pick names in its feature: the custom layer's id (aircraft/aircraft3dLayer.js), which this module may
// not import (only the 3D chunk does).
const AIRCRAFT_3D_PICK_LAYER = 'occ-aircraft-3d';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const ATTITUDE_RADIUS_M = (AIRCRAFT_3D_RADIUS_NM + 1) * METRES_PER_NM;

/** The aircraft of a write (or of the stands) with that id, as the plan takes it, and whether it is on its stand. */
function findAircraft(aircraft, parked, id) {
  if (id == null) return null;
  const onStand = (Array.isArray(parked) ? parked : []).find(item => item?.id === id) ?? null;
  if (onStand !== null && finite(onStand.lon) && finite(onStand.lat)) return { item: onStand, onStand: true };
  const moving = (Array.isArray(aircraft) ? aircraft : []).find(item => item?.id === id) ?? null;
  if (moving === null || !isDrawn(moving) || !finite(moving.lon) || !finite(moving.lat)) return null;
  return { item: moving, onStand: false };
}

/**
 * What the layer draws of the detailed aircraft (CN-30): `{ id, lon, lat, spec, code, key, livery, registration,
 * headingDeg, heightM, pitchDeg, bankDeg, gearDown, lights, onStand, followed }`, frozen; `null` for one in the air
 * without an altitude. `key` names its model: its type, its livery and its registration.
 */
export function detailOf(found, attitude, { followed = false } = {}) {
  if (found === null || attitude === null) return null;
  const { item, onStand } = found;
  const resolved = resolveAircraftType({ typeIcao: item.typeIcao ?? null, model: item.model ?? null,
    sizeCategory: item.sizeCategory ?? null, emitterCategory: item.emitterCategory ?? null });
  const livery = resolveLivery(item);
  const registration = typeof item.registration === 'string' && item.registration.trim() !== ''
    ? item.registration.trim().toUpperCase() : null;
  let heading = 0;
  if (finite(item.trackDeg)) heading = item.trackDeg;
  else if (finite(item.headingDeg)) heading = item.headingDeg;
  return Object.freeze({
    id: item.id, lon: item.lon, lat: item.lat, spec: resolved.spec, code: resolved.code,
    key: `${instanceKey(resolved)}|${livery.id}|${registration ?? ''}`, livery, registration, headingDeg: heading,
    heightM: onStand ? 0 : attitude.heightM, pitchDeg: onStand ? 0 : attitude.pitchDeg,
    bankDeg: onStand ? 0 : attitude.bankDeg, gearDown: onStand ? true : attitude.gearDown, lights: attitude.lights,
    gsMs: finite(item.gsMs) ? item.gsMs : 0, onStand, followed,
  });
}

/** Whether the browser can draw WebGL2 at all (jsdom and very old browsers cannot): the 3D is off by default there. */
export function supportsWebgl2() {
  return typeof globalThis.WebGL2RenderingContext === 'function';
}

/**
 * The browser's 2D/3D choice: true for 3D, false for 2D. Without a stored choice, 3D where the browser can draw it
 * (contracts 2.3: 3D on by default in Aeródromo and Rampa). A browser that refuses storage keeps the default.
 */
export function readMode3d(storage, { webgl = supportsWebgl2() } = {}) {
  try {
    const stored = storage?.getItem(MODE_3D_STORAGE_KEY);
    if (stored === '3d') return true;
    if (stored === '2d') return false;
  } catch {
    // A browser that refuses storage keeps the default.
  }
  return webgl === true;
}

/** Remembers the choice; a browser that refuses storage remembers nothing. */
export function writeMode3d(storage, on) {
  try {
    storage?.setItem(MODE_3D_STORAGE_KEY, on ? '3d' : '2d');
  } catch {
    // Nothing to remember it in.
  }
}

/**
 * The aircraft the stands draw (design F4, PR M6) as the instance plan takes them: one per stand whose display shows an
 * aircraft on it to scale (its footprint `solid`: Ocupada or Por liberar with a known type), at the stand's centre, nose
 * along its heading. Its id is that of the ELEVANT aircraft parked there (`parkedIds`, the stands' own, by its
 * turnaround), else `s:<code>`; a stand whose visit has an aircraft of the traffic that is not parked (still moving)
 * draws none, so no aircraft is drawn twice. M9: it carries what names its airline for its livery
 * (aircraft/liveries.js: resolveLivery), the owner's `airlineIcao`, `airlineIata` and `callsign`, and the stand's
 * flight number.
 */
export function parkedFromStands(stands = [], aircraft = [], parkedIds = NO_IDS) {
  const byTurnaround = new Map();
  for (const item of Array.isArray(aircraft) ? aircraft : []) {
    if (item?.turnaroundId != null && item.kind === 'aviam') byTurnaround.set(item.turnaroundId, item);
  }
  const parked = [];
  const codes = new Set();
  for (const stand of Array.isArray(stands) ? stands : []) {
    if (stand === null || typeof stand !== 'object' || isRetired(stand)) continue;
    const { display, geometry } = stand;
    if (display?.footprint !== 'solid' || !display.typeSpec) continue;
    if (!Array.isArray(geometry?.center) || !finite(geometry.headingTrue)) continue;
    const code = mapStandCode(standCodeOf(stand));
    if (code === '' || codes.has(code)) continue;
    const type = display.aircraftType ?? null;
    if (resolveAircraftType({ typeIcao: type, model: type }).iconCategory === 'unknown') continue;
    const owner = byTurnaround.get(display.visit?.turnaroundId);
    if (owner && !parkedIds.has(owner.id)) continue;
    codes.add(code);
    parked.push({
      id: owner ? owner.id : `s:${code}`,
      lon: geometry.center[0],
      lat: geometry.center[1],
      headingDeg: geometry.headingTrue,
      typeIcao: type,
      model: type,
      kind: 'aviam',
      // M9 and PR M5: what names the airline of the aircraft parked there (its owner's callsign and codes, else the
      // stand's flight), for the livery its model wears (aircraft/liveries.js); null where nothing names it.
      airlineIcao: owner?.airlineIcao ?? null,
      airlineIata: owner?.airlineIata ?? null,
      callsign: owner?.callsign ?? null,
      flightNumber: owner?.flightNumber ?? display.flightNumber ?? null,
    });
  }
  return parked;
}

/**
 * The traffic aircraft parked on each stand (M4, «Seguir en 3D»): a Map from the stand's code to the selection of the
 * AVIAM aircraft of the traffic that is on its box for the stand's visit (`parkedIds`, stands/standFeatures.js:
 * parkedAircraftIds), `{ kind, id }` as a click on that aircraft selects it, frozen. A double click on such a stand, or
 * its inspector's «Seguir en 3D», follows that aircraft; a stand whose aircraft the traffic does not draw has none.
 */
export function parkedTrafficByStand(stands = [], aircraft = [], parkedIds = NO_IDS) {
  const drawn = Array.isArray(aircraft) ? aircraft : [];
  const byTurnaround = new Map();
  for (const item of drawn) {
    if (item?.turnaroundId != null && item.kind === 'aviam' && parkedIds.has(item.id)) byTurnaround.set(item.turnaroundId, item);
  }
  const targets = new Map();
  if (byTurnaround.size === 0) return targets;
  for (const stand of Array.isArray(stands) ? stands : []) {
    if (stand === null || typeof stand !== 'object' || isRetired(stand)) continue;
    const owner = byTurnaround.get(stand.display?.visit?.turnaroundId);
    if (!owner) continue;
    const code = mapStandCode(standCodeOf(stand));
    if (code === '' || targets.has(code)) continue;
    const hit = translatePick({ id: owner.id }, drawn);
    if (hit !== null) targets.set(code, Object.freeze({ kind: hit.kind, id: hit.id }));
  }
  return targets;
}

/**
 * What a 3D pick names, as the 2D picking names it (core/mapEngine.js: pickAt): `f:<flightKey>` a flight, `h:<hex>`
 * an aircraft of other traffic, `s:<code>` the stand whose parked aircraft it is. `drawn` (the aircraft of the last
 * write) says what an id of the traffic is. Answers `{ kind, id, feature }`, with the traffic's feature id for the
 * hover card and the focused tag, or null.
 */
export function translatePick(picked, drawn = []) {
  const id = typeof picked?.id === 'string' ? picked.id : null;
  if (id === null) return null;
  if (id.startsWith('s:')) return { kind: 'stand', id: id.slice(2), feature: null };
  const item = (Array.isArray(drawn) ? drawn : []).find(entry => entry?.id === id) ?? null;
  const feature = { source: TRAFFIC_SOURCE, layer: { id: AIRCRAFT_3D_PICK_LAYER }, properties: { id } };
  const flightKey = item?.flightKey ?? (id.startsWith('f:') ? id.slice(2) : null);
  if (item?.kind === 'aviam' && flightKey) return { kind: 'flight', id: flightKey, feature };
  if (id.startsWith('f:') && item === null) return { kind: 'flight', id: id.slice(2), feature };
  const hex = item?.hex ?? (id.startsWith('h:') ? id.slice(2) : null);
  return hex ? { kind: 'aircraft', id: hex, feature } : null;
}

/**
 * The governor's arithmetic, without a map: `sample(dtMs, atMs, { continuous })` takes the time between two frames the
 * map drew and answers the step to take (`-1` down, `+1` up, `0` none). `continuous` false (PR M2) says the map was not
 * drawing every frame across that time (a render a write asked for with a still camera): the time is no frame's cost
 * and the window starts again, as after a gap. `level` starts at 0; `setFollowing(on)` keeps it out of the pause while a
 * flight is followed; `reset()` forgets the frames.
 */
export function createGovernor({ limits = GOVERNOR, following = false } = {}) {
  let frames = [];
  let windowStart = null;
  let fastSince = null;
  let level = 0;
  let follow = following;
  const lowest = () => (follow ? GOVERNOR_PAUSED - 1 : GOVERNOR_PAUSED);
  return {
    get level() {
      return level;
    },
    set level(next) {
      level = Math.max(0, Math.min(GOVERNOR_PAUSED, next));
    },
    setFollowing(on) {
      follow = on === true;
    },
    reset() {
      frames = [];
      windowStart = null;
      fastSince = null;
    },
    sample(dtMs, atMs, { continuous = true } = {}) {
      if (continuous !== true || !finite(dtMs) || !finite(atMs) || dtMs <= 0 || dtMs > limits.maxGapMs) {
        // The map idled: what comes next is a new stretch of drawing.
        frames = [];
        windowStart = null;
        fastSince = null;
        return 0;
      }
      if (windowStart === null) windowStart = atMs - dtMs;
      frames.push([atMs, dtMs]);
      while (frames.length > 0 && frames[0][0] < atMs - limits.windowMs) frames.shift();
      if (atMs - windowStart < limits.windowMs || frames.length === 0) return 0;
      const mean = frames.reduce((total, [, dt]) => total + dt, 0) / frames.length;
      if (mean > limits.slowFrameMs) {
        fastSince = null;
        if (level >= lowest()) return 0;
        level += 1;
        frames = [];
        windowStart = null;
        return -1;
      }
      fastSince ??= atMs;
      if (level === 0 || level >= GOVERNOR_PAUSED || atMs - fastSince < limits.stableMs) return 0;
      level -= 1;
      fastSince = atMs;
      return 1;
    },
  };
}

/**
 * The 3D aircraft of one map engine (core/mapEngine.js). `originLngLat` the ARP, `fieldElevationM` the field's height,
 * `theme` the colours of the aircraft (aircraft/instancePlan.js: aircraft3dColors), `getNow()` the instant of the
 * map's render clock (the sun is read at it), `onChange()` hears every change of what the 3D draws or says (OccMap then
 * writes its traffic again and shows the notice), `governor` false switches the governor off (the map lab), and
 * `load`, `now` and `webgl` (whether the browser has WebGL2) are for tests. `liveries` (M9, Mapa de posiciones): every
 * aircraft the 3D draws wears its airline's livery (aircraft/instancePlan.js: liveryInstanceColours), and other traffic
 * on the ground within GROUND_TRAFFIC_3D_RADIUS_M of the ARP is drawn in 3D too while the governor is at full quality
 * (its first step down, the lighter scene, gives it back to 2D).
 *
 * - `setEnabled(on)`: the 3D mode; off removes the layer (and its renderer) from the map;
 * - `plan({ aircraft, parked, zoom, minZoom, selectedId, followedId })`: the aircraft of a write of the traffic; plans
 *   them, loads the chunk the first time the zoom reaches `minZoom` with 3D on, and answers the ids whose 2D symbol
 *   gives way (none while the layer is not drawing: loading, failed, paused, off, or below the threshold). Each
 *   aircraft near the airfield is pitched, banked and set at its height over the field (aircraft/attitude.js, eased
 *   over time). CN-30: `followedId` («Seguir en 3D») draws that aircraft with its detailed model and livery
 *   (aircraft/aircraftDetail.js) at any zoom and distance, even while the 3D is off or paused for the rest (the chunk is
 *   loaded for it and the layer added; the governor never pauses it); without one, the chosen aircraft gets the
 *   detailed model from DETAIL_MIN_ZOOM while the 3D draws. Its id is among the answered ones while the layer draws it;
 *   `poseFollowed(sample)` poses it again from a sample of the frame (the follow camera's), between the writes;
 * - `pick(point)`: what the 3D draws under a pixel, `{ kind: 'aircraft', id }` with the plan's id, or null;
 * - `setFollowing(on)`, `pause()` and `resume()` («Volver a 3D»), `state()` → `{ enabled, status, notice, level,
 *   follow }` (status `off` · `idle` · `loading` · `ready` · `failed` · `paused`; notice `null` · `failed` · `paused`;
 *   follow, the followed aircraft's 3D: `off` without one, `loading`, `ready`, or `failed` when the browser cannot draw
 *   3D, so the map says it shows it in 2D), `stats()` (the layer's, or null) and `dispose()`; PR M2: `framePosition(id)`
 *   and `framedCount()`, what the last animated frame drew.
 * - PR M2: `animate` (with `frameTime()`, the frame loop's instant, and `frameZone()`, the area in sight and its margin)
 *   lets `plan({ …, animation: { keyframes }, parkedIds })` hand the layer the keyframes of a write of moving traffic: the
 *   layer then draws every aircraft each frame, in 2D too, and `plan` answers all their ids; `animating()` says whether
 *   it does and `animationMoving(tMs)` whether a frame at that instant moves one (the map repaints those frames). The
 *   same plan takes what the tags need: `focusId` (the aircraft under the pointer), `labelsOn` («Etiquetas de todo el
 *   tráfico»), `language`, `shown` (`{ aviam, other }`, false for a group the layers menu hides), `otherGroundMinZoom`
 *   (other traffic on the ground from that zoom up) and `otherTagsMinZoom` (the tags of all traffic from that zoom up).
 * - Integration of M2 with M4, M8 and M9: the animated frames plan the models with the liveries and the ground traffic
 *   near the field (`liveries`), so the parked aircraft keep their airline's colours, and with their contact shadows;
 *   close up (`engine.isCloseUp()`, «Seguir en 3D» past zoom 19.5) they draw no tag and no ring, and the followed
 *   aircraft no estimated ring or «Demo» plate (as the GeoJSON layers hide them); `setOutside(ids)` dims the aircraft
 *   Monitoreo's board filter leaves out (OccMap's flightEmphasis), as the feature state `outside` dims their icons.
 */
export function createAircraft3dController({
  engine, originLngLat, fieldElevationM = 0, theme = 'dark', getNow = () => Date.now(), onChange,
  governor: governed = true, load = loadAircraft3d, now = () => globalThis.performance?.now() ?? Date.now(),
  webgl = supportsWebgl2, liveries = false, animate = false, frameTime = null, frameZone = null,
} = {}) {
  const colors = aircraft3dColors(theme);
  const governor = createGovernor();
  let enabled = false;
  let status = 'off';
  let notice = null;
  let modules = null;
  let layer = null;
  let added = false;
  let layerFailed = false;
  let loading = false;
  let failedAt = null;
  let disposed = false;
  let revision = 0;
  let current = { revision: 0, plan: new Map() };
  let drawnIds = NO_IDS;
  let lastFrameAt = null;
  // Whether the map drew the last frame while it animated continuously (PR M2: what the governor measures).
  let lastContinuous = false;
  let basePixelRatio = null;
  // CN-30: the eased attitude of every aircraft the 3D draws, the followed aircraft («Seguir en 3D»: always in 3D, its
  // detailed model, even while the 3D is off or paused for the rest) and what the last plan drew in detail.
  const attitudes = createAttitudeTracker();
  let followedId = null;
  let followingCamera = false;
  let detailFound = null;
  let detailRevision = 0;
  // The zoom and the chosen aircraft of the last plan: a zoom across DETAIL_MIN_ZOOM plans again (the chosen aircraft
  // gets or loses its detailed model) without waiting for the traffic's next write.
  let lastPlanZoom = null;
  let lastSelectedId = null;
  // PR M2: what the last write gave the animation (`{ keyframes, items, parked, parkedIds, selectedId, zoom, minZoom,
  // eased }`), whether the layer's sprites could not be built, and the last frame's answer.
  let animation = null;
  let spritesFailed = false;
  let frameCache = null;
  // The aircraft the layer's last animated frame drew, by id, where it drew them (PR M2: the frame meter and the visual
  // suite read the positions on screen, not those of the last write).
  let frameDrawn = new Map();
  // M8 (integration with M2): the aircraft Monitoreo's board filter leaves out, dimmed in the animated frames too.
  let outsideIds = NO_IDS;

  const changed = () => {
    if (!disposed) onChange?.();
  };

  function setStatus(next, nextNotice = notice) {
    if (status === next && notice === nextNotice) return;
    status = next;
    notice = nextNotice;
    changed();
  }

  function applyLevel(level) {
    if (layer === null) return;
    const light = level >= 1;
    layer.setQuality({ shadows: !light, dropLines: !light });
    if (typeof engine?.setPixelRatio !== 'function') return;
    basePixelRatio ??= engine.getPixelRatio?.() ?? null;
    const ratio = level >= 2 ? GOVERNOR.pixelRatios[Math.min(level - 2, GOVERNOR.pixelRatios.length - 1)] : null;
    if (ratio === null || !finite(basePixelRatio)) {
      if (finite(basePixelRatio)) engine.setPixelRatio(basePixelRatio);
      return;
    }
    engine.setPixelRatio(Math.min(ratio, basePixelRatio));
  }

  function restorePixelRatio() {
    if (finite(basePixelRatio)) engine?.setPixelRatio?.(basePixelRatio);
  }

  function removeLayer() {
    if (!added || layer === null) return;
    added = false;
    layerFailed = false;
    engine?.removeCustomLayer(layer.id);
    restorePixelRatio();
  }

  function addLayer() {
    if (added || layer === null || disposed) return;
    added = true;
    engine?.addCustomLayer(layer, AIRCRAFT_3D_SLOT);
    applyLevel(governor.level);
  }

  // A zoom across DETAIL_MIN_ZOOM with an aircraft chosen asks the map for a new plan (its onChange writes the traffic).
  function checkDetailZoom() {
    if (lastSelectedId === null || followedId !== null || !finite(lastPlanZoom)) return;
    const zoom = engine?.getCamera?.()?.zoom;
    if (!finite(zoom) || (zoom >= DETAIL_MIN_ZOOM) === (lastPlanZoom >= DETAIL_MIN_ZOOM)) return;
    lastPlanZoom = zoom;
    // After this frame: the map's onChange writes the traffic, never inside the layer's render.
    Promise.resolve().then(changed);
  }

  // Whether the map draws every frame now (PR M2): the animated traffic moves (the frame loop repaints each frame), the
  // followed aircraft is posed every frame («Seguir en 3D»), or the camera moves.
  function drawingContinuously() {
    if (animating() && keyframesMoving(animation.keyframes, typeof frameTime === 'function' ? frameTime() : now())) {
      return true;
    }
    if (followingCamera && followedId !== null) return true;
    return engine?.map?.isMoving?.() === true;
  }

  // Each frame the map draws with the 3D on: the governor hears how long it took since the previous one, when both were
  // drawn while the map animates continuously (PR M2: never the gap between two writes of the traffic). The animated 2D
  // traffic draws no model: the governor has nothing to lighten then.
  function onRendered() {
    checkDetailZoom();
    const at = now();
    const dt = lastFrameAt === null ? null : at - lastFrameAt;
    lastFrameAt = at;
    const continuousNow = drawingContinuously();
    const continuous = continuousNow && lastContinuous;
    lastContinuous = continuousNow;
    if (!governed || dt === null || (!enabled && followedId === null)) return;
    const before = governor.level;
    const step = governor.sample(dt, at, { continuous });
    if (step === 0) return;
    if (governor.level >= GOVERNOR_PAUSED) {
      pauseNow();
      return;
    }
    applyLevel(governor.level);
    // M9: the ground traffic's 3D follows the full quality; after this frame the map writes its traffic again.
    if (liveries === true && (before === 0) !== (governor.level === 0)) Promise.resolve().then(changed);
  }

  function createLayer() {
    const made = modules.createAircraft3dLayer({
      three: modules.three,
      originLngLat,
      getInstances: () => (animating() ? frameAnswer() : current),
      getSun: () => sunPosition(getNow(), originLngLat),
      minModelPx: MIN_MODEL_PX,
      theme,
      onFailedChange: failed => {
        layerFailed = failed === true;
        // With the 3D off only the animation drew (PR M2): no 3D notice, the map just writes its icons again.
        if (!enabled && followedId === null) changed();
        else setStatus(layerFailed ? 'failed' : 'ready', layerFailed ? 'failed' : null);
      },
      onSpritesFailedChange: failed => {
        spritesFailed = failed === true;
        // After this frame: the map's onChange writes its icons again, never inside the layer's render.
        Promise.resolve().then(() => {
          syncForcedLayer();
          changed();
        });
      },
    });
    const render = made.render.bind(made);
    made.render = (...args) => {
      render(...args);
      onRendered();
    };
    return made;
  }

  function startLoad() {
    if (loading || modules !== null || disposed) return;
    if (failedAt !== null && now() - failedAt < RETRY_LOAD_MS) return;
    // A browser without WebGL2 draws no 3D: nothing to load.
    if (!webgl()) {
      failedAt = now();
      // With the 3D off only the followed aircraft asked: its follow status says it (state().follow).
      if (enabled) setStatus('failed', 'failed');
      else changed();
      return;
    }
    loading = true;
    if (enabled) setStatus('loading', notice === 'failed' ? 'failed' : null);
    load().then(loaded => {
      loading = false;
      if (disposed) return;
      modules = loaded;
      failedAt = null;
      try {
        layer = createLayer();
      } catch (error) {
        console.warn('The 3D aircraft could not be drawn; the map keeps its 2D aircraft.', error);
        modules = null;
        failedAt = now();
        setStatus('failed', 'failed');
        return;
      }
      if (!enabled || status === 'paused') {
        setStatus(enabled ? status : 'off');
        // The followed aircraft still draws in 3D.
        if (forced()) {
          addLayer();
          changed();
        }
        return;
      }
      showLayer();
    }, () => {
      loading = false;
      if (disposed) return;
      failedAt = now();
      setStatus(enabled ? 'failed' : 'off', enabled ? 'failed' : null);
    });
  }

  // The layer on the map, then the word: the map's next write of its traffic already hides what the 3D draws. A layer
  // that failed while it was added has said so.
  function showLayer() {
    layerFailed = false;
    addLayer();
    if (!layerFailed) setStatus('ready', null);
  }

  function pauseNow() {
    governor.level = GOVERNOR_PAUSED;
    governor.reset();
    lastFrameAt = null;
    lastContinuous = false;
    // The followed aircraft keeps its layer: only the rest of the 3D pauses.
    if (!forced()) removeLayer();
    setStatus('paused', 'paused');
  }

  const drawing = () => enabled && added && !layerFailed && status === 'ready' && engine?.map != null;
  // PR M2: the animation wants the layer while the write gave it keyframes and the browser can draw it.
  const wantsAnimation = () => animate === true && !spritesFailed && animation !== null && !disposed && webgl();
  const animating = () => wantsAnimation() && added && !layerFailed && layer !== null && engine?.map != null;
  // The followed aircraft forces the layer onto the map even while the 3D is off or paused for the rest; so does the
  // animated traffic.
  const forced = () => (followedId !== null && detailFound !== null) || wantsAnimation();
  const drawingDetail = () => added && !layerFailed && engine?.map != null && (forced() || drawing());

  // The eased attitude of an aircraft at the controller's clock (aircraft/attitude.js).
  function attitudeOf(item, onStand) {
    return attitudes.update(item.id, item, { nowMs: now(), fieldElevationM, onStand });
  }

  // The detailed aircraft of the plan, posed again: a new revision of the instances the layer reads.
  function poseDetail(found) {
    const attitude = attitudeOf(found.item, found.onStand);
    const detail = detailOf(found, attitude, { followed: followedId !== null && found.item.id === followedId });
    detailRevision += 1;
    return detail === null ? null : Object.freeze({ ...detail, revision: detailRevision });
  }

  // While a flight is followed the layer stays on the map for its detailed model; once it is not, a map whose 3D is
  // off or paused takes the layer off again.
  function syncForcedLayer() {
    if (forced()) {
      if (modules === null) startLoad();
      else if (layer !== null && !added && !disposed) {
        layerFailed = false;
        addLayer();
      }
      return;
    }
    if (added && (!enabled || status === 'paused')) removeLayer();
  }

  // The words of the tags of a write (PR M2): every ELEVANT flight's, and other traffic's while chosen, under the
  // pointer or with all the tags on.
  function tagWordsOf(items, { selectedId, focusId, labelsOn, language }) {
    const words = new Map();
    for (const item of items) {
      if (!isDrawn(item)) continue;
      if (item.kind !== 'aviam' && !labelsOn && item.id !== selectedId && item.id !== focusId) continue;
      words.set(item.id, tagTextOf(item, { language }));
    }
    return words;
  }

  // The ids the animation draws: every aircraft of the write (their GeoJSON icons, rings and plates give way).
  function animatedIdsOf(aircraft) {
    const ids = new Set();
    for (const item of Array.isArray(aircraft) ? aircraft : []) if (item?.id != null && isDrawn(item)) ids.add(item.id);
    return ids;
  }

  // Whether the animation draws an aircraft (PR M2): the layers menu shows its group (the chosen one always shows, as
  // the selection's own layers draw it), and other traffic on the ground only from its threshold up.
  function shownAt(item, onGround, zoom) {
    if (item.id === animation.selectedId) return true;
    const aviam = item.kind === 'aviam';
    if (animation.shown[aviam ? 'aviam' : 'other'] === false) return false;
    if (aviam || onGround !== true || !finite(animation.otherGroundMinZoom)) return true;
    return finite(zoom) && zoom >= animation.otherGroundMinZoom;
  }

  // The band of the zoom for the frame cache: below or above each threshold the frame's answer depends on.
  function zoomBand(zoom) {
    if (animation === null || !finite(zoom)) return '';
    return [animation.otherGroundMinZoom, animation.otherTagsMinZoom, TAG_DECLUTTER_UNTIL_ZOOM]
      .map(limit => (finite(limit) && zoom >= limit ? 1 : 0)).join('');
  }

  // One frame of the animated traffic (PR M2): the keyframes at the frame loop's instant, for the aircraft in or around
  // the area in sight, planned as models (3D) and sprites. A frame where nothing moves, after one that already rested
  // at the same write, bearing and area in sight, answers that one, so the layer copies nothing.
  function frameAnswer() {
    const t = typeof frameTime === 'function' ? frameTime() : now();
    const camera = engine?.getCamera?.() ?? null;
    const bearing = camera?.bearing ?? 0;
    // A zoom across the threshold of other traffic on the ground or of the tags draws another frame.
    const zoomKey = zoomBand(camera?.zoom);
    const moving = keyframesMoving(animation.keyframes, t);
    const zone = typeof frameZone === 'function' ? frameZone() : null;
    const zoneKey = Array.isArray(zone) ? zone.flat().join(',') : '';
    const closeUp = engine?.isCloseUp?.() === true;
    if (!moving && frameCache !== null && frameCache.rest && frameCache.animation === animation
      && frameCache.bearing === bearing && frameCache.zoneKey === zoneKey && frameCache.detail === current.detail
      && frameCache.zoomKey === zoomKey && frameCache.closeUp === closeUp && frameCache.outsideIds === outsideIds) {
      return frameCache.answer;
    }
    const states = interpolate(animation.keyframes, t, { include: zone ? point => isInBounds(point, zone) : null });
    const items = [];
    const frameEased = new Map();
    const zoom = camera?.zoom;
    for (const [id, state] of states) {
      const base = animation.items.get(id);
      if (base === undefined || !shownAt(base, state.onGround, zoom)) continue;
      const item = { ...base, lon: state.lon, lat: state.lat, onGround: state.onGround,
        altM: finite(state.altM) ? state.altM : base.altM, gsMs: finite(state.gsMs) ? state.gsMs : base.gsMs,
        trackDeg: finite(state.trackDeg) ? state.trackDeg : base.trackDeg,
        opacity: finite(state.opacity) ? state.opacity : base.opacity };
      items.push(item);
      // The attitude eased at the write, at this frame's height: the climb or descent between two writes is smooth.
      const attitude = animation.eased.get(id);
      if (attitude !== undefined) {
        const climb = finite(item.altM) && finite(base.altM) && item.onGround !== true ? item.altM - base.altM : 0;
        frameEased.set(id, { ...attitude, heightM: Math.max(0, attitude.heightM + climb) });
      }
    }
    // The detailed aircraft where this frame draws it; the followed one is posed by the follow camera (poseFollowed).
    let detail = current.detail ?? null;
    if (detail !== null && detail.followed !== true && detailFound !== null && !detailFound.onStand) {
      const moved = items.find(item => item.id === detail.id);
      if (moved !== undefined) detail = poseDetail({ item: moved, onStand: false });
    }
    const models = enabled && status === 'ready'
      ? planInstances(items, animation.parked, { zoom: animation.zoom, minZoom: animation.minZoom, originLngLat,
        fieldElevationM, selectedId: animation.selectedId, colors, attitudes: frameEased,
        excludeId: detail?.id ?? null, radiusNm: Infinity, livery: liveries === true,
        groundRadiusM: liveries === true && governor.level === 0 ? GROUND_TRAFFIC_3D_RADIUS_M : 0 })
      : new Map();
    const modelIds = new Set();
    for (const entry of models.values()) for (const id of entry.ids) if (id !== null) modelIds.add(id);
    if (detail !== null) modelIds.add(detail.id);
    const sprites = planSprites(items, { originLngLat, theme, selectedId: animation.selectedId, modelIds,
      parkedIds: animation.parkedIds, outsideIds, closeUpId: closeUp ? animation.selectedId : null });
    const labels = planLabels(items, { originLngLat, selectedId: animation.selectedId, focusId: animation.focusId,
      labelsOn: animation.labelsOn, zoom, words: animation.words, parkedIds: animation.parkedIds,
      language: animation.language, otherTagsMinZoom: animation.otherTagsMinZoom, outsideIds, closeUp });
    // At rest the layer lays the tags out once more where the aircraft stopped.
    labels.rest = !moving;
    revision += 1;
    frameDrawn = new Map(items.map(item => [item.id, item]));
    const answer = { revision, plan: models, detail, sprites, labels };
    frameCache = { animation, bearing, zoneKey, zoomKey, detail: current.detail, answer, rest: !moving, closeUp,
      outsideIds };
    return answer;
  }

  function followStatus() {
    if (followedId === null) return 'off';
    if (layerFailed || (modules === null && failedAt !== null)) return 'failed';
    return added && detailFound !== null ? 'ready' : 'loading';
  }

  return {
    setEnabled(on) {
      const next = on === true;
      if (next === enabled) return;
      enabled = next;
      lastFrameAt = null;
      lastContinuous = false;
      governor.reset();
      if (!enabled) {
        if (!forced()) removeLayer();
        governor.level = 0;
        setStatus('off', null);
        return;
      }
      governor.level = 0;
      if (layer !== null) showLayer();
      else setStatus('idle', null);
    },

    plan({
      aircraft = [], parked = [], zoom, minZoom, selectedId = null, followedId: followed = null, animation: frames = null,
      parkedIds = NO_IDS, focusId = null, labelsOn = false, language = 'es', shown = null, otherGroundMinZoom = null,
      otherTagsMinZoom = null,
    } = {}) {
      if (disposed) {
        drawnIds = NO_IDS;
        return drawnIds;
      }
      const followChanged = (followed ?? null) !== followedId;
      followedId = followed ?? null;
      lastPlanZoom = finite(zoom) ? zoom : null;
      lastSelectedId = selectedId ?? null;
      governor.setFollowing(followingCamera || followedId !== null);
      const followFound = followedId === null ? null : findAircraft(aircraft, parked, followedId);
      const reached = finite(zoom) && finite(minZoom) && zoom >= minZoom;
      // The detailed model: the followed aircraft, else the chosen one up close while the 3D draws.
      let found = followFound;
      if (found === null && enabled && status === 'ready' && reached && finite(zoom) && zoom >= DETAIL_MIN_ZOOM) {
        found = findAircraft(aircraft, parked, selectedId);
      }
      detailFound = found;
      // PR M2: the keyframes of this write, for the frames until the next one.
      animation = animate === true && frames?.keyframes != null ? {
        keyframes: frames.keyframes,
        items: new Map((Array.isArray(aircraft) ? aircraft : []).filter(item => item?.id != null)
          .map(item => [item.id, item])),
        parked, parkedIds: parkedIds instanceof Set ? parkedIds : NO_IDS, selectedId: selectedId ?? null, zoom, minZoom,
        eased: new Map(), focusId: focusId ?? null, labelsOn: labelsOn === true, language,
        shown: { aviam: shown?.aviam !== false, other: shown?.other !== false },
        otherGroundMinZoom: finite(otherGroundMinZoom) ? otherGroundMinZoom : null,
        otherTagsMinZoom: finite(otherTagsMinZoom) ? otherTagsMinZoom : null,
        words: null,
      } : null;
      // The words of the tags that may show, once per write: the frames between only move them.
      if (animation !== null) animation.words = tagWordsOf(animation.items.values(), animation);
      if (!enabled && found === null && !wantsAnimation()) {
        syncForcedLayer();
        current = { revision: (revision += 1), plan: new Map(), detail: null };
        drawnIds = NO_IDS;
        // Said after this write, never inside it (the map's onChange writes the traffic again).
      if (followChanged) Promise.resolve().then(changed);
        return drawnIds;
      }
      if (((enabled && reached) || wantsAnimation()) && modules === null) startLoad();
      syncForcedLayer();
      // The attitude of every aircraft the plan may draw: near the airfield, and the detailed one wherever it is.
      const eased = new Map();
      const kept = new Set();
      for (const item of Array.isArray(aircraft) ? aircraft : []) {
        if (item?.id == null || !isDrawn(item) || !finite(item.lon) || !finite(item.lat)) continue;
        if (item.id !== found?.item.id && haversineM(originLngLat, [item.lon, item.lat]) > ATTITUDE_RADIUS_M) continue;
        kept.add(item.id);
        if (item.id === found?.item.id) continue;
        const attitude = attitudeOf(item, false);
        if (attitude !== null) eased.set(item.id, attitude);
      }
      const detail = found === null ? null : poseDetail(found);
      if (found !== null) kept.add(found.item.id);
      attitudes.retain(kept);
      if (animation !== null) animation.eased = eased;
      const plan = enabled && status !== 'paused'
        ? planInstances(aircraft, parked, { zoom, minZoom, originLngLat, fieldElevationM, selectedId, colors,
          attitudes: eased, excludeId: detail?.id ?? null, livery: liveries === true,
          groundRadiusM: liveries === true && governor.level === 0 ? GROUND_TRAFFIC_3D_RADIUS_M : 0 })
        : new Map();
      revision += 1;
      current = { revision, plan, detail };
      frameCache = null;
      if (animating()) {
        // Every aircraft of the write, as a model or a sprite, each frame (PR M2).
        drawnIds = animatedIdsOf(aircraft);
        if (followChanged) Promise.resolve().then(changed);
        engine.map.triggerRepaint?.();
        return drawnIds;
      }
      const ids = new Set();
      if (drawing()) {
        for (const entry of plan.values()) {
          for (const id of entry.ids) if (id !== null) ids.add(id);
        }
      }
      if (detail !== null && drawingDetail()) ids.add(detail.id);
      if (followChanged) Promise.resolve().then(changed);
      if (ids.size === 0) {
        drawnIds = NO_IDS;
        return drawnIds;
      }
      drawnIds = ids;
      // The 2D write may change nothing the map draws: the 3D still needs the frame that shows the new plan.
      engine.map.triggerRepaint?.();
      return ids;
    },

    /**
     * Poses the detailed aircraft again from a sample of this frame (CN-30, «Seguir en 3D»: the same sample the follow
     * camera eases to), so the model moves with the camera every frame between the writes of the traffic. Answers
     * whether it did: the sample must be the aircraft the last plan drew in detail.
     */
    poseFollowed(item) {
      if (disposed || item == null || detailFound === null || item.id !== detailFound.item.id) return false;
      if (!finite(item.lon) || !finite(item.lat)) return false;
      detailFound = { item, onStand: detailFound.onStand };
      const detail = poseDetail(detailFound);
      current = { ...current, detail };
      if (drawingDetail()) engine.map.triggerRepaint?.();
      return detail !== null;
    },

    /** The ids the last plan drew in 3D (their 2D symbols give way). */
    drawnIds: () => drawnIds,

    /** PR M2: whether the layer animates the traffic now (its GeoJSON icons, rings and plates give way). */
    animating: () => animating(),

    /** PR M2: whether a frame at `tMs` moves an aircraft the layer animates: the map repaints every such frame. */
    animationMoving: tMs => animating() && keyframesMoving(animation.keyframes, tMs),

    /**
     * The pose of the detailed aircraft the layer draws now (CN-30): `{ id, lon, lat, heightM, headingDeg, pitchDeg,
     * bankDeg, gearDown, onStand, followed, … }` (detailOf), or null. The follow camera aims at its height over the
     * field and turns with its heading.
     */
    followedPose: () => current.detail ?? null,

    pick(point) {
      if ((!drawing() && !animating()) || layer === null) return null;
      try {
        return layer.pick(point);
      } catch {
        return null;
      }
    },

    setFollowing(on) {
      followingCamera = on === true;
      governor.setFollowing(followingCamera || followedId !== null);
    },

    pause() {
      if (!enabled) return;
      pauseNow();
    },

    resume() {
      if (!enabled || status !== 'paused') return;
      governor.level = 0;
      governor.reset();
      lastFrameAt = null;
      lastContinuous = false;
      if (layer !== null) showLayer();
      else setStatus('idle', null);
    },

    state: () => ({ enabled, status, notice, level: governor.level, follow: followStatus() }),

    stats: () => (layer === null || !added ? null : layer.stats()),

    // PR M2: where the last animated frame drew an aircraft, `[lng, lat]`, or null (not animated, or not in that frame);
    // `framedCount()` how many aircraft that frame drew (0 while the layer does not animate).
    framePosition(id) {
      if (!animating()) return null;
      const item = frameDrawn.get(id);
      return item === undefined ? null : [item.lon, item.lat];
    },
    framedCount: () => (animating() ? frameDrawn.size : 0),

    /**
     * M8 (integration with M2): the ids of the aircraft Monitoreo's board filter leaves out (a Set; anything else is
     * none), dimmed in the animated frames as their GeoJSON icons are; the next frame draws them so.
     */
    setOutside(ids) {
      const next = ids instanceof Set && ids.size > 0 ? new Set(ids) : NO_IDS;
      if (next.size === outsideIds.size && [...next].every(id => outsideIds.has(id))) return;
      outsideIds = next;
      frameCache = null;
      if (animating()) engine.map.triggerRepaint?.();
    },

    dispose() {
      if (disposed) return;
      removeLayer();
      disposed = true;
      layer = null;
    },
  };
}
