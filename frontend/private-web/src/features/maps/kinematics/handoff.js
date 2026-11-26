import { destinationPoint, fromEnu, haversineM, nearestOnPolyline, pointAlong, toEnu } from '../airport/geo.js';
import { sampleTrajectory, trajectoryLine } from './estimator.js';
import { headingAt } from './legs.js';
import { HEADING_RATES, angleDiff } from './smoothing.js';
import { normalizeDeg } from './units.js';

// The hand-off between live positions and estimates on the OCC map (PR M6, design F4, contracts 1.3). A track holds
// what the map knows of one aircraft: its last ADS-B fix, the trajectory planned for it (an ELEVANT flight), a blend
// in progress and the part of its trail it is on. Where it is drawn is derived from the time, never stored:
// - LIVE, a fix up to 15 s old: dead reckoning from the fix (its speed along its track, its height at its vertical
//   rate);
// - CN-31: on the ground a fix is carried on 3 s at most and then held: a real aircraft is never moved along an
//   estimated taxi route; once its fix ages it stays where it was reported (dimmed by its age) until it is dropped;
// - COAST, up to 60 s in the air: an ELEVANT flight advances along its planned path,
//   re-anchored where the fix projects on it, at the fix's speed; other traffic goes straight («Sin señal desde hace
//   N s»);
// - ESTIMATE, older: an ELEVANT flight follows the trajectory rebuilt from its last fix (the track store rebuilds it
//   when needsReplan says so and hands it over as a plan); other traffic fades out and is dropped at 120 s.
// A track without a fix (a demo flight, an ELEVANT flight without ADS-B) is an estimate from its plan alone. Each
// change of mode is eased over the blend time, so nothing jumps at 15 or 60 s. A new plan blends from where the
// aircraft is drawn over 6 s and a new fix over 1.5 s (CN-31), or snaps with a brief fade and a new trail part when the gap is more than 2 NM
// in the air or 150 m on the ground. The limits widen when the feed is slower than usual (`refreshAfterSeconds`).
// CN-18: an aircraft turning between its last two fixes is carried on along the arc of that turn (at most TURN.maxDegS
// for TURN.horizonS, then straight), so a new fix in a turn does not pull it back; a new plan of a flight drawn from its
// plan alone (no fix) blends over 10 to 20 s up to ten times the snap distance instead of snapping; and a blend that
// starts after the instant drawn (the render clock catching up) holds its starting state until then.
// SI units inside (metres, m/s, epoch milliseconds; seconds for ages and windows), degrees true, `[lng, lat]`. Pure:
// explicit '.js' imports, no clock, no randomness, no JSON; every track and every render is frozen.

/**
 * The age limits (s), the blends, the snap distances (m) and the fade after a snap (s) of the hand-off. CN-31: a new fix
 * blends in over `fixBlendS` (the mode changes and the plans keep `blendS`), and on the ground a fix is carried on at
 * most `groundReckonMaxS`: a real aircraft is drawn where it was reported, never along an estimated taxi route.
 */
export const TRACK_CONFIG = Object.freeze({
  liveMaxAgeS: 15,
  coastMaxAgeS: 60,
  groundCoastMaxAgeS: 20,
  blendS: 6,
  fixBlendS: 1.5,
  groundReckonMaxS: 3,
  snapAirM: 3704,
  snapGroundM: 150,
  dropOtherAfterS: 120,
  dropAviamAfterS: 600,
  snapFadeS: 1,
});

/**
 * The turn carried on from the last two fixes (CN-18): their turn rate in the air, from `minDegS` and at most `maxDegS`,
 * for `horizonS` seconds at most after the fix, from fixes up to `maxGapS` apart. On the ground no turn is carried on.
 */
export const TURN = Object.freeze({ minDegS: 0.2, maxDegS: 3, horizonS: 15, maxGapS: 30 });

/** The long blend of a plan-only change (CN-18): `minS` to `maxS`, for a gap up to `maxFactor` times the snap distance. */
export const PLAN_BLEND = Object.freeze({ minS: 10, maxS: 20, maxFactor: 10 });

/** The live limit is this many times the feed's pace: 15 s for the usual 10 s. */
export const LIVE_REFRESH_FACTOR = 1.5;

const AGE_LIMITS = Object.freeze(['liveMaxAgeS', 'coastMaxAgeS', 'groundCoastMaxAgeS', 'dropOtherAfterS', 'dropAviamAfterS']);

/**
 * The limits for a feed that asks to be read every `refreshAfterSeconds` (contracts 1.3): `base` itself while
 * 1.5 × refreshAfterSeconds is within its live limit; for a slower feed every age limit moves later by the same
 * amount, frozen, so the live limit becomes 1.5 × refreshAfterSeconds, every limit is at least that, and the coast
 * and fade windows keep their lengths. The blend, the snap distances and the fade after a snap do not change.
 */
export function trackConfigFor(refreshAfterSeconds, base = TRACK_CONFIG) {
  const refresh = typeof refreshAfterSeconds === 'number' && Number.isFinite(refreshAfterSeconds) ? refreshAfterSeconds : 0;
  const extraS = LIVE_REFRESH_FACTOR * refresh - base.liveMaxAgeS;
  if (!(extraS > 0)) return base;
  const widened = { ...base };
  for (const key of AGE_LIMITS) widened[key] = base[key] + extraS;
  return Object.freeze(widened);
}

/**
 * A track with nothing known yet, frozen: `{ id, kind: 'aviam' | 'other', lastFix: null, plan: null, blend: null,
 * trailEpoch: 0, snapAtMs: null, dropped: false }`. `aviam` is an ELEVANT flight (a plan can place it); anything else
 * is other traffic.
 */
export function createTrack({ id = null, kind = 'other' } = {}) {
  return Object.freeze({
    id, kind: kind === 'aviam' ? 'aviam' : 'other', lastFix: null, plan: null, blend: null, trailEpoch: 0, snapAtMs: null,
    dropped: false,
  });
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const orNull = value => (finite(value) ? value : null);
const clamp01 = value => Math.min(1, Math.max(0, value));
const ease = u => (u <= 0 ? 0 : (u >= 1 ? 1 : u * u * (3 - 2 * u)));
const lerp = (a, b, w) => a + (b - a) * w;

function lerpOrNull(a, b, w) {
  if (finite(a) && finite(b)) return lerp(a, b, w);
  return finite(b) ? b : orNull(a);
}

function mixHeading(a, b, w) {
  if (finite(a) && finite(b)) return normalizeDeg(a + angleDiff(a, b) * w);
  return finite(b) ? b : orNull(a);
}

/**
 * The turn rate (°/s, positive to the right) an airborne fix carries on from the fix before it (TURN), or 0: both
 * moving in the air, newer, at most TURN.maxGapS apart, turning at least TURN.minDegS.
 */
function turnRateOf(previous, fix) {
  if (!previous || fix.onGround || previous.onGround || !isMoving(previous) || !isMoving(fix)) return 0;
  const gapS = (fix.positionAt - previous.positionAt) / 1000;
  if (!(gapS > 0) || gapS > TURN.maxGapS) return 0;
  const rate = angleDiff(previous.trackDeg, fix.trackDeg) / gapS;
  if (!finite(rate) || Math.abs(rate) < TURN.minDegS) return 0;
  return Math.sign(rate) * Math.min(TURN.maxDegS, Math.abs(rate));
}

/** A fix in the map's units (traffic/situationModel.js) without what the hand-off does not read, frozen; `null` when unusable. */
function toFix(fix, turnDegS = 0) {
  if (!fix || !finite(fix.lon) || !finite(fix.lat) || !finite(fix.positionAt)) return null;
  return Object.freeze({
    lon: fix.lon,
    lat: fix.lat,
    altM: orNull(fix.altM),
    gsMs: finite(fix.gsMs) ? Math.max(0, fix.gsMs) : null,
    trackDeg: finite(fix.trackDeg) ? normalizeDeg(fix.trackDeg) : null,
    vrateMs: orNull(fix.vrateMs),
    onGround: fix.onGround === true,
    positionAt: fix.positionAt,
    turnDegS: finite(turnDegS) ? turnDegS : 0,
  });
}

/** Whether a state moves: a speed and a track, and on the ground at 2 kt or more (below that a track is noise). */
function isMoving(state) {
  return finite(state.gsMs) && state.gsMs > 0 && finite(state.trackDeg)
    && !(state.onGround === true && state.gsMs < HEADING_RATES.holdBelowMs);
}

/**
 * Where a moving state is `dt` seconds later turning at `turnDegS` for `turnS` of them and then straight, and its
 * track then: `{ point, trackDeg }`.
 */
function alongArc(state, dt, turnDegS) {
  const turnS = Math.min(dt, TURN.horizonS);
  const h0 = (state.trackDeg * Math.PI) / 180;
  const omega = (turnDegS * Math.PI) / 180;
  const v = state.gsMs;
  const h1 = h0 + omega * turnS;
  const straightS = dt - turnS;
  const east = (v / omega) * (Math.cos(h0) - Math.cos(h1)) + v * straightS * Math.sin(h1);
  const north = (v / omega) * (Math.sin(h1) - Math.sin(h0)) + v * straightS * Math.cos(h1);
  return { point: fromEnu([state.lon, state.lat], [east, north]), trackDeg: normalizeDeg(state.trackDeg + turnDegS * turnS) };
}

/**
 * Where a state is `dtS` seconds later: its speed along its track (along the arc of its turn, TURN, when it carries
 * one), its height at its vertical rate.
 */
function deadReckon(state, dtS) {
  // CN-31: on the ground a fix is carried on a few seconds at most, then held where that leaves it.
  const dt = state.onGround === true ? Math.min(Math.max(0, dtS), TRACK_CONFIG.groundReckonMaxS) : Math.max(0, dtS);
  const turning = dt > 0 && isMoving(state) && finite(state.turnDegS) && state.turnDegS !== 0;
  let trackDeg = orNull(state.trackDeg);
  let lon = state.lon;
  let lat = state.lat;
  if (turning) {
    const arc = alongArc(state, dt, state.turnDegS);
    [lon, lat] = arc.point;
    trackDeg = arc.trackDeg;
  } else if (dt > 0 && isMoving(state)) {
    [lon, lat] = destinationPoint([state.lon, state.lat], state.trackDeg, state.gsMs * dt);
  }
  const climbs = state.onGround !== true && finite(state.altM) && finite(state.vrateMs);
  return {
    lon,
    lat,
    altM: climbs ? Math.max(0, state.altM + state.vrateMs * dt) : orNull(state.altM),
    gsMs: orNull(state.gsMs),
    trackDeg,
    vrateMs: orNull(state.vrateMs),
    onGround: state.onGround === true,
    phase: state.phase ?? null,
    // Still turning while within the turn's horizon: a blend carries its starting state on along the same arc.
    turnDegS: turning && dt < TURN.horizonS ? state.turnDegS : 0,
  };
}

/** Two states mixed by `w` (0 → `a`, 1 → `b`): the position in the east-north plane of `a`, the heading the short way. */
function mix(a, b, w) {
  if (!(w > 0)) return a;
  if (w >= 1) return b;
  const origin = [a.lon, a.lat];
  const [x, y] = toEnu(origin, [b.lon, b.lat]);
  const [lon, lat] = fromEnu(origin, [x * w, y * w]);
  return {
    lon,
    lat,
    altM: lerpOrNull(a.altM, b.altM, w),
    gsMs: lerpOrNull(a.gsMs, b.gsMs, w),
    trackDeg: mixHeading(a.trackDeg, b.trackDeg, w),
    vrateMs: lerpOrNull(a.vrateMs, b.vrateMs, w),
    onGround: w < 0.5 ? a.onGround : b.onGround,
    phase: b.phase ?? a.phase ?? null,
    turnDegS: lerpOrNull(a.turnDegS, b.turnDegS, w),
  };
}

const coastLimitS = (fix, config) => (fix.onGround ? config.groundCoastMaxAgeS : config.coastMaxAgeS);
const snapLimitM = (onGround, config) => (onGround ? config.snapGroundM : config.snapAirM);
const planTrajectory = track => track.plan?.trajectory ?? null;
const ageOf = (track, tMs) => (track.lastFix ? Math.max(0, (tMs - track.lastFix.positionAt) / 1000) : null);

/** The fix instant a trajectory was rebuilt from (estimator.js: `meta.anchor` of kind 'fix'), or `null`. */
function anchorFixAtOf(trajectory) {
  const anchor = trajectory?.meta?.anchor;
  return anchor?.kind === 'fix' && finite(anchor.fix?.positionAt) ? anchor.fix.positionAt : null;
}

/** Whether the plan was built from the last fix, or the track has no fix and its plan is all there is. */
function planIsCurrent(track) {
  if (planTrajectory(track) === null) return false;
  return track.lastFix === null || track.plan.anchorFixAt === track.lastFix.positionAt;
}

const lines = new WeakMap();

/** The line a trajectory follows, measured for lookups by distance (cached per trajectory). */
function lineOf(trajectory) {
  let line = lines.get(trajectory);
  if (!line) {
    const { coords, cumM } = trajectoryLine(trajectory);
    line = Object.freeze({ coords, cumM, lengthM: cumM.length > 0 ? cumM[cumM.length - 1] : 0 });
    lines.set(trajectory, line);
  }
  return line;
}

const projections = new WeakMap();

/** Where a fix projects on a trajectory's line: `{ alongM, distanceM }`, cached per trajectory and fix. */
function projectionOf(trajectory, fix) {
  let byFix = projections.get(trajectory);
  if (!byFix) {
    byFix = new WeakMap();
    projections.set(trajectory, byFix);
  }
  if (!byFix.has(fix)) {
    const line = lineOf(trajectory);
    const hit = line.coords.length >= 2 ? nearestOnPolyline(line, [fix.lon, fix.lat]) : null;
    byFix.set(fix, hit ? Object.freeze({ alongM: hit.alongM, distanceM: hit.distanceM }) : null);
  }
  return byFix.get(fix);
}

/** The leg of a trajectory at `alongM` metres along its line: the last one that has begun there. */
function legAtAlong(trajectory, alongM) {
  const legs = trajectory.legs;
  if (legs.length === 0) return null;
  let low = 0;
  let high = legs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (legs[middle].alongStartM <= alongM + 1e-6) low = middle;
    else high = middle - 1;
  }
  return legs[low];
}

/**
 * Where the fix projects on the plan's line, when the track is an ELEVANT flight with a plan whose line passes within
 * the snap distance of the fix: `{ trajectory, line, alongM }`; otherwise `null` (the plan cannot guide it).
 */
function planAnchor(track, config) {
  const trajectory = planTrajectory(track);
  const fix = track.lastFix;
  if (track.kind !== 'aviam' || trajectory === null || fix === null) return null;
  const line = lineOf(trajectory);
  if (line.coords.length < 2 || !(line.lengthM > 0)) return null;
  const hit = projectionOf(trajectory, fix);
  if (hit === null || hit.distanceM > snapLimitM(fix.onGround, config)) return null;
  return { trajectory, line, alongM: hit.alongM };
}

/**
 * An ELEVANT flight coasting `ageS` seconds after its fix along its planned path: from where the fix projects on it, at
 * the fix's speed, its heading and phase the plan's there and its height the fix's at its vertical rate; `null` when
 * the plan cannot guide it.
 */
function coastOnPlan(track, ageS, config) {
  const anchor = planAnchor(track, config);
  if (anchor === null) return null;
  const fix = track.lastFix;
  const along = Math.min(anchor.line.lengthM, anchor.alongM + (isMoving(fix) ? fix.gsMs : 0) * ageS);
  const point = pointAlong(anchor.line, along).p;
  const leg = legAtAlong(anchor.trajectory, along);
  const climbs = !fix.onGround && finite(fix.altM) && finite(fix.vrateMs);
  return {
    lon: point[0],
    lat: point[1],
    altM: climbs ? Math.max(0, fix.altM + fix.vrateMs * ageS) : fix.altM,
    gsMs: along >= anchor.line.lengthM ? 0 : fix.gsMs,
    trackDeg: leg === null ? fix.trackDeg : headingAt(leg, along - leg.alongStartM),
    vrateMs: fix.vrateMs,
    onGround: fix.onGround,
    phase: leg?.phase ?? null,
  };
}

/**
 * The time scale of the part of its plan a trajectory sample is in (demoProfile.js: «Demo acelerada ×N»): its leg's
 * `timeScale`, or 1 when the leg has none.
 */
function scaleAt(trajectory, sample) {
  const scale = trajectory?.legs?.[sample?.legIndex]?.timeScale;
  return finite(scale) && scale > 0 ? scale : 1;
}

/** A trajectory sample (estimator.js) as a state. */
function fromSample(sample) {
  return {
    lon: sample.lon,
    lat: sample.lat,
    altM: orNull(sample.altM),
    gsMs: orNull(sample.gsMs),
    trackDeg: orNull(sample.trackDeg),
    vrateMs: orNull(sample.vrateMs),
    onGround: sample.onGround === true,
    phase: sample.phase ?? null,
  };
}

/**
 * The mode of a track at `tMs`, from the age of its last fix: 'live' up to `liveMaxAgeS`, 'coast' up to
 * `coastMaxAgeS` (`groundCoastMaxAgeS` for a fix on the ground), 'estimate' after it and for a track without a fix.
 */
export function trackMode(track, tMs, config = TRACK_CONFIG) {
  const fix = track?.lastFix ?? null;
  if (fix === null) return 'estimate';
  const ageS = Math.max(0, (tMs - fix.positionAt) / 1000);
  if (ageS <= config.liveMaxAgeS) return 'live';
  if (ageS <= coastLimitS(fix, config)) return 'coast';
  return 'estimate';
}

/**
 * The estimate of a track `ageS` seconds after its fix: `{ state, quality, statusKey, opacity, timeScale }`, or `null`
 * (not drawn).
 */
function estimateOf(track, tMs, ageS, config) {
  const fix = track.lastFix;
  if (track.kind === 'aviam') {
    if (planIsCurrent(track)) {
      const trajectory = planTrajectory(track);
      const sample = sampleTrajectory(trajectory, tMs);
      if (sample === null) return null;
      return {
        state: fromSample(sample), quality: 'estimated', statusKey: sample.statusKey ?? 'noSignal', opacity: sample.opacity,
        timeScale: scaleAt(trajectory, sample),
      };
    }
    // A plan that is not the last fix's: the flight keeps coasting along it until the store rebuilds one.
    const coasting = coastOnPlan(track, ageS, config);
    if (coasting !== null) return { state: coasting, quality: 'estimated', statusKey: 'noSignal', opacity: 1, timeScale: 1 };
  }
  // Nothing to estimate from: straight on, fading out from the end of the coast to the drop.
  const start = coastLimitS(fix, config);
  const end = config.dropOtherAfterS;
  if (ageS >= end) return null;
  const opacity = end > start ? clamp01(1 - (ageS - start) / (end - start)) : 0;
  return { state: deadReckon(fix, ageS), quality: 'coasted', statusKey: 'noSignal', opacity, timeScale: 1 };
}

/**
 * What a track draws at `tMs` before any blend of a fix or a plan: `{ state, mode, quality, ageS, statusKey, opacity,
 * timeScale }`.
 */
function baseOf(track, tMs, config) {
  const fix = track.lastFix;
  if (fix === null) {
    if (!planIsCurrent(track)) return null;
    const trajectory = planTrajectory(track);
    const sample = sampleTrajectory(trajectory, tMs);
    if (sample === null) return null;
    return {
      state: fromSample(sample), mode: 'estimate', quality: 'estimated', ageS: null, statusKey: sample.statusKey ?? null,
      opacity: sample.opacity, timeScale: scaleAt(trajectory, sample),
    };
  }
  const ageS = ageOf(track, tMs);
  const mode = trackMode(track, tMs, config);
  const live = () => {
    const state = deadReckon(fix, ageS);
    const anchor = planAnchor(track, config);
    state.phase = anchor === null ? null : (legAtAlong(anchor.trajectory, anchor.alongM)?.phase ?? null);
    return state;
  };
  if (mode === 'live') return { state: live(), mode, quality: 'live', ageS, statusKey: null, opacity: 1, timeScale: 1 };
  // CN-31: a real aircraft last reported on the ground stays where it was reported (carried on a few seconds at most):
  // no taxi route is estimated for it. Other traffic fades out from the end of the coast to its drop, as before; an
  // ELEVANT flight holds until its fix is dropped (the operation's milestones then place it, motionStore.js).
  if (fix.onGround) {
    // A plan rebuilt from this fix (the store keeps only a stopped fix in its stand: parked there, or leaving it at its
    // recorded PUSHBACK) places it: still where it was reported until that milestone, then the estimate.
    if (track.kind === 'aviam' && mode === 'estimate' && planIsCurrent(track)) {
      const estimate = estimateOf(track, tMs, ageS, config);
      if (estimate === null) return null;
      const moving = finite(estimate.state.gsMs) && estimate.state.gsMs > 0;
      return { ...estimate, mode, ageS, quality: moving ? estimate.quality : 'coasted' };
    }
    // A rebuild from this fix that found it gone (an arrival's stand after its PUSHBACK: the departure has the
    // aircraft) places it nowhere; one the store skipped to hold it (`hold`) keeps it where it was reported.
    if (track.kind === 'aviam' && mode === 'estimate' && track.plan?.trajectory === null
      && track.plan.anchorFixAt === fix.positionAt && track.plan.hold !== true) return null;
    const start = coastLimitS(fix, config);
    const end = config.dropOtherAfterS;
    let opacity = 1;
    if (track.kind !== 'aviam') {
      if (ageS >= end) return null;
      opacity = ageS <= start ? 1 : (end > start ? clamp01(1 - (ageS - start) / (end - start)) : 0);
    }
    return { state: live(), mode, quality: 'coasted', ageS, statusKey: 'noSignal', opacity, timeScale: 1 };
  }
  // The coast, eased in from the live dead reckoning over the blend time after the live limit.
  const coasted = () => {
    const along = coastOnPlan(track, ageS, config) ?? deadReckon(fix, ageS);
    const w = ease((ageS - config.liveMaxAgeS) / config.blendS);
    return w >= 1 ? along : mix(live(), along, w);
  };
  if (mode === 'coast') {
    return { state: coasted(), mode, quality: 'coasted', ageS, statusKey: 'noSignal', opacity: 1, timeScale: 1 };
  }
  const estimate = estimateOf(track, tMs, ageS, config);
  if (estimate === null) return null;
  const w = ease((ageS - coastLimitS(fix, config)) / config.blendS);
  return {
    state: w >= 1 ? estimate.state : mix(coasted(), estimate.state, w),
    mode,
    quality: estimate.quality,
    ageS,
    statusKey: estimate.statusKey,
    opacity: estimate.opacity,
    timeScale: estimate.timeScale,
  };
}

/**
 * Where a track's aircraft is drawn at `tMs` (design F4): `{ lon, lat, altM, gsMs, trackDeg, vrateMs, onGround,
 * phase, mode: 'live' | 'coast' | 'estimate', quality: 'live' | 'coasted' | 'estimated', ageS, statusKey, opacity,
 * timeScale, trailEpoch }`, frozen, or `null` when it is not drawn (nothing known, dropped, faded out, or its plan has
 * not begun or is over). The first eight keys are a trajectory sample's (estimator.js) and what
 * traffic/situationModel.js takes as an estimate.
 * - `mode` comes from the age of the last fix (trackMode). `quality` says where the position comes from: the fix
 *   ('live'), the fix carried on without a signal ('coasted': coasting, and other traffic fading out) or a plan
 *   ('estimated'). `ageS` is the age of the fix (`null` without one). `statusKey` is the plan's own status when the
 *   plan places the aircraft and has one (awaiting a stand, cancelled), else 'noSignal' from the coast on
 *   (kinematicsMessages.js: «Sin señal desde hace N s»), else `null`.
 * - `timeScale` is the time scale of the part of its plan the aircraft is in while the plan places it (demoProfile.js:
 *   a demo part that had to be compressed, «Demo acelerada ×N»), and 1 otherwise (a fix, live or carried on, runs in
 *   real time). A blend takes the scale of where it goes.
 * - `phase` is the plan's where the aircraft is, `null` for traffic no plan guides.
 * - A blend of a fix or a plan mixes, over its 6 s, the drawn state it started from (carried straight on) with the new
 *   one: the position in the east-north plane, the heading the short way, and the opacity. After a snap the opacity
 *   rises from 0 to 1 over `snapFadeS`. `trailEpoch` changes at every snap: a trail never joins across it.
 */
export function renderTrack(track, tMs, config = TRACK_CONFIG) {
  const drawn = drawnOf(track, tMs, config);
  if (drawn === null) return null;
  const { state, base } = drawn;
  return Object.freeze({
    lon: state.lon,
    lat: state.lat,
    altM: state.altM,
    gsMs: state.gsMs,
    trackDeg: state.trackDeg,
    vrateMs: state.vrateMs,
    onGround: state.onGround,
    phase: state.phase,
    mode: base.mode,
    quality: base.quality,
    ageS: base.ageS,
    statusKey: base.statusKey,
    opacity: clamp01(drawn.opacity * snapFade(track, tMs, config)),
    timeScale: base.timeScale,
    trailEpoch: track.trailEpoch,
  });
}

/** The state a track draws at `tMs` with its blend, and its opacity before the fade after a snap; `null` when none. */
function drawnOf(track, tMs, config) {
  if (!track || track.dropped === true || !finite(tMs)) return null;
  const base = baseOf(track, tMs, config);
  if (base === null) return null;
  let { state, opacity } = base;
  const blend = track.blend;
  // Before its start (a frame still catching up with the render clock) a blend holds where it starts from.
  if (blend !== null && tMs < blend.startMs + blend.durationMs) {
    const w = ease((tMs - blend.startMs) / blend.durationMs);
    if (blend.opacityOnly !== true) state = mix(deadReckon(blend.from, (tMs - blend.startMs) / 1000), state, w);
    opacity = lerp(blend.from.opacity, opacity, w);
  }
  return { state, base, opacity };
}

/** The opacity factor of the fade-in after a snap: 0 at the snap, 1 once `snapFadeS` has passed. */
function snapFade(track, tMs, config) {
  if (!finite(track.snapAtMs)) return 1;
  const fadeMs = config.snapFadeS * 1000;
  if (!(fadeMs > 0) || tMs >= track.snapAtMs + fadeMs) return 1;
  return clamp01((tMs - track.snapAtMs) / fadeMs);
}

/** The drawn state a blend starts from, frozen: it is carried straight on while the blend lasts. */
function snapshotOf({ state, opacity }) {
  return Object.freeze({
    lon: state.lon,
    lat: state.lat,
    altM: state.altM,
    gsMs: state.gsMs,
    trackDeg: state.trackDeg,
    vrateMs: state.vrateMs,
    onGround: state.onGround,
    phase: state.phase,
    turnDegS: finite(state.turnDegS) ? state.turnDegS : 0,
    opacity,
  });
}

// A new state this close to the drawn one, the same way, needs no blend of its position: it is where it is drawn.
const SAME_M = 0.5;
const SAME_DEG = 1;
const SAME_OPACITY = 0.01;

/** Whether two states are where the eye sees one: within SAME_M, headings within SAME_DEG (or either unknown). */
function samePlace(a, b) {
  if (haversineM([a.lon, a.lat], [b.lon, b.lat]) > SAME_M) return false;
  return !(finite(a.trackDeg) && finite(b.trackDeg)) || Math.abs(angleDiff(a.trackDeg, b.trackDeg)) <= SAME_DEG;
}

/**
 * The track `next` (a draft of `prev` with its new fix or plan) after the hand-off at `atMs`, from `drawn` (what
 * `prev` drew then, drawnOf) to `target` (where `next` puts the aircraft, judged against `limitM`, with
 * `targetOpacity`): nothing drawn before → no blend (a fade-in when the aircraft comes back); a gap above `limitM` → a
 * snap (a new trail part and a fade-in); where it is drawn already (a plan continued from the one drawn) → no blend of
 * the position, and of its opacity only when that changes (a cancelled demo read late fades in from where it was
 * drawn); otherwise a blend from the drawn state. A fade-in under way goes on.
 */
function handOver(prev, next, { drawn, target, targetOpacity = 1, atMs, limitM, config, planOnly = false, blendS = null }) {
  if (drawn === null) {
    const comesBack = prev.lastFix !== null || planTrajectory(prev) !== null;
    return Object.freeze({
      ...next, blend: null, trailEpoch: prev.lastFix !== null ? prev.trailEpoch + 1 : prev.trailEpoch,
      snapAtMs: comesBack ? atMs : prev.snapAtMs,
    });
  }
  if (target === null) return Object.freeze({ ...next, blend: null });
  const gapM = haversineM([drawn.state.lon, drawn.state.lat], [target.lon, target.lat]);
  if (gapM > limitM) {
    // A flight drawn from its plan alone whose plan changed (a new estimate, a new stand) slides over to the new one.
    if (planOnly && gapM <= limitM * PLAN_BLEND.maxFactor) {
      const seconds = Math.min(PLAN_BLEND.maxS, Math.max(PLAN_BLEND.minS, (PLAN_BLEND.minS * gapM) / limitM));
      return Object.freeze({
        ...next,
        blend: Object.freeze({ from: snapshotOf(drawn), startMs: atMs, durationMs: seconds * 1000, opacityOnly: false }),
      });
    }
    return Object.freeze({ ...next, blend: null, trailEpoch: prev.trailEpoch + 1, snapAtMs: atMs });
  }
  const durationMs = (finite(blendS) ? blendS : config.blendS) * 1000;
  if (samePlace(drawn.state, target)) {
    if (Math.abs(drawn.opacity - targetOpacity) <= SAME_OPACITY) return Object.freeze({ ...next, blend: null });
    return Object.freeze({
      ...next, blend: Object.freeze({ from: snapshotOf(drawn), startMs: atMs, durationMs, opacityOnly: true }),
    });
  }
  return Object.freeze({
    ...next, blend: Object.freeze({ from: snapshotOf(drawn), startMs: atMs, durationMs, opacityOnly: false }),
  });
}

function onFix(prev, event, config) {
  const plain = toFix(event.fix);
  if (plain === null) return prev;
  // An older fix, or the same one again, never moves the track back.
  if (prev.lastFix !== null && plain.positionAt <= prev.lastFix.positionAt) return prev;
  const fix = toFix(event.fix, turnRateOf(prev.lastFix, plain));
  const atMs = finite(event.atMs) ? event.atMs : fix.positionAt;
  const drawn = drawnOf(prev, atMs, config);
  const next = { ...prev, lastFix: fix, dropped: false };
  // Where the new fix puts the aircraft now: the fix carried straight on to `atMs`.
  const target = deadReckon(fix, (atMs - fix.positionAt) / 1000);
  return handOver(prev, next, {
    drawn, target, atMs, limitM: snapLimitM(fix.onGround, config), config, blendS: config.fixBlendS ?? config.blendS,
  });
}

function onPlan(prev, event, config) {
  if (!finite(event.atMs)) return prev;
  const trajectory = event.trajectory ?? null;
  const anchorFixAt = finite(event.anchorFixAt) ? event.anchorFixAt : anchorFixAtOf(trajectory);
  if (prev.plan === null ? trajectory === null && anchorFixAt === null
    : event.atMs < prev.plan.atMs || (trajectory !== null && trajectory === prev.plan.trajectory)) {
    return prev;
  }
  // A plan without a trajectory but with its fix records a rebuild that found no route, so it is not asked again.
  const plan = trajectory !== null || anchorFixAt !== null
    ? Object.freeze({ trajectory, atMs: event.atMs, anchorFixAt, ...(event.hold === true ? { hold: true } : {}) }) : null;
  const drawn = drawnOf(prev, event.atMs, config);
  const next = { ...prev, plan, dropped: false };
  const goal = drawnOf(Object.freeze({ ...next, blend: null }), event.atMs, config);
  const target = goal?.state ?? null;
  return handOver(prev, next, {
    drawn, target, targetOpacity: goal?.opacity ?? 1, atMs: event.atMs,
    limitM: snapLimitM(target?.onGround === true, config), config, planOnly: prev.lastFix === null,
  });
}

function shouldDrop(track, tMs, config) {
  const ageS = ageOf(track, tMs);
  if (track.kind !== 'aviam') return ageS === null || ageS >= config.dropOtherAfterS;
  // CN-31: an ELEVANT flight last reported on the ground (parked, on blocks with its transponder off) stays there while
  // the picture keeps its fix.
  if (track.lastFix?.onGround === true) return false;
  const trajectory = planTrajectory(track);
  const planned = trajectory !== null && !(tMs > trajectory.endMs);
  return !planned && (ageS === null || ageS >= config.dropAviamAfterS);
}

function onTick(prev, event, config) {
  const tMs = event.tMs;
  if (!finite(tMs)) return prev;
  const blendOver = prev.blend !== null && tMs >= prev.blend.startMs + prev.blend.durationMs;
  const fadeOver = finite(prev.snapAtMs) && tMs >= prev.snapAtMs + config.snapFadeS * 1000;
  const drop = !prev.dropped && shouldDrop(prev, tMs, config);
  if (!blendOver && !fadeOver && !drop) return prev;
  return Object.freeze({
    ...prev,
    blend: blendOver ? null : prev.blend,
    snapAtMs: fadeOver ? null : prev.snapAtMs,
    dropped: prev.dropped || drop,
  });
}

/**
 * The next state of a track (design F4), frozen; `prev` itself when the event changes nothing:
 * - `{ type: 'fix', fix, atMs }`: a fix in the map's units (`{ lon, lat, altM, gsMs, trackDeg, vrateMs, onGround,
 *   positionAt }`) received at `atMs`. One not newer than the last fix is ignored. Otherwise the state drawn at `atMs`
 *   is compared with the fix carried on to `atMs`: more than 2 NM apart in the air or 150 m on the ground (where the
 *   fix is) snaps, with a fade-in and a new trail part; closer, it blends from the drawn state over 6 s.
 * - `{ type: 'plan', trajectory, atMs, anchorFixAt? }`: the trajectory planned for the flight from `atMs` (a stand or
 *   a runway changed, or one rebuilt from the last fix; `meta.anchor` says which). It blends from the drawn state to
 *   where the new plan puts the aircraft, and snaps like a fix beyond the snap distance; a plan that puts it where it
 *   is drawn (half a metre, a degree: one continued from the plan drawn) takes over without moving it, and blends only
 *   its opacity when that changes. An older plan, or the same one, is ignored; `trajectory: null` drops the plan, and
 *   with `anchorFixAt` records that no route was found from that fix (needsReplan stops asking).
 * - `{ type: 'tick', tMs }`: clears a finished blend and a finished fade, and drops other traffic 120 s after its fix
 *   and an ELEVANT flight 600 s after it when no plan can place it (none, or one that is over).
 * The mode is never stored: renderTrack derives it from the time.
 */
export function reduceTrack(prev, event, config = TRACK_CONFIG) {
  const track = prev ?? createTrack();
  switch (event?.type) {
    case 'fix': return onFix(track, event, config);
    case 'plan': return onPlan(track, event, config);
    case 'tick': return onTick(track, event, config);
    default: return track;
  }
}

/**
 * Whether an ELEVANT flight needs its trajectory rebuilt from its last fix at `tMs`: it is estimated (older than the
 * coast) and its plan was not built from that fix. The track store then calls buildArrivalTrajectory (or
 * buildDepartureTrajectory) with `anchor: { kind: 'fix', fix }` and dispatches the result as a 'plan', so this
 * reducer never needs the airport layout.
 */
export function needsReplan(track, tMs, config = TRACK_CONFIG) {
  if (!track || track.dropped === true || track.kind !== 'aviam' || track.lastFix === null || !finite(tMs)) return false;
  if (trackMode(track, tMs, config) !== 'estimate') return false;
  return track.plan === null || track.plan.anchorFixAt !== track.lastFix.positionAt;
}
