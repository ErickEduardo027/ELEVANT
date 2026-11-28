import { measurePolyline, pointAlong, pointInPolygon } from '../airport/geo.js';
import { fitLegs, headingAt, legDurationS, legStateAt, waitLeg } from './legs.js';
import { arrivalAirLegs, climbLegs, climbLegsFrom, departureGroundLegs, fitGround, groundLegs } from './legPlans.js';
import { defaultLandingExit } from './pathBuilder.js';
import { HEADING_RATES } from './smoothing.js';
import { routeFromPoint, routeLandingTaxi } from './taxiRoute.js';
import { ftToM } from './units.js';

// Estimated trajectories of the OCC map (PR M6, design F2 with Decision F-1, contracts 1.3 and 2.3). A trajectory is a
// list of legs placed on the clock; where the aircraft is, how high and how fast is a pure function of the
// trajectory and an explicit time `tMs`, so every screen that builds the same trajectory draws the aircraft in the same
// place. This module places the legs of legPlans.js on the clock for real ELEVANT flights (from the schedule, from a
// runway time or from a live fix), samples any trajectory (demo flights come from demoProfile.js) and decides when an
// estimate may be drawn at all. The instants of a map flight are read through an injected `parseInstant`, never a
// clock. SI units inside (m, m/s, ms, degrees true), heights above sea level; `[lng, lat]`. Pure: explicit '.js'
// imports, no clock, no randomness, no JSON. Every result is frozen.

/** The phases a trajectory's legs carry, in flight order. */
export const TRAJECTORY_PHASES = Object.freeze([
  'enroute', 'descent', 'approach', 'final', 'landing', 'taxiIn', 'holding', 'parked', 'pushback', 'taxiOut',
  'takeoff', 'climb',
]);

const SCHEDULE = Object.freeze({ kind: 'schedule' });
const EMPTY = Object.freeze([]);
const DRIFT_MS = 1;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Places parts of legs on the clock: `{ kind, legs, startMs, endMs, timeScale, scaledParts, meta }`, frozen in depth,
 * or `null` without legs. Each part `{ startMs, legs }` starts at its own instant, or where the part before ends when
 * that is later (or its instant is unknown); each leg gets `durationMs`, `t0Ms`, `t1Ms` and `alongStartM` (where it
 * begins along trajectoryLine). With `meta.fade` the trajectory ends when the fade does and the legs that would start
 * later are dropped; otherwise it ends with its last leg (Infinity for a wait without end).
 */
export function assembleTrajectory({ kind, parts, meta = {}, timeScale = 1, scaledParts = EMPTY }) {
  const legs = [];
  let cursor = null;
  let along = 0;
  for (const part of parts) {
    if (!part || !Array.isArray(part.legs) || part.legs.length === 0) continue;
    let t = Number.isFinite(part.startMs) ? part.startMs : cursor;
    // A part starts at its own instant unless the one before runs later; rounding drift under a millisecond does not.
    if (cursor !== null && (t === null || t < cursor - DRIFT_MS)) t = cursor;
    if (t === null) continue;
    for (const leg of part.legs) {
      const durationMs = Number.isFinite(leg.durationMs) || leg.durationMs === Infinity
        ? leg.durationMs : legDurationS(leg) * 1000;
      legs.push({ ...leg, durationMs, t0Ms: t, t1Ms: t + durationMs, alongStartM: along });
      along += leg.lengthM;
      t += durationMs;
    }
    cursor = t;
  }
  const fade = meta.fade ?? null;
  const kept = fade ? legs.filter(leg => leg.t0Ms < fade.endMs) : legs;
  if (kept.length === 0) return null;
  return deepFreeze({
    kind,
    legs: kept,
    startMs: kept[0].t0Ms,
    endMs: fade ? fade.endMs : kept[kept.length - 1].t1Ms,
    timeScale,
    scaledParts: [...scaledParts],
    meta: {
      runwayIdent: null,
      departureRunwayIdent: null,
      exitNodeId: null,
      standCode: null,
      apronHoldId: null,
      statusKey: null,
      originPath: EMPTY,
      destination: null,
      fade: null,
      anchor: SCHEDULE,
      parts: {},
      ...meta,
    },
  });
}

/** The index of the last leg that has started at `tMs` (-1 before the first). */
function legIndexAt(legs, tMs) {
  if (legs.length === 0 || tMs < legs[0].t0Ms) return -1;
  let low = 0;
  let high = legs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (legs[middle].t0Ms <= tMs) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Where a trajectory's aircraft is at `tMs`: `{ lon, lat, altM, gsMs, trackDeg, vrateMs, onGround, phase, opacity,
 * statusKey, legIndex }`, frozen, or `null` before it starts, after it ends and once its fade is over (the keys of
 * traffic/situationModel.js's estimates, which add the flight's key). `gsMs` is the speed on the map, a fit's time
 * scale included; `trackDeg` the nose's heading (the path's tangent, its opposite in a pushback, or a wait's own);
 * `opacity` falls from 1 to 0 over the fade, and from the fade's start `statusKey` is the trajectory's own (a
 * cancelled demo flight's); otherwise it is the leg's (awaiting a stand) or `null`.
 */
export function sampleTrajectory(trajectory, tMs) {
  if (!trajectory || !Number.isFinite(tMs) || tMs < trajectory.startMs || tMs > trajectory.endMs) return null;
  const fade = trajectory.meta.fade;
  if (fade && tMs >= fade.endMs) return null;
  const legIndex = legIndexAt(trajectory.legs, tMs);
  if (legIndex < 0) return null;
  const leg = trajectory.legs[legIndex];
  const state = legStateAt(leg, (Math.min(tMs, leg.t1Ms) - leg.t0Ms) / 1000);
  const at = pointAlong(leg.path, state.s);
  const fading = fade !== null && tMs >= fade.startMs;
  const span = fading ? fade.endMs - fade.startMs : 0;
  return Object.freeze({
    lon: at.p[0],
    lat: at.p[1],
    altM: state.alt,
    gsMs: state.v,
    trackDeg: headingAt(leg, state.s),
    vrateMs: state.vrate,
    onGround: leg.onGround === true,
    phase: leg.phase,
    opacity: fading ? Math.max(0, Math.min(1, span > 0 ? 1 - (tMs - fade.startMs) / span : 0)) : 1,
    statusKey: fading && trajectory.meta.statusKey !== null ? trajectory.meta.statusKey : (leg.statusKey ?? null),
    legIndex,
  });
}

const lines = new WeakMap();

/**
 * The whole line a trajectory follows, its moving legs joined in order: `{ coords, cumM }`, frozen (cached per
 * trajectory). A trajectory that never moves gives its one point.
 */
export function trajectoryLine(trajectory) {
  if (!trajectory) return Object.freeze({ coords: EMPTY, cumM: EMPTY });
  const cached = lines.get(trajectory);
  if (cached) return cached;
  const coords = [];
  for (const leg of trajectory.legs) {
    if (leg.kind !== 'move') continue;
    for (const point of leg.path.coords) {
      const last = coords[coords.length - 1];
      if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue;
      coords.push(point);
    }
  }
  if (coords.length === 0 && trajectory.legs.length > 0) coords.push(trajectory.legs[0].path.coords[0]);
  const measured = measurePolyline(coords);
  const result = Object.freeze({ coords: measured.coords, cumM: measured.cumM });
  lines.set(trajectory, result);
  return result;
}

/** The metres along trajectoryLine the aircraft has covered at `tMs`: 0 before it starts, all of it after it ends. */
export function alongAt(trajectory, tMs) {
  if (!trajectory || !Number.isFinite(tMs)) return 0;
  const index = legIndexAt(trajectory.legs, tMs);
  if (index < 0) return 0;
  const leg = trajectory.legs[index];
  if (leg.kind !== 'move') return leg.alongStartM;
  return leg.alongStartM + legStateAt(leg, (Math.min(tMs, leg.t1Ms) - leg.t0Ms) / 1000).s;
}

/**
 * The positions of a trajectory every `stepS` seconds from `fromMs` to `toMs` (its start and its end by default; a
 * trajectory that ends with a wait without end stops where the wait begins), as `[[lng, lat], …]`, frozen; at most
 * 20 000 points.
 */
export function trajectoryPath(trajectory, { fromMs = null, toMs = null, stepS = 1 } = {}) {
  if (!trajectory) return EMPTY;
  const lastFinite = [...trajectory.legs].reverse().find(leg => Number.isFinite(leg.t1Ms));
  const end = Number.isFinite(toMs) ? toMs
    : (Number.isFinite(trajectory.endMs) ? trajectory.endMs : (lastFinite?.t1Ms ?? trajectory.startMs));
  const start = Number.isFinite(fromMs) ? fromMs : trajectory.startMs;
  const step = Math.max(1, (stepS > 0 ? stepS : 1) * 1000, (end - start) / 20_000);
  const points = [];
  for (let t = start; t < end; t += step) {
    const state = sampleTrajectory(trajectory, t);
    if (state) points.push(Object.freeze([state.lon, state.lat]));
  }
  const last = sampleTrajectory(trajectory, end);
  if (last) points.push(Object.freeze([last.lon, last.lat]));
  return Object.freeze(points);
}

/**
 * The instants of a map flight row (contracts 1.3) as epoch milliseconds through `parseInstant` (the map's own
 * parser, never a clock): `{ scheduledAtMs, estimatedAtMs, actualAtMs, actualKind, blockOnAtMs, pushbackAtMs }`,
 * frozen; `null` for each one missing or unreadable. `actualKind` is 'Runway' or 'OnBlock' only with an actual time;
 * the milestone times come from `milestones[]` BLOCK_ON and PUSHBACK.
 */
export function flightTimesFromRow(row, parseInstant) {
  const read = value => {
    if (value === null || value === undefined) return null;
    const ms = parseInstant(value);
    return Number.isFinite(ms) ? ms : null;
  };
  const milestone = code => {
    const found = (Array.isArray(row?.milestones) ? row.milestones : []).find(item => item?.code === code);
    return found ? read(found.actualAt) : null;
  };
  const actualAtMs = read(row?.actualAt);
  const kind = row?.actualKind === 'Runway' || row?.actualKind === 'OnBlock' ? row.actualKind : null;
  return Object.freeze({
    scheduledAtMs: read(row?.scheduledAt),
    estimatedAtMs: read(row?.estimatedAt),
    actualAtMs,
    actualKind: actualAtMs === null ? null : kind,
    blockOnAtMs: milestone('BLOCK_ON'),
    pushbackAtMs: milestone('PUSHBACK'),
  });
}

const AIRBORNE = new Set(['departed', 'enroute', 'approaching']);
const hasMilestone = (row, code) => (Array.isArray(row?.milestones) ? row.milestones : [])
  .some(item => item?.code === code && item?.actualAt !== null && item?.actualAt !== undefined);
const decision = (draw, reason) => Object.freeze({ draw, reason });

/**
 * Decision F-1, whether a map flight row may be drawn as an estimated aircraft without live data: `{ draw, reason }`.
 * - A demo flight always is ('demo').
 * - An arrival is when the provider says it is airborne ('airborne': departed, en route or approaching), has landed
 *   ('landed', on the ground) or has arrived and has a stand ('parked'); merely scheduled, unknown, cancelled or
 *   diverted it is not (only its route, when selected).
 * - An imported departure never leaves its stand by estimate: it is drawn leaving only once PUSHBACK is recorded
 *   ('pushback') or a live fix shows it ('liveFix'); until then it waits at its stand ('awaitingPushback', not
 *   drawn: the arrival's trajectory keeps it parked). A departure nobody imported is drawn once the provider says it
 *   took off ('airborne').
 */
export function shouldEstimate(row, { hasLiveFix = false } = {}) {
  if (!row || typeof row !== 'object') return decision(false, 'noFlight');
  if (row.isDemo === true) return decision(true, 'demo');
  const phase = typeof row.phase === 'string' ? row.phase : 'unknown';
  if (phase === 'cancelled' || phase === 'diverted') return decision(false, phase);
  if (row.direction !== 'Departure') {
    if (AIRBORNE.has(phase)) return decision(true, 'airborne');
    if (phase === 'landed') return decision(true, 'landed');
    if (phase === 'arrived') return row.stand ? decision(true, 'parked') : decision(false, 'arrivedWithoutStand');
    return decision(false, phase);
  }
  if (row.imported === true) {
    if (hasMilestone(row, 'PUSHBACK')) return decision(true, 'pushback');
    if (hasLiveFix) return decision(true, 'liveFix');
    return decision(false, 'awaitingPushback');
  }
  if (phase === 'departed' || phase === 'enroute') return decision(true, 'airborne');
  return decision(false, phase);
}

/**
 * The two instants an arrival's ground part is placed between (design F2): `{ touchdownMs, onBlockMs,
 * touchdownSource, onBlockSource }`, frozen.
 * - On-block: BLOCK_ON, else the actual time when it is the on-block ('OnBlock'), else the estimate, else the
 *   schedule ('blockOn', 'onBlock', 'estimated', 'scheduled'; `null` with none).
 * - Touchdown: the actual time when it is the runway's ('runway'), else the on-block less `nominalGroundMs`
 *   ('derived').
 */
export function arrivalAnchors(times, { nominalGroundMs = 0 } = {}) {
  const t = times ?? {};
  const candidates = [
    ['blockOn', t.blockOnAtMs],
    ['onBlock', t.actualKind === 'OnBlock' ? t.actualAtMs : null],
    ['estimated', t.estimatedAtMs],
    ['scheduled', t.scheduledAtMs],
  ];
  const [onBlockSource, onBlockMs] = candidates.find(([, value]) => Number.isFinite(value)) ?? [null, null];
  const runway = t.actualKind === 'Runway' && Number.isFinite(t.actualAtMs) ? t.actualAtMs : null;
  let touchdownMs = runway;
  if (touchdownMs === null && onBlockMs !== null) touchdownMs = onBlockMs - Math.max(0, nominalGroundMs);
  return Object.freeze({
    touchdownMs,
    onBlockMs,
    touchdownSource: runway !== null ? 'runway' : (touchdownMs === null ? null : 'derived'),
    onBlockSource,
  });
}

/**
 * When a departure leaves and takes off (Decision F-1): `{ offBlockMs, takeoffMs }`, frozen. Take-off: the runway
 * time when the provider has it. An imported departure leaves at PUSHBACK, else at a live fix that shows it moving
 * (`liveFixAtMs`), else not at all (`null`: it waits at its stand). One nobody imported leaves `nominalTaxiOutMs`
 * before its take-off, and only once that is known.
 */
export function departureAnchors(times, { imported = false, liveFixAtMs = null, nominalTaxiOutMs = 0 } = {}) {
  const t = times ?? {};
  const takeoffMs = t.actualKind === 'Runway' && Number.isFinite(t.actualAtMs) ? t.actualAtMs : null;
  let offBlockMs = null;
  if (imported) offBlockMs = Number.isFinite(t.pushbackAtMs) ? t.pushbackAtMs : (Number.isFinite(liveFixAtMs) ? liveFixAtMs : null);
  else if (takeoffMs !== null) offBlockMs = takeoffMs - Math.max(0, nominalTaxiOutMs);
  return Object.freeze({ offBlockMs, takeoffMs });
}

const statusFor = (toStand, imported) => {
  if (toStand) return null;
  return imported ? 'awaitingStand' : 'awaitingStandNotImported';
};

/**
 * How long a real arrival without a stand the map knows waits at the apron hold before it is no longer drawn. Past it
 * the aircraft has had time to reach a stand nobody can place (Decision F-1: an arrival on its stand without one is not
 * drawn), so it is not left on the hold: every landed flight without a stand there would pile up on that one point.
 */
export const AWAITING_STAND_MAX_MS = 10 * 60_000;

/**
 * The wait that ends an arrival: parked at the stand on its heading, without end, or holding at the apron hold for
 * AWAITING_STAND_MAX_MS at most.
 */
function endWait({ stand, path, legs, statusKey, groundAltM }) {
  if (stand) {
    return waitLeg({
      phase: 'parked', point: stand.center, nominalS: Infinity, heading: stand.headingTrue, alt: groundAltM, part: 'parked',
    });
  }
  const last = legs[legs.length - 1];
  const heading = last?.kind === 'wait' ? last.heading : (last?.tangentsDeg?.[last.tangentsDeg.length - 1] ?? 0);
  return waitLeg({
    phase: 'holding', point: path.coords[path.coords.length - 1], nominalS: AWAITING_STAND_MAX_MS / 1000, heading,
    alt: groundAltM, part: 'parked', statusKey,
  });
}

const totalMs = legs => legs.reduce((sum, leg) => sum + legDurationS(leg), 0) * 1000;

/**
 * Whether a live fix has its aircraft stopped on the ground: under 2 kt (the speed below which an ADS-B track is
 * noise, smoothing.js), or with no speed at all. Such a fix starts nothing by estimate (Decision F-1: only a recorded
 * off-block or a fix that shows it moving does).
 */
export function isStoppedOnGround(fix) {
  return fix.onGround === true && !(Number.isFinite(fix.gsMs) && fix.gsMs >= HEADING_RATES.holdBelowMs);
}

/** Whether `point` (`[lng, lat]`) lies inside the box of the layout's stand `stand`. */
export function isInStand(stand, point) {
  return Array.isArray(stand?.polygon) && stand.polygon.length >= 4 && pointInPolygon(point, stand.polygon);
}

/**
 * A flight a stopped fix holds where it is (isStoppedOnGround), from the fix's instant and without end: exactly where
 * the fix has it, on the fix's track (north without one, as the map draws a fix without one), so the hand-off moves
 * nothing when the fix ages and nothing when the next one comes. Phase 'parked' inside its stand, else 'holding'.
 */
function stoppedAt({ kind, fix, inStand, groundAltM, meta }) {
  const wait = waitLeg({
    phase: inStand ? 'parked' : 'holding', point: [fix.lon, fix.lat], nominalS: Infinity,
    heading: Number.isFinite(fix.trackDeg) ? fix.trackDeg : 0, alt: groundAltM, part: 'parked',
  });
  return assembleTrajectory({ kind, parts: [{ startMs: fix.positionAt, legs: [wait] }], meta });
}

/** The node an aircraft on the ground taxis to: its stand's, or the apron hold named, or the one the shortest taxi reaches. */
function groundTarget(layout, { point, headingDeg, stand, apronHold }) {
  if (stand) return routeFromPoint(layout, { point, headingDeg, toNodeId: stand.node });
  const holds = apronHold ? [apronHold] : (layout?.apronHolds ?? []);
  let best = null;
  for (const hold of holds) {
    const path = routeFromPoint(layout, { point, headingDeg, toNodeId: hold.node });
    if (path && (best === null || path.lengthM < best.lengthM - 1e-9)) best = path;
  }
  return best;
}

/**
 * An arrival's trajectory, or `null` without the instants, the layout or a route (design F2; the caller has already
 * asked shouldEstimate). `runwayEnd` comes from airport/runwayInUse.js; `stand` is the layout's stand (or `null`: the
 * aircraft taxis to `apronHold`, else to the one the cheapest taxi reaches, and holds there awaiting a stand).
 * - `anchor: { kind: 'schedule' }`: the air legs are placed back from the touchdown at their own speeds, from
 *   `origin` (`[lng, lat]`, or 40 NM out without one); the aircraft leaves the runway by its default exit. With a
 *   runway time and an on-block after it the taxi is fitted between them (5 to 25 kt, the time over spent before the
 *   lead-in); otherwise it runs at its nominal speeds. A real flight is never sped up beyond 25 kt.
 * - `anchor: { kind: 'fix', fix }` (a live fix: `{ lon, lat, altM, gsMs, trackDeg, onGround, positionAt }`): from the
 *   fix's position, height and speed at `fix.positionAt`, forward at nominal speeds. A fix stopped on the ground (under
 *   2 kt) inside the stand's box has it parked there, where the fix is, until the PUSHBACK of `times` (Decision F-1: a
 *   fix that does not show it moving starts nothing; after the PUSHBACK the aircraft has left and the arrival places
 *   it nowhere: `null`); stopped anywhere else it taxis on to its stand or apron hold.
 * Either way it ends parked at the stand, without end, or holding at the apron hold for AWAITING_STAND_MAX_MS, after
 * which it is not drawn. `meta.anchor` says which.
 */
export function buildArrivalTrajectory({
  times, origin = null, layout, runwayEnd, stand = null, apronHold = null, perf, anchor = SCHEDULE, imported = true,
  activeRunwayIds = null,
}) {
  if (!layout || !runwayEnd || !perf) return null;
  const active = activeRunwayIds ?? [runwayEnd.runwayId];
  const toStand = stand !== null && stand !== undefined;
  const statusKey = statusFor(toStand, imported);
  const groundAltM = ftToM(runwayEnd.elevationFt);
  const options = { perf, toStand, standHeadingDeg: toStand ? stand.headingTrue : null, statusKey, groundAltM };
  const meta = {
    runwayIdent: runwayEnd.ident, standCode: toStand ? stand.code : null, statusKey, anchor,
  };

  if (anchor?.kind === 'fix') {
    const fix = anchor.fix;
    if (!fix || !Number.isFinite(fix.lon) || !Number.isFinite(fix.lat) || !Number.isFinite(fix.positionAt)) return null;
    const point = [fix.lon, fix.lat];
    if (fix.onGround === true) {
      if (toStand && isStoppedOnGround(fix) && isInStand(stand, point)) {
        // Once its PUSHBACK is recorded the aircraft has left, and an arrival's fix cannot say where to: nothing.
        if (Number.isFinite(times?.pushbackAtMs)) return null;
        return stoppedAt({ kind: 'arrival', fix, inStand: true, groundAltM, meta: { ...meta, apronHoldId: null } });
      }
      const path = groundTarget(layout, { point, headingDeg: fix.trackDeg ?? null, stand: toStand ? stand : null, apronHold });
      const ground = path && groundLegs(path, {
        ...options, landing: false, startSpeed: Math.min(fix.gsMs ?? 0, perf.taxi.maxMs), startHeadingDeg: fix.trackDeg ?? null,
      });
      if (!ground) return null;
      return assembleTrajectory({
        kind: 'arrival',
        parts: [{ startMs: fix.positionAt, legs: [...ground.legs, endWait({ stand: toStand ? stand : null, path, legs: ground.legs, statusKey, groundAltM })] }],
        meta: { ...meta, apronHoldId: null },
      });
    }
    const air = arrivalAirLegs({ origin: point, runwayEnd, perf, start: { altM: fix.altM, speedMs: fix.gsMs } });
    const exit = defaultLandingExit(layout, runwayEnd);
    const path = exit && routeLandingTaxi(layout, {
      runwayEnd, fromAlongM: perf.landing.touchdownAlongM, exitNodeId: exit.nodeId, stand, apronHold, activeRunwayIds: active,
    });
    const ground = path && groundLegs(path, options);
    if (!ground) return null;
    return assembleTrajectory({
      kind: 'arrival',
      parts: [{ startMs: fix.positionAt, legs: [...air.legs, ...ground.legs, endWait({ stand, path, legs: ground.legs, statusKey, groundAltM })] }],
      meta: { ...meta, exitNodeId: exit.nodeId, apronHoldId: path.apronHold?.id ?? null },
    });
  }

  const exit = defaultLandingExit(layout, runwayEnd);
  if (!exit) return null;
  const path = routeLandingTaxi(layout, {
    runwayEnd, fromAlongM: perf.landing.touchdownAlongM, exitNodeId: exit.nodeId, stand, apronHold, activeRunwayIds: active,
  });
  const nominal = path && groundLegs(path, options);
  if (!nominal) return null;
  const anchors = arrivalAnchors(times, { nominalGroundMs: totalMs(nominal.legs) });
  if (anchors.touchdownMs === null) return null;
  let ground = nominal.legs;
  if (anchors.touchdownSource === 'runway' && anchors.onBlockMs !== null && anchors.onBlockMs > anchors.touchdownMs) {
    const fit = fitGround(path, anchors.onBlockMs - anchors.touchdownMs, { ...options, compress: false });
    if (fit) ground = fit.legs;
  }
  const air = arrivalAirLegs({ origin, runwayEnd, perf });
  return assembleTrajectory({
    kind: 'arrival',
    parts: [
      { startMs: anchors.touchdownMs - totalMs(air.legs), legs: air.legs },
      { startMs: anchors.touchdownMs, legs: [...ground, endWait({ stand, path, legs: ground, statusKey, groundAltM })] },
    ],
    meta: { ...meta, exitNodeId: exit.nodeId, apronHoldId: path.apronHold?.id ?? null, anchors },
  });
}

/**
 * A departure's trajectory, or `null` without an off-block (departureAnchors: an imported flight has none before
 * PUSHBACK or a live fix), a layout or a route. From the stand (pushback, engine start) or from `apronHold`, the taxi
 * to `runwayEnd`'s holding point, the hold, the line-up, the take-off roll and the climb towards `destination`
 * (`[lng, lat]` or `null`): M3, on along the great circle at the cruise and down near the destination (legPlans.js:
 * climbLegs), so a far departure never vanishes 250 NM out; without a destination 250 NM at most. With a known take-off after the off-block the ground part is fitted
 * between them, never sped up beyond 25 kt (when it cannot make it the climb starts late); otherwise nominal speeds.
 * `anchor: { kind: 'fix', fix }`: from a live fix, on the ground (taxi to the holding point) or airborne (climb). A fix
 * stopped on the ground (under 2 kt) starts nothing (Decision F-1: a departure leaves only with a recorded off-block or
 * a live fix that shows it moving): with an off-block in `times` (its PUSHBACK, or the take-off of a flight nobody
 * imported: departureAnchors) it leaves `stand` at that off-block, never before the fix, when the fix is inside the
 * stand's box, and taxis on from the fix anywhere else; without one it waits where the fix has it, without end.
 * `startHeadingDeg` is where the nose points at an apron hold.
 */
export function buildDepartureTrajectory({
  times, destination = null, layout, runwayEnd, stand = null, apronHold = null, perf, anchor = SCHEDULE,
  activeRunwayIds = null, startHeadingDeg = null,
}) {
  if (!layout || !runwayEnd || !perf) return null;
  const active = activeRunwayIds ?? [runwayEnd.runwayId];
  const meta = {
    runwayIdent: null, departureRunwayIdent: runwayEnd.ident, standCode: stand?.code ?? null, destination, anchor,
  };
  // From the stand (or the apron hold) at `offBlockMs`, fitted to a known take-off after it.
  const fromOffBlock = offBlockMs => {
    const ground = departureGroundLegs({ layout, runwayEnd, stand, apronHold, perf, activeRunwayIds: active, startHeadingDeg });
    if (!ground) return null;
    const takeoffMs = Number.isFinite(times?.takeoffMs) && times.takeoffMs > offBlockMs ? times.takeoffMs : null;
    const legs = takeoffMs === null ? ground.legs : fitLegs(ground.legs, takeoffMs - offBlockMs, { compress: false }).legs;
    return assembleTrajectory({
      kind: 'departure',
      parts: [
        { startMs: offBlockMs, legs },
        { startMs: takeoffMs, legs: climbLegs({ runwayEnd, liftoff: ground.liftoff, destination, perf }) },
      ],
      meta,
    });
  };
  if (anchor?.kind === 'fix') {
    const fix = anchor.fix;
    if (!fix || !Number.isFinite(fix.lon) || !Number.isFinite(fix.lat) || !Number.isFinite(fix.positionAt)) return null;
    if (fix.onGround !== true) {
      return assembleTrajectory({
        kind: 'departure', parts: [{ startMs: fix.positionAt, legs: climbLegsFrom({ fix, destination, perf }) }], meta,
      });
    }
    if (isStoppedOnGround(fix)) {
      const inStand = isInStand(stand, [fix.lon, fix.lat]);
      const offBlockMs = times?.offBlockMs;
      if (!Number.isFinite(offBlockMs)) {
        return stoppedAt({ kind: 'departure', fix, inStand, groundAltM: ftToM(runwayEnd.elevationFt), meta });
      }
      if (inStand) return fromOffBlock(Math.max(offBlockMs, fix.positionAt));
    }
    const ground = departureGroundLegs({
      layout, runwayEnd, perf, activeRunwayIds: active,
      fromPoint: { point: [fix.lon, fix.lat], headingDeg: fix.trackDeg ?? null, speedMs: fix.gsMs ?? 0 },
    });
    if (!ground) return null;
    return assembleTrajectory({
      kind: 'departure',
      parts: [{ startMs: fix.positionAt, legs: [...ground.legs, ...climbLegs({ runwayEnd, liftoff: ground.liftoff, destination, perf })] }],
      meta,
    });
  }
  const offBlockMs = times?.offBlockMs;
  if (!Number.isFinite(offBlockMs)) return null;
  return fromOffBlock(offBlockMs);
}
