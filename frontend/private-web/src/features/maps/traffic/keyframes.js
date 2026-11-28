import { TRACK_CONFIG } from '../kinematics/handoff.js';
import { angleDiff } from '../kinematics/smoothing.js';

// The traffic layer's keyframes (PR M2, «Capa de tráfico animada»). Every traffic write (core/OccMap.jsx: writeTraffic,
// at the cadence CN-18 keeps) stores, for each aircraft it sampled, a pair of states from the motion store
// (traffic/motionStore.js): where it is drawn at the write (`sample`) and where it will be at the next write
// (`sampleAhead`). Every frame in between interpolates the pair at the render clock's time, so the aircraft move at
// the screen's rate while the motion store is asked twice per write and the GeoJSON is not written each frame.
//
// - Position: a cubic Hermite in a local east-north plane (metres), from the velocity the aircraft is drawn with at the
//   write (the previous pair's, so the speed carries on across writes) to the chord of the pair at its end; a straight
//   path at a steady speed stays exactly straight. Altitude, speed and opacity: linear. Heading: the short way
//   (359° → 1° turns 2°, never 358°). `onGround` changes at the middle of the pair.
// - Before its first instant a pair holds its first state, after its last its last: past HOLD_AFTER_MS (a frame or
//   so, the time the next write may take to come) nothing is extrapolated, so a write that comes late leaves the
//   aircraft where the motion store said, not beyond.
// - Continuity: a new pair starts where the previous one draws the aircraft at that instant, so a small difference
//   between the motion store's state and the drawn one (a new fix blended in, a heading turned) is absorbed over the
//   pair instead of jumping. A difference beyond the motion store's snap distances (TRACK_CONFIG: 2 NM in the air,
//   150 m on the ground), a new trail part (`trailEpoch`) or an aircraft seen for the first time snaps: the pair starts
//   from the motion store's state and its `epoch` moves on, so whatever the layer keeps across frames starts over.
//
// Pure: explicit '.js' imports, no clock, no DOM; the only state is the store object the caller holds.

/** Earth radius (m) of the local plane the positions are interpolated in. */
const EARTH_M = 6_371_008.8;
const DEG = Math.PI / 180;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const normalizeDeg = deg => ((deg % 360) + 360) % 360;
const lerp = (a, b, u) => a + (b - a) * u;
const lerpFinite = (a, b, u) => (finite(a) && finite(b) ? lerp(a, b, u) : (finite(b) && u >= 1 ? b : a));

/** A new, empty keyframe store: `{ byId: Map(id → pair), writtenAt }`. */
export function createKeyframes() {
  return { byId: new Map(), writtenAt: null };
}

/** The east-north offset (m) of `[lon, lat]` from `origin`, on the plane tangent at the origin's latitude. */
function toPlane(origin, lon, lat) {
  return [(lon - origin.lon) * DEG * EARTH_M * Math.cos(origin.lat * DEG), (lat - origin.lat) * DEG * EARTH_M];
}
function fromPlane(origin, e, n) {
  return { lon: origin.lon + e / (EARTH_M * Math.cos(origin.lat * DEG) * DEG), lat: origin.lat + n / (EARTH_M * DEG) };
}

/** The distance (m) between two states on the local plane. */
export function planeDistanceM(a, b) {
  const [e, n] = toPlane(a, b.lon, b.lat);
  return Math.hypot(e, n);
}

const keyOf = state => Object.freeze({
  lon: state.lon,
  lat: state.lat,
  altM: finite(state.altM) ? state.altM : null,
  gsMs: finite(state.gsMs) ? state.gsMs : null,
  trackDeg: finite(state.trackDeg) ? normalizeDeg(state.trackDeg) : null,
  onGround: state.onGround === true,
  opacity: finite(state.opacity) ? state.opacity : 1,
});

const positioned = state => state != null && finite(state.lon) && finite(state.lat);

/** The snap distance (m) for a state: TRACK_CONFIG's on the ground or in the air. */
export function snapLimitM(state, config = TRACK_CONFIG) {
  return state?.onGround === true ? config.snapGroundM : config.snapAirM;
}

/**
 * How long after its last instant a pair still carries the aircraft on at its end velocity (ms): the write that
 * replaces it runs at the first frame past that instant, up to a frame late, and the aircraft should not stop for it.
 * Past it the pair holds: nothing is extrapolated further.
 */
export const HOLD_AFTER_MS = 50;

/**
 * The state of a pair at `tMs`: `{ lon, lat, altM, gsMs, trackDeg, onGround, opacity, velocity: [e, n] (m/s) }`. Held at
 * its first state before `t0Ms`; after `t1Ms` carried on at its end velocity for HOLD_AFTER_MS at most, then held.
 */
function evaluate(pair, tMs) {
  const { k0, k1, t0Ms, t1Ms } = pair;
  const spanS = (t1Ms - t0Ms) / 1000;
  if (!finite(tMs) || tMs < t0Ms) return { ...k0, velocity: [0, 0] };
  if (!(spanS > 0)) return { ...k1, velocity: [0, 0] };
  const [ce, cn] = pair.chord;
  if (tMs >= t1Ms) {
    const overS = Math.min(tMs - t1Ms, HOLD_AFTER_MS) / 1000;
    const v1 = [ce / spanS, cn / spanS];
    const { lon, lat } = fromPlane(k0, ce + v1[0] * overS, cn + v1[1] * overS);
    return { ...k1, lon, lat, velocity: tMs - t1Ms <= HOLD_AFTER_MS ? v1 : [0, 0] };
  }
  const u = (tMs - t0Ms) / (t1Ms - t0Ms);
  // Cubic Hermite on the plane from k0 (the origin): p(u) = h10·m0 + h01·c + h11·m1, the tangents in metres over the
  // pair (m0 the velocity it starts with, m1 the chord c).
  const u2 = u * u;
  const u3 = u2 * u;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const m0e = pair.v0[0] * spanS;
  const m0n = pair.v0[1] * spanS;
  const e = h10 * m0e + (h01 + h11) * ce;
  const n = h10 * m0n + (h01 + h11) * cn;
  // Its derivative (m/s): the velocity the next pair starts from.
  const d10 = 3 * u2 - 4 * u + 1;
  const d1 = -3 * u2 + 4 * u;
  const velocity = [(d10 * m0e + d1 * ce) / spanS, (d10 * m0n + d1 * cn) / spanS];
  const { lon, lat } = fromPlane(k0, e, n);
  const turn = finite(k0.trackDeg) && finite(k1.trackDeg) ? angleDiff(k0.trackDeg, k1.trackDeg) : Number.NaN;
  const trackDeg = finite(turn) ? normalizeDeg(k0.trackDeg + turn * u) : (k0.trackDeg ?? k1.trackDeg);
  return {
    lon,
    lat,
    altM: lerpFinite(k0.altM, k1.altM, u),
    gsMs: lerpFinite(k0.gsMs, k1.gsMs, u),
    trackDeg,
    onGround: u < 0.5 ? k0.onGround : k1.onGround,
    opacity: lerp(k0.opacity, k1.opacity, u),
    velocity,
  };
}

/**
 * Stores the keyframes of one traffic write in `store` (createKeyframes), and answers it:
 * - `t0Ms`: the write's instant; `t1Ms`: the next write's (t0Ms + the write interval);
 * - `from`: the aircraft the write drew at `t0Ms` (motionStore.sample's answer, `null` entries skipped);
 * - `ahead`: where they are drawn at `t1Ms` (motionStore.sampleAhead), by index or as a Map by id; an aircraft without
 *   one (not sampled again, out of the area in sight, or its track draws nothing then) holds at `from`;
 * - `config`: the snap distances (TRACK_CONFIG by default).
 * An aircraft the write no longer draws leaves the store.
 */
export function writeKeyframes(store, { t0Ms, t1Ms, from, ahead = null, config = TRACK_CONFIG } = {}) {
  const list = Array.isArray(from) ? from : [];
  const aheadOf = index => {
    if (ahead instanceof Map) return ahead.get(list[index]?.id) ?? null;
    return Array.isArray(ahead) ? ahead[index] ?? null : null;
  };
  const end = finite(t1Ms) && t1Ms > t0Ms ? t1Ms : t0Ms;
  const next = new Map();
  list.forEach((item, index) => {
    if (!positioned(item)) return;
    const previous = store.byId.get(item.id) ?? null;
    const later = aheadOf(index);
    const target = positioned(later) ? keyOf(later) : keyOf(item);
    const epochOf = state => (finite(state?.trailEpoch) ? state.trailEpoch : null);
    const trailEpoch = epochOf(later) ?? epochOf(previous) ?? null;
    let start = keyOf(item);
    let v0 = null;
    let epoch = previous ? previous.epoch : 0;
    const drawn = previous ? evaluate(previous, t0Ms) : null;
    const newPart = previous !== null && epochOf(later) !== null && epochOf(previous) !== null
      && epochOf(later) !== epochOf(previous);
    if (drawn && !newPart && planeDistanceM(drawn, item) <= snapLimitM(item, config)) {
      // Carried on from where the previous pair draws it, at the speed it draws it with.
      start = keyOf({ ...item, lon: drawn.lon, lat: drawn.lat, trackDeg: drawn.trackDeg ?? item.trackDeg });
      v0 = drawn.velocity;
    } else if (previous) epoch += 1;
    const spanS = (end - t0Ms) / 1000;
    const chord = toPlane(start, target.lon, target.lat);
    if (v0 === null) v0 = spanS > 0 ? [chord[0] / spanS, chord[1] / spanS] : [0, 0];
    next.set(item.id, Object.freeze({
      id: item.id, t0Ms, t1Ms: end, k0: start, k1: target, chord, v0, epoch, trailEpoch,
    }));
  });
  store.byId = next;
  store.writtenAt = t0Ms;
  return store;
}

/**
 * Every aircraft of `store` where it is drawn at `tMs`: a Map id → `{ id, lon, lat, altM, gsMs, trackDeg, onGround,
 * opacity, epoch }`. The motion store is not asked: this is what each frame between two writes draws. `include([lon,
 * lat])`, when given, keeps only the pairs whose either end it accepts (the animated layer: the area in sight and its
 * margin), so a frame works out no aircraft nobody sees.
 */
export function interpolate(store, tMs, { include = null } = {}) {
  const out = new Map();
  for (const [id, pair] of store?.byId ?? []) {
    if (typeof include === 'function' && !include([pair.k0.lon, pair.k0.lat]) && !include([pair.k1.lon, pair.k1.lat])) {
      continue;
    }
    const { velocity: _velocity, ...state } = evaluate(pair, tMs);
    out.set(id, Object.freeze({ id, ...state, epoch: pair.epoch }));
  }
  return out;
}

/** Whether a frame at `tMs` still moves anything: an instant inside a pair whose states differ. */
export function keyframesMoving(store, tMs) {
  for (const pair of store?.byId?.values?.() ?? []) {
    if (!(tMs < pair.t1Ms)) continue;
    const { k0, k1 } = pair;
    if (k0.lon !== k1.lon || k0.lat !== k1.lat || k0.altM !== k1.altM || k0.trackDeg !== k1.trackDeg
      || k0.opacity !== k1.opacity) return true;
  }
  return false;
}
