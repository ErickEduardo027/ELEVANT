import { haversineM, initialBearing } from '../airport/geo.js';
import { angleDiff } from './smoothing.js';

/** The turn from one bearing to another the short way (kinematics/smoothing.js: angleDiff), for the camera's fly-in. */
export { angleDiff as angleDiffDeg } from './smoothing.js';

// «Seguir en 3D» (CN-30): the camera of follow mode in 3D, locked on the followed aircraft as its pivot. The person
// orbits it: a drag turns the camera round the aircraft (360°) and tilts it, the wheel or a pinch brings it closer, and
// the buttons of the follow panel do the same in steps or while held; «Girar automáticamente» turns it slowly. The
// views:
// - «Persecución» (chase): behind the aircraft and above it; the orbit offset is kept RELATIVE to the aircraft's track,
//   so a camera turned to its left stays on its left as it turns;
// - «Lateral» (side): the same, 90° to its left;
// - «Desde arriba» (top): straight down on the aircraft, its nose up the screen;
// - «Desde la torre» (tower): from the tower of Punta Cana, looking at the aircraft: the bearing is the tower's to it;
// - «Órbita libre» (orbit): the bearing is ABSOLUTE: the camera stays where the person put it while the aircraft turns.
// - «Muy cerca» (close, M4): a close chase, a little above the tail and some 25–40 m behind it by the type's length
//   (closeChaseZoom); the double click on an aircraft flies in to it. From zoom 19.5 on the map draws past its own
//   limit: setOrbitMode lifts it to 22 while the orbit has the camera.
// The pivot is the aircraft itself at its height above the field (MapLibre's centre elevation), so a turn never swings
// it off the screen. Every frame eases the camera there by exponential smoothing (no jump, no jitter). Pure: degrees,
// MapLibre zoom levels, metres; nothing here reads a clock or the map.

/** The limits and steps of the orbit. */
export const ORBIT = Object.freeze({
  minPitch: 0,
  maxPitch: 85,
  minZoom: 14.5,
  // M4 (2026-11-27): ultra close, past the map's own 19.5 (mapEngine.js: setOrbitMode lifts it while following).
  maxZoom: 22,
  rotateStepDeg: 15,
  tiltStepDeg: 10,
  zoomStep: 0.5,
  // Press-and-hold and «Girar automáticamente», in degrees (or zoom levels) a second.
  holdRotateDegS: 45,
  holdTiltDegS: 30,
  holdZoomS: 1.2,
  autoRotateDegS: 8,
  // A drag: degrees of turn and of tilt per pixel.
  dragDegPerPx: 0.35,
  tiltDegPerPx: 0.25,
  // The wheel: zoom levels per pixel of its delta.
  wheelZoomPerPx: 0.0025,
  // The time constant of the camera's smoothing, in seconds.
  tauS: 0.25,
});

/**
 * The views of the follow panel: `mode` 'relative' (offset from the aircraft's track), 'absolute' (a bearing of its own)
 * or 'tower'; `offsetDeg` where the camera sits round the aircraft (0 behind it, 90 on its left), `pitch` and `zoom`.
 */
export const ORBIT_VIEWS = Object.freeze({
  chase: Object.freeze({ mode: 'relative', offsetDeg: 0, pitch: 72, zoom: 18.3 }),
  side: Object.freeze({ mode: 'relative', offsetDeg: 90, pitch: 80, zoom: 18.4 }),
  top: Object.freeze({ mode: 'relative', offsetDeg: 0, pitch: 0, zoom: 17.8 }),
  tower: Object.freeze({ mode: 'tower', offsetDeg: 0, pitch: 70, zoom: 17.4 }),
  orbit: Object.freeze({ mode: 'absolute', offsetDeg: 0, pitch: 65, zoom: 18 }),
  // M4: the zoom is the type's (closeChaseZoom); this one stands for a 38 m airliner on a screen 800 px high.
  close: Object.freeze({ mode: 'relative', offsetDeg: 0, pitch: 74, zoom: 20.9 }),
});

/** The view names in the panel's order. */
export const ORBIT_VIEW_NAMES = Object.freeze(['chase', 'close', 'side', 'top', 'tower', 'orbit']);

/** The zoom beyond which the camera is close up (M4): the map hides the labels that would crowd the aircraft. */
export const CLOSE_UP_ZOOM = 19.5;

/** «Muy cerca» (M4): how far behind the tail the camera sits, `factor` times the type's length within these metres. */
export const CLOSE_CHASE = Object.freeze({
  behindTailFactor: 0.7, minBehindTailM: 25, maxBehindTailM: 40, lengthM: 38,
  // M4 (2026-11-28): the nearest the camera may come, in metres beyond half the type's length (closestOrbitZoom): at
  // zoom 22 on a short map MapLibre's camera stands some 13–21 m from the pivot, inside a fuselage.
  clearanceM: 12,
});

// MapLibre: the metres of one pixel at zoom 0 on the equator (512 px tiles), and the camera's distance to the centre of
// the map in screen heights (its field of view of 36.87°: half the height over tan(18.43°)).
const METRES_PER_PX_Z0 = 40_075_016.686 / 512;
const CAMERA_HEIGHTS = 1.5;

/**
 * The zoom of «Muy cerca» for an aircraft `lengthM` long (38 m when unknown) at latitude `latDeg`, on a map
 * `viewportHeightPx` high (800 px when unknown): the camera, MapLibre's 1.5 heights from the pivot, stands half the
 * length plus 25–40 m (0.7 lengths) behind it, within the orbit's zoom.
 */
export function closeChaseZoom({ lengthM = null, latDeg = 0, viewportHeightPx = null } = {}) {
  const length = lengthOf(lengthM);
  const behind = clamp(length * CLOSE_CHASE.behindTailFactor, CLOSE_CHASE.minBehindTailM, CLOSE_CHASE.maxBehindTailM);
  return zoomAtDistance(length / 2 + behind, { latDeg, viewportHeightPx });
}

/**
 * The nearest zoom of the orbit round an aircraft `lengthM` long (M4): the camera stays half the length plus
 * CLOSE_CHASE.clearanceM from the pivot, never inside the model, whatever the person zooms; within the orbit's zoom.
 */
export function closestOrbitZoom({ lengthM = null, latDeg = 0, viewportHeightPx = null } = {}) {
  return zoomAtDistance(lengthOf(lengthM) / 2 + CLOSE_CHASE.clearanceM, { latDeg, viewportHeightPx });
}

const lengthOf = lengthM => (finite(lengthM) && lengthM > 0 ? lengthM : CLOSE_CHASE.lengthM);

// The zoom at which MapLibre's camera, 1.5 map heights (800 px when unknown) from the pivot, stands `distanceM` from it.
function zoomAtDistance(distanceM, { latDeg, viewportHeightPx }) {
  const height = finite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 800;
  const metresPerPxZ0 = METRES_PER_PX_Z0 * Math.cos(((finite(latDeg) ? latDeg : 0) * Math.PI) / 180);
  return clamp(Math.log2((CAMERA_HEIGHTS * height * metresPerPxZ0) / distanceM), ORBIT.minZoom, ORBIT.maxZoom);
}

/**
 * The control tower of Punta Cana, where «Desde la torre» looks from: north of the runways by the terminals, about
 * 50 m high. Approximate (not taken from the AIP): it sets the direction the camera looks from, nothing is drawn there.
 */
export const PUJ_TOWER = Object.freeze({ point: Object.freeze([-68.3652, 18.5716]), heightM: 50 });

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** An angle in [0, 360). */
export function wrap360(degrees) {
  if (!finite(degrees)) return 0;
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
}

/** A bearing in MapLibre's (−180, 180]. */
function wrap180(degrees) {
  const wrapped = wrap360(degrees);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * The orbit of a view, frozen: `{ view, mode, offsetDeg, bearingDeg, pitch, zoom, auto }`. `bearingDeg` is the
 * absolute bearing of 'absolute' mode (taken from the aircraft's track behind it when a view switches to it). `zoom`,
 * when given, replaces the view's own within the orbit's limits («Muy cerca»: closeChaseZoom).
 */
export function createOrbit(view = 'chase', { trackDeg = 0, auto = false, zoom = null } = {}) {
  const preset = ORBIT_VIEWS[view] ?? ORBIT_VIEWS.chase;
  const name = ORBIT_VIEWS[view] ? view : 'chase';
  return Object.freeze({
    view: name,
    mode: preset.mode,
    offsetDeg: preset.offsetDeg,
    bearingDeg: wrap360((finite(trackDeg) ? trackDeg : 0) + preset.offsetDeg),
    pitch: preset.pitch,
    zoom: finite(zoom) ? clamp(zoom, ORBIT.minZoom, ORBIT.maxZoom) : preset.zoom,
    auto: auto === true,
  });
}

/** The orbit turned by `deltaDeg` round the aircraft (positive: the camera moves clockwise, seen from above). */
export function orbitRotate(orbit, deltaDeg) {
  if (!finite(deltaDeg) || deltaDeg === 0) return orbit;
  // A turn from the tower view leaves the tower: the camera orbits freely from where it is.
  const mode = orbit.mode === 'tower' ? 'absolute' : orbit.mode;
  return Object.freeze({
    ...orbit,
    mode,
    view: orbit.mode === 'tower' ? 'orbit' : orbit.view,
    offsetDeg: wrap360(orbit.offsetDeg + deltaDeg),
    bearingDeg: wrap360(orbit.bearingDeg + deltaDeg),
  });
}

/** The orbit tilted by `deltaDeg` (positive: towards the horizon), within 0–85°. */
export function orbitTilt(orbit, deltaDeg) {
  if (!finite(deltaDeg) || deltaDeg === 0) return orbit;
  return Object.freeze({ ...orbit, pitch: clamp(orbit.pitch + deltaDeg, ORBIT.minPitch, ORBIT.maxPitch) });
}

/** The orbit `delta` zoom levels closer (negative: farther), within its limits. */
export function orbitZoom(orbit, delta) {
  if (!finite(delta) || delta === 0) return orbit;
  return Object.freeze({ ...orbit, zoom: clamp(orbit.zoom + delta, ORBIT.minZoom, ORBIT.maxZoom) });
}

/** The orbit with «Girar automáticamente» on or off. */
export function orbitAuto(orbit, on) {
  return orbit.auto === (on === true) ? orbit : Object.freeze({ ...orbit, auto: on === true });
}

/**
 * The orbit after `dtS` seconds of what is held (`hold`: `{ rotate, tilt, zoom }`, each −1, 0 or 1) and of the
 * automatic turn.
 */
export function orbitAdvance(orbit, dtS, hold = null) {
  const dt = finite(dtS) ? Math.max(0, Math.min(dtS, 0.25)) : 0;
  if (dt === 0) return orbit;
  let next = orbit;
  const rotate = (hold?.rotate ?? 0) * ORBIT.holdRotateDegS + (orbit.auto ? ORBIT.autoRotateDegS : 0);
  if (rotate !== 0) next = orbitRotate(next, rotate * dt);
  if (hold?.tilt) next = orbitTilt(next, hold.tilt * ORBIT.holdTiltDegS * dt);
  if (hold?.zoom) next = orbitZoom(next, hold.zoom * ORBIT.holdZoomS * dt);
  return next;
}

/**
 * The camera the orbit aims at for an aircraft (`{ lon, lat, altM, onGround, trackDeg }`, as the frame draws it):
 * `{ center: [lng, lat], elevation, bearing, pitch, zoom }`, frozen, or null without a position. The pivot is the
 * aircraft at its height above the field (`fieldElevationM`; 0 on the ground or below the field). The camera looks
 * along `bearing`, so it sits on the opposite side: behind the aircraft is its own track. 'relative' turns with the
 * track, 'absolute' keeps its bearing, 'tower' looks from `tower` to the aircraft and tilts by the angle the tower sees
 * it at, between 20° and the orbit's own tilt. `heightM`, when given, is the height the 3D model is drawn at and the
 * pivot's elevation.
 */
export function orbitTarget(orbit, aircraft, { fieldElevationM = 0, tower = PUJ_TOWER, heightM = null } = {}) {
  if (!orbit || !aircraft || !finite(aircraft.lon) || !finite(aircraft.lat)) return null;
  const center = [aircraft.lon, aircraft.lat];
  let above = aircraft.onGround === true || !finite(aircraft.altM) ? 0 : Math.max(0, aircraft.altM - fieldElevationM);
  // The height the 3D model is drawn at, when the map knows it (its attitude, eased): the pivot is the model itself.
  if (finite(heightM)) above = Math.max(0, heightM);
  const track = finite(aircraft.trackDeg) ? aircraft.trackDeg : 0;
  let bearing;
  let { pitch } = orbit;
  if (orbit.mode === 'absolute') bearing = orbit.bearingDeg;
  else if (orbit.mode === 'tower' && tower?.point) {
    const distanceM = haversineM(tower.point, center);
    bearing = distanceM < 1 ? track : initialBearing(tower.point, center);
    // The tower looks down at what is on the ground and up at what flies over it.
    const lookDeg = (Math.atan2(distanceM, Math.max(1, (tower.heightM ?? 50) - above)) * 180) / Math.PI;
    pitch = clamp(Math.min(orbit.pitch, lookDeg), 20, ORBIT.maxPitch);
  } else bearing = track + orbit.offsetDeg;
  return Object.freeze({
    center: Object.freeze(center),
    elevation: above,
    bearing: wrap180(bearing),
    pitch: clamp(pitch, ORBIT.minPitch, ORBIT.maxPitch),
    zoom: clamp(orbit.zoom, ORBIT.minZoom, ORBIT.maxZoom),
  });
}

/**
 * One frame of the orbit camera: `current` (`{ center, zoom, pitch, bearing, elevation? }`) eased toward `target` over
 * `dtS` seconds (each value covers 1 − e^(−dt/τ) of what is left, the bearing the short way). The centre and its
 * elevation follow the aircraft exactly (it is the pivot; the frame already draws it where it is smooth); without a
 * current camera, or after a gap of more than a second, it is the target.
 */
export function stepOrbitCamera(current, target, dtS, tauS = ORBIT.tauS) {
  if (!target) return current ?? null;
  const usable = current && finite(current.zoom) && finite(current.pitch) && finite(current.bearing)
    && finite(dtS) && dtS > 0 && dtS <= 1;
  if (!usable) return target;
  const k = 1 - Math.exp(-dtS / tauS);
  const bearing = wrap180(current.bearing + angleDiff(current.bearing, target.bearing) * k);
  return Object.freeze({
    center: target.center,
    elevation: target.elevation,
    bearing,
    pitch: current.pitch + (target.pitch - current.pitch) * k,
    zoom: current.zoom + (target.zoom - current.zoom) * k,
  });
}

/**
 * A drag of the person (`dxPx`, `dyPx`, pixels the pointer moved): the camera turns round the aircraft with the
 * horizontal move (to the right: the camera goes left round it, as the map follows the hand) and tilts with the
 * vertical one (up: towards the horizon).
 */
export function orbitDrag(orbit, dxPx, dyPx) {
  const turned = orbitRotate(orbit, finite(dxPx) ? -dxPx * ORBIT.dragDegPerPx : 0);
  return orbitTilt(turned, finite(dyPx) ? -dyPx * ORBIT.tiltDegPerPx : 0);
}

/** The wheel (`deltaPx`, its vertical delta: positive away from the person) as a zoom of the orbit. */
export function orbitWheel(orbit, deltaPx) {
  return orbitZoom(orbit, finite(deltaPx) ? -deltaPx * ORBIT.wheelZoomPerPx : 0);
}
