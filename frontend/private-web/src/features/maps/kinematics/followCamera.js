import { EARTH_RADIUS_M, haversineM } from '../airport/geo.js';
import { GATE_NM } from './pathBuilder.js';
import { angleDiff } from './smoothing.js';
import { NM, ktToMs } from './units.js';

// Follow mode of the OCC map (PR M6, design A6, contracts 2.1 `follow=1`): the camera frames a followed aircraft and
// its next objective, never the aircraft alone. En route and descending it frames the aircraft and the airport; within
// 40 NM, the aircraft and the runway threshold; on final it zooms in as the aircraft nears the threshold; on the
// ground it centres on the aircraft, closer the slower it goes; within 250 m of its stand (or of the apron hold where
// it waits) it shows the stand up close, tilted in 3D. A departure is the same, the other way round. The map resolves a
// framing with its own cameraForBounds (the floating panels as padding, the zoom capped at `maxZoom`) and eases there
// with stepCamera every frame; a user pan ends follow mode and a user zoom freezes the automatic zoom (run in OccMap).
// Pure: nothing here reads a clock, the viewport or the map. Zoom levels are MapLibre's; distances in metres, speeds
// in m/s, `[lng, lat]`; explicit '.js' imports, no JSON.

/**
 * The zoom levels and tilts of follow mode: the largest zoom en route and on the approach, the final's zoom from the
 * gate to the threshold, the ground's from fast to slow, the stand's, the radius around the stand where it applies,
 * and the pitch in 3D at the stand and on the ground (the airfield view's 40°, contracts 2.3). In 2D the pitch is 0.
 */
export const FOLLOW_ZOOM = Object.freeze({
  enrouteMax: 8,
  approachMax: 11.5,
  finalFrom: 12.5,
  finalTo: 13.8,
  groundFrom: 14.5,
  groundTo: 15.5,
  standZoom: 17,
  standRadiusM: 250,
  stand3dPitch: 50,
  ground3dPitch: 40,
});

/**
 * Where each framing applies: within `approachRadiusM` of the airport the threshold is framed instead of it; the
 * final's zoom ramps over the last `finalGateM` (the approach gate of pathBuilder.js); on the ground the zoom is
 * `groundTo` up to `groundSlowMs` and `groundFrom` from `groundFastMs`; a framed box grows on each side by
 * `marginRatio` of the distance it spans, `marginMinM` at least, so the aircraft never sits on the edge.
 */
export const FOLLOW_RANGES = Object.freeze({
  approachRadiusM: 40 * NM,
  finalGateM: GATE_NM * NM,
  groundSlowMs: ktToMs(30),
  groundFastMs: ktToMs(130),
  marginRatio: 0.1,
  marginMinM: 500,
});

/** How fast stepCamera closes in on its target: the time constant of its exponential smoothing, in seconds. */
export const FOLLOW_TAU_S = 0.8;

// The trajectory phases on the ground (estimator.js), for an aircraft that does not say whether it is.
const GROUND_PHASES = new Set(['landing', 'taxiIn', 'holding', 'parked', 'pushback', 'taxiOut', 'takeoff']);
// The phases whose zoom ramps with the distance to the threshold: the final, and the initial climb of a departure.
const RUNWAY_PHASES = new Set(['final', 'climb']);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const pointOf = value => (Array.isArray(value) && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : null);
const toDegrees = radians => (radians * 180) / Math.PI;
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function centred(center, zoom, pitch) {
  return Object.freeze({ kind: 'center', center: Object.freeze([center[0], center[1]]), zoom, pitch });
}

/** The box around two points grown by the framing margin, as MapLibre takes bounds: `[[west, south], [east, north]]`. */
function framed(a, b, maxZoom) {
  const marginM = Math.max(FOLLOW_RANGES.marginMinM, FOLLOW_RANGES.marginRatio * haversineM(a, b));
  const west = Math.min(a[0], b[0]);
  const east = Math.max(a[0], b[0]);
  const south = Math.min(a[1], b[1]);
  const north = Math.max(a[1], b[1]);
  const dLat = toDegrees(marginM / EARTH_RADIUS_M);
  const farthest = (Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180;
  const dLng = toDegrees(marginM / (EARTH_RADIUS_M * Math.cos(farthest)));
  return Object.freeze({
    kind: 'bounds',
    bounds: Object.freeze([Object.freeze([west - dLng, south - dLat]), Object.freeze([east + dLng, north + dLat])]),
    maxZoom,
    pitch: 0,
  });
}

/** The ground zoom for a speed: `groundTo` when slow, `groundFrom` when fast, linear between. */
function groundZoom(gsMs) {
  const { groundSlowMs, groundFastMs } = FOLLOW_RANGES;
  const u = Math.min(1, Math.max(0, ((finite(gsMs) ? gsMs : 0) - groundSlowMs) / (groundFastMs - groundSlowMs)));
  return FOLLOW_ZOOM.groundTo - u * (FOLLOW_ZOOM.groundTo - FOLLOW_ZOOM.groundFrom);
}

/**
 * The camera of follow mode for an aircraft (a render of kinematics/handoff.js or a trajectory sample: `{ lon, lat,
 * onGround, gsMs, phase }`), frozen: `{ kind: 'bounds', bounds: [[w, s], [e, n]], maxZoom, pitch }` or `{ kind:
 * 'center', center: [lng, lat], zoom, pitch }`; `null` without a position.
 * - `phase`: the trajectory phase (the aircraft's own by default); `targets`: `{ airport, threshold, stand, apronHold }`
 *   as `[lng, lat]` (the threshold of the runway it lands on or departs from; the stand, else the apron hold, it
 *   taxis to or leaves); `mode3d`: whether the map is in 3D.
 * - On the ground (its `onGround`, else a ground phase): within 250 m of the stand or apron hold, the point between it
 *   and the aircraft at zoom 17 (pitch 50 in 3D); otherwise the aircraft at 15.5 up to 30 kt, down to 14.5 from
 *   130 kt (a landing or a take-off roll), pitch 40 in 3D.
 * - On final (and in the initial climb of a departure) within 10 NM of the threshold: the point between the aircraft
 *   and the threshold, from zoom 12.5 at 10 NM to 13.8 at the threshold.
 * - Otherwise within 40 NM of the airport: the aircraft and the threshold, up to zoom 11.5; farther, the aircraft and
 *   the airport, up to 8. In the air the pitch is 0.
 */
export function followCamera({ aircraft = null, phase = null, targets = {}, mode3d = false } = {}) {
  if (!aircraft || !finite(aircraft.lon) || !finite(aircraft.lat)) return null;
  const here = [aircraft.lon, aircraft.lat];
  const kinematicPhase = phase ?? aircraft.phase ?? null;
  const onGround = typeof aircraft.onGround === 'boolean' ? aircraft.onGround : GROUND_PHASES.has(kinematicPhase);
  if (onGround) {
    const objective = pointOf(targets?.stand) ?? pointOf(targets?.apronHold);
    if (objective !== null && haversineM(here, objective) <= FOLLOW_ZOOM.standRadiusM) {
      return centred(midpoint(here, objective), FOLLOW_ZOOM.standZoom, mode3d ? FOLLOW_ZOOM.stand3dPitch : 0);
    }
    return centred(here, groundZoom(aircraft.gsMs), mode3d ? FOLLOW_ZOOM.ground3dPitch : 0);
  }
  const threshold = pointOf(targets?.threshold);
  const airport = pointOf(targets?.airport) ?? threshold;
  if (threshold !== null && RUNWAY_PHASES.has(kinematicPhase)) {
    const distance = haversineM(here, threshold);
    if (distance <= FOLLOW_RANGES.finalGateM) {
      const u = distance / FOLLOW_RANGES.finalGateM;
      return centred(midpoint(here, threshold), FOLLOW_ZOOM.finalTo - u * (FOLLOW_ZOOM.finalTo - FOLLOW_ZOOM.finalFrom), 0);
    }
  }
  if (airport === null) return centred(here, FOLLOW_ZOOM.enrouteMax, 0);
  if (haversineM(here, airport) <= FOLLOW_RANGES.approachRadiusM) {
    return framed(here, threshold ?? airport, FOLLOW_ZOOM.approachMax);
  }
  return framed(here, airport, FOLLOW_ZOOM.enrouteMax);
}

/** An angle in (−180, 180]: a bearing in MapLibre's range, or a longitude; one already in it is left as it is. */
function wrap180(degrees) {
  if (degrees > -180 && degrees <= 180) return degrees;
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** The share of what is left that one step of `dtS` seconds covers: 1 − e^(−dt/τ); 0 for no time, 1 for no limit. */
function stepShare(dtS, tauS) {
  const dt = finite(dtS) || dtS === Infinity ? Math.max(0, dtS) : 0;
  if (dt === 0) return 0;
  if (dt === Infinity || !(finite(tauS) && tauS > 0)) return 1;
  return 1 - Math.exp(-dt / tauS);
}

/**
 * One frame of follow mode: the camera `current` (`{ center: [lng, lat], zoom, pitch, bearing? }`) moved toward
 * `target` (the same shape: a 'center' framing as it is, or a 'bounds' one the map resolved) by exponential smoothing
 * over `dtS` seconds with the time constant `tauS`: each value covers 1 − e^(−dt/τ) of what is left, so it never
 * overshoots, and two steps of `dt` land where one of `2·dt` does. The longitude and the bearing go the short way.
 * Frozen; `current` stays for no time, the target for an unbounded one or without a current camera.
 */
export function stepCamera(current, target, dtS, tauS = FOLLOW_TAU_S) {
  const to = pointOf(target?.center);
  if (to === null) return current ?? null;
  const from = pointOf(current?.center);
  const k = from === null ? 1 : stepShare(dtS, tauS);
  const toward = (a, b) => {
    if (finite(a) && finite(b)) {
      if (k === 0) return a;
      return k >= 1 ? b : a + (b - a) * k;
    }
    return finite(b) ? b : (finite(a) ? a : null);
  };
  let lng = to[0];
  if (k < 1) lng = k === 0 ? from[0] : wrap180(from[0] + angleDiff(from[0], to[0]) * k);
  const camera = {
    center: Object.freeze([lng, toward(from?.[1], to[1])]),
    zoom: toward(current?.zoom, target.zoom),
    pitch: toward(current?.pitch, target.pitch),
  };
  if (finite(current?.bearing) || finite(target.bearing)) {
    let bearing = finite(target.bearing) ? target.bearing : current.bearing;
    if (finite(current?.bearing) && finite(target.bearing) && k < 1) {
      bearing = k === 0 ? current.bearing : wrap180(current.bearing + angleDiff(current.bearing, target.bearing) * k);
    }
    camera.bearing = bearing;
  }
  return Object.freeze(camera);
}
