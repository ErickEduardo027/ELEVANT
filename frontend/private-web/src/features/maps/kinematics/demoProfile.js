import { demoRunway, runwayEnd as runwayEndOf, runwayIdsInUse } from '../airport/runwayInUse.js';
import { assembleTrajectory, sampleTrajectory } from './estimator.js';
import { cutLeg, fitLegs, legDurationS, legStateAt, waitLeg } from './legs.js';
import { arrivalAirLegs, backOutAir, climbLegs, departureGroundLegs, fitGround, groundLegs } from './legPlans.js';
import { landingExitCandidates } from './pathBuilder.js';
import { routeFromPoint, routeLandingTaxi } from './taxiRoute.js';
import { ftToM } from './units.js';

// The demo flight on the map (PR M6, contracts 1.1 and 2.3, plan «Ajustes» 2 to 4). The server owns every instant of
// a demo flight (DemoFlightTimeline): appearAt, touchdownAt, onBlockAt, offBlockAt, takeoffAt and vanishAt. The map
// fits its legs to them and never derives one of its own: the aircraft appears backed out along its arrival path far
// enough for real speeds to fit (5 NM at least), lands and departs on the layout's preferred runway (08 at Punta
// Cana) whatever the wind or the live traffic, taxis to its stand once OCC imported it (to the apron hold before, where
// it waits «Esperando posición · sin importar»), waits at its stand while its off-block is unknown, and fades out at
// vanishAt. A part that cannot be flown at real speeds is compressed in time and named in `scaledParts`, so the data
// block can say «Demo acelerada ×N». SI units inside, instants as epoch milliseconds. Pure: explicit '.js' imports,
// no clock, no randomness, no JSON; every result is frozen.

/** How long a demo aircraft takes to fade out from its vanishing instant. */
export const DEMO_FADE_MS = 8000;

const STATES = new Set(['Active', 'Cancelled', 'Finished']);
const SCALED = 1 + 1e-6;

/**
 * The demo block of a map flight (contracts 1.3) as epoch milliseconds through `parseInstant`: `{ state, phase,
 * appearAtMs, touchdownAtMs, onBlockAtMs, scheduledOffBlockAtMs, offBlockAtMs, takeoffAtMs, vanishAtMs }`, frozen, or
 * `null` when it is missing, unreadable or out of order. The clock comes in order (appear ≤ touchdown ≤ on-block ≤
 * scheduled off-block; off-block, take-off and vanish follow each other and are known in that order); a cancelled
 * flight has no departure and vanishes at its cancel instant, which may come before the landing but not before it
 * appeared.
 */
export function demoClock(demo, parseInstant) {
  if (!demo || typeof demo !== 'object' || typeof parseInstant !== 'function' || !STATES.has(demo.state)) return null;
  const read = value => {
    if (value === null || value === undefined) return null;
    const ms = parseInstant(value);
    return Number.isFinite(ms) ? ms : Number.NaN;
  };
  const clock = {
    state: demo.state,
    phase: typeof demo.phase === 'string' ? demo.phase : null,
    appearAtMs: read(demo.appearAt),
    touchdownAtMs: read(demo.touchdownAt),
    onBlockAtMs: read(demo.onBlockAt),
    scheduledOffBlockAtMs: read(demo.scheduledOffBlockAt),
    offBlockAtMs: read(demo.offBlockAt),
    takeoffAtMs: read(demo.takeoffAt),
    vanishAtMs: read(demo.vanishAt),
  };
  const required = [clock.appearAtMs, clock.touchdownAtMs, clock.onBlockAtMs, clock.scheduledOffBlockAtMs];
  if (!required.every(Number.isFinite)) return null;
  if ([clock.offBlockAtMs, clock.takeoffAtMs, clock.vanishAtMs].some(Number.isNaN)) return null;
  if (!(clock.appearAtMs <= clock.touchdownAtMs && clock.touchdownAtMs <= clock.onBlockAtMs
    && clock.onBlockAtMs <= clock.scheduledOffBlockAtMs)) return null;
  if (clock.state === 'Cancelled') {
    if (clock.offBlockAtMs !== null || clock.takeoffAtMs !== null || clock.vanishAtMs === null) return null;
    if (clock.vanishAtMs < clock.appearAtMs) return null;
    return Object.freeze(clock);
  }
  if (clock.offBlockAtMs === null) {
    if (clock.takeoffAtMs !== null || clock.vanishAtMs !== null) return null;
  } else if (!(clock.offBlockAtMs >= clock.onBlockAtMs && clock.takeoffAtMs !== null && clock.takeoffAtMs >= clock.offBlockAtMs
    && clock.vanishAtMs !== null && clock.vanishAtMs >= clock.takeoffAtMs)) {
    return null;
  }
  return Object.freeze(clock);
}

const totalMs = legs => legs.reduce((sum, leg) => sum + legDurationS(leg), 0) * 1000;
const scaleOf = fit => (fit ? fit.timeScale : 1);
const lastHeading = legs => {
  const last = legs[legs.length - 1];
  if (!last) return 0;
  if (last.kind === 'wait') return last.heading;
  return last.tangentsDeg?.[last.tangentsDeg.length - 1] ?? 0;
};

/**
 * The landing of a demo flight between its touchdown and its on-block (contracts 2.3): among the exits a landing can
 * take (landingExitCandidates: those that turn 90° at most from the runway heading) and reach braking at most at the
 * profile's maximum, nearest first, the first whose taxi fits at real speeds (5 to 25 kt, no wait but the one before
 * the lead-in); when none does, the one that needs the smallest time scale. `{ fit, path }` or `null`.
 */
function demoLanding({ layout, runwayEnd, stand, apronHold, perf, activeRunwayIds, requiredMs, statusKey, groundAltM }) {
  const vref = perf.final.vrefMs;
  const exitSpeed = perf.landing.exitSpeedMs;
  const minRollM = (vref * vref - exitSpeed * exitSpeed) / (2 * perf.landing.brakingMaxMs2);
  const options = {
    perf, toStand: stand !== null, standHeadingDeg: stand?.headingTrue ?? null, statusKey, groundAltM, compress: true,
  };
  let best = null;
  for (const exit of landingExitCandidates(layout, runwayEnd, { minRollM })) {
    const path = routeLandingTaxi(layout, {
      runwayEnd, fromAlongM: perf.landing.touchdownAlongM, exitNodeId: exit.nodeId, stand, apronHold, activeRunwayIds,
    });
    const fit = path && fitGround(path, requiredMs, options);
    if (!fit) continue;
    if (fit.timeScale <= SCALED) return { fit, path };
    if (best === null || fit.timeScale < best.fit.timeScale - 1e-9) best = { fit, path };
  }
  return best;
}

/**
 * What follows the arrival: the wait at the stand or the apron hold from `arrivalMs` until the off-block (or without
 * end), then, once the off-block is known, the departure fitted to [off-block, take-off] and the climb at real speed.
 * `{ parts, departureFit }`.
 */
function afterArrival({ clock, arrivalMs, stand, holdPoint, holdHeading, apronHold, holdStatus, layout, departureEnd, destination, perf, activeRunwayIds, groundAltM }) {
  const parts = [];
  const waitPoint = stand ? stand.center : holdPoint;
  const waitHeading = stand ? stand.headingTrue : holdHeading;
  const leaves = clock.state !== 'Cancelled' && clock.offBlockAtMs !== null;
  const offBlockMs = leaves ? Math.max(clock.offBlockAtMs, arrivalMs) : null;
  const wait = waitLeg({
    phase: stand ? 'parked' : 'holding', point: waitPoint, heading: waitHeading, alt: groundAltM, part: 'parked',
    nominalS: leaves ? (offBlockMs - arrivalMs) / 1000 : Infinity, statusKey: stand ? null : holdStatus,
  });
  parts.push({ startMs: arrivalMs, legs: [wait] });
  if (!leaves) return { parts, departureFit: null };
  const ground = departureGroundLegs({
    layout, runwayEnd: departureEnd, stand, apronHold: stand ? null : apronHold, perf, activeRunwayIds, demo: true,
    startHeadingDeg: stand ? null : holdHeading,
  });
  if (!ground) return { parts, departureFit: null };
  const departureFit = fitLegs(ground.legs, clock.takeoffAtMs - offBlockMs);
  parts.push({ startMs: offBlockMs, legs: departureFit.legs });
  parts.push({ startMs: clock.takeoffAtMs, legs: climbLegs({ runwayEnd: departureEnd, liftoff: ground.liftoff, destination, perf }) });
  return { parts, departureFit };
}

/** The legs of a timed trajectory up to `cutMs`: whole legs before it and the leg it falls in, cut there. */
function legsUntil(trajectory, cutMs) {
  const kept = [];
  for (const leg of trajectory.legs) {
    if (leg.t0Ms >= cutMs) break;
    if (leg.t1Ms <= cutMs) {
      kept.push(leg);
      continue;
    }
    const durationMs = cutMs - leg.t0Ms;
    if (leg.kind === 'wait') {
      kept.push({ ...leg, nominalS: durationMs / 1000, durationRange: [durationMs / 1000, durationMs / 1000], durationMs });
    } else {
      const s = legStateAt(leg, durationMs / 1000).s;
      kept.push({ ...cutLeg(leg, 0, s), durationMs, timeScale: leg.timeScale });
    }
    break;
  }
  return kept;
}

/**
 * A demo flight's trajectory fitted to the server's instants (contracts 2.3), or `null` without a clock, a layout or a
 * route. `demo` is the clock as demoClock gives it; `counterpart` the origin airport (`[lng, lat]`, or `null`: 40 NM
 * out), `destination` where the departure goes (`[lng, lat]` or `null`). It always lands and departs on the layout's
 * preferred runway (demoRunway: 08 at Punta Cana), whatever the wind or the live arrivals.
 * - (a) [appearAt, touchdownAt]: the arrival backed out along its path at real speeds until the time is used up; when
 *   that is less than 5 NM out it starts 5 NM out and the part is compressed ('air' in `scaledParts`); when the whole
 *   path from the origin is shorter in time it starts at the origin, stretched. `meta.originPath` is the path from the
 *   origin to the start point, flown and estimated.
 * - (b) [touchdownAt, onBlockAt]: the roll, the exit and the taxi to the stand (the time over spent before the
 *   lead-in), or to the apron hold. The stand counts only once OCC `imported` the flight (contracts 2.3); before, or
 *   without one, the aircraft goes to `apronHold` (else the one the cheapest taxi reaches) and holds there:
 *   'awaitingStandNotImported' before the import, 'awaitingStand' after.
 * - (c) [onBlockAt, offBlockAt ?? ∞]: parked at the stand's centre on its heading, or holding.
 * - (d) [offBlockAt, takeoffAt]: pushback (from a stand) and taxi, the line-up and the roll lifting off at takeoffAt;
 *   no engine start or hold ('taxiOut' when compressed).
 * - (e) [takeoffAt, vanishAt]: the climb at real speed, fading out over DEMO_FADE_MS from vanishAt.
 * - Cancelled: the same parts, fading out from vanishAt (the cancel instant), `meta.statusKey` 'cancelledByProvider'.
 * - `continueFrom: { trajectory, atMs }` (a stand given later): the old legs up to `atMs` stay as they were (a landing
 *   roll in progress is finished first) and the taxi to the stand starts from where the old trajectory has the
 *   aircraft at that instant, at its speed and heading; it arrives at onBlockAt when there is time, else at nominal
 *   speed. Before the touchdown the trajectory is the fresh one, whose air part is the same.
 * `timeScale` is the largest of the parts' scales (1 when none had to be compressed) and each leg carries its part's.
 */
export function fitDemoTrajectory({
  demo, imported = false, stand = null, apronHold = null, counterpart = null, destination = null, perf, layout,
  continueFrom = null,
}) {
  const clock = demo;
  if (!clock || !perf || !layout || !STATES.has(clock.state)) return null;
  if (![clock.appearAtMs, clock.touchdownAtMs, clock.onBlockAtMs].every(Number.isFinite)) return null;
  const runway = demoRunway(layout);
  const arrivalEnd = runwayEndOf(layout, runway?.arrival);
  const departureEnd = runwayEndOf(layout, runway?.departure);
  if (!arrivalEnd || !departureEnd) return null;
  const activeRunwayIds = runwayIdsInUse(layout, runway);
  const target = imported && stand ? stand : null;
  const holdStatus = target ? null : (imported ? 'awaitingStand' : 'awaitingStandNotImported');
  const groundAltM = ftToM(arrivalEnd.elevationFt);
  const cancelled = clock.state === 'Cancelled';

  if (continueFrom?.trajectory && Number.isFinite(continueFrom.atMs) && target
    && continueFrom.atMs >= clock.touchdownAtMs) {
    return continued({
      clock, old: continueFrom.trajectory, atMs: continueFrom.atMs, stand: target, layout, perf, departureEnd, destination,
      activeRunwayIds, groundAltM, arrivalEnd, cancelled,
    });
  }

  const air = arrivalAirLegs({ origin: counterpart, runwayEnd: arrivalEnd, perf });
  const airMs = clock.touchdownAtMs - clock.appearAtMs;
  const backed = backOutAir(air, airMs);
  const airFit = fitLegs(backed.legs, airMs);
  const landing = demoLanding({
    layout, runwayEnd: arrivalEnd, stand: target, apronHold, perf, activeRunwayIds,
    requiredMs: clock.onBlockAtMs - clock.touchdownAtMs, statusKey: holdStatus, groundAltM,
  });
  if (!landing) return null;
  const groundLegsTimed = landing.fit.legs;
  const holdLeg = groundLegsTimed[groundLegsTimed.length - 1];
  const after = afterArrival({
    clock, arrivalMs: clock.onBlockAtMs, stand: target, holdPoint: holdLeg.path.coords[holdLeg.path.coords.length - 1],
    holdHeading: lastHeading(groundLegsTimed), apronHold: landing.path.apronHold, holdStatus, layout, departureEnd,
    destination, perf, activeRunwayIds, groundAltM,
  });
  const fits = { air: airFit, taxiIn: landing.fit, taxiOut: after.departureFit };
  return finish({
    clock, cancelled, fits, holdStatus, arrivalEnd, departureEnd, destination, target,
    parts: [
      { startMs: clock.appearAtMs, legs: airFit.legs },
      { startMs: clock.touchdownAtMs, legs: groundLegsTimed },
      ...after.parts,
    ],
    meta: {
      exitNodeId: landing.path.exit?.nodeId ?? null,
      apronHoldId: target ? null : (landing.path.apronHold?.id ?? null),
      originPath: backed.originPath,
      startAlongM: backed.startAlongM,
      airLimit: backed.limit,
      anchor: { kind: 'demo' },
    },
  });
}

/** The trajectory of a demo flight given a stand at `atMs`, after its touchdown (see fitDemoTrajectory). */
function continued({ clock, old, atMs, stand, layout, perf, departureEnd, destination, activeRunwayIds, groundAltM, arrivalEnd, cancelled }) {
  if (clock.offBlockAtMs !== null && atMs >= clock.offBlockAtMs) return old;
  // A landing roll in progress is finished as planned; the new taxi starts where it ends.
  let cutMs = atMs;
  for (const leg of old.legs) {
    if (leg.t1Ms <= cutMs || leg.t0Ms > cutMs) continue;
    if (leg.phase === 'landing') cutMs = leg.t1Ms;
  }
  const state = sampleTrajectory(old, cutMs);
  if (!state) return old;
  const path = routeFromPoint(layout, { point: [state.lon, state.lat], headingDeg: state.trackDeg, toNodeId: stand.node });
  if (!path) return old;
  const options = {
    perf, landing: false, startSpeed: state.gsMs, startHeadingDeg: state.trackDeg, toStand: true,
    standHeadingDeg: stand.headingTrue, groundAltM, compress: true,
  };
  let taxiFit = null;
  let taxi;
  if (cutMs < clock.onBlockAtMs) {
    taxiFit = fitGround(path, clock.onBlockAtMs - cutMs, options);
    taxi = taxiFit?.legs ?? null;
  } else {
    taxi = groundLegs(path, options)?.legs ?? null;
  }
  if (!taxi) return old;
  const arrivalMs = cutMs + totalMs(taxi);
  const after = afterArrival({
    clock, arrivalMs, stand, holdPoint: null, holdHeading: 0, apronHold: null, holdStatus: null, layout, departureEnd,
    destination, perf, activeRunwayIds, groundAltM,
  });
  const before = old.meta.parts ?? {};
  const fits = {
    air: before.air ? { timeScale: before.air.timeScale } : null,
    taxiIn: taxiFit ?? { timeScale: before.taxiIn?.timeScale ?? 1 },
    taxiOut: after.departureFit,
  };
  return finish({
    clock, cancelled, fits, holdStatus: null, arrivalEnd, departureEnd, destination, target: stand,
    parts: [
      { startMs: old.startMs, legs: legsUntil(old, cutMs) },
      { startMs: cutMs, legs: taxi },
      ...after.parts,
    ],
    meta: {
      exitNodeId: old.meta.exitNodeId,
      apronHoldId: null,
      originPath: old.meta.originPath,
      startAlongM: old.meta.startAlongM ?? null,
      airLimit: old.meta.airLimit ?? null,
      anchor: { kind: 'demo', continuedAtMs: cutMs },
    },
  });
}

/** The trajectory's time scales, fade and status, and its assembly. */
function finish({ clock, cancelled, fits, holdStatus, arrivalEnd, departureEnd, destination, target, parts, meta }) {
  const parted = {};
  const scaledParts = [];
  for (const name of ['air', 'taxiIn', 'taxiOut']) {
    const fit = fits[name];
    if (!fit) continue;
    parted[name] = { timeScale: scaleOf(fit), factor: fit.factor ?? null };
    if (scaleOf(fit) > SCALED) scaledParts.push(name);
  }
  const vanishMs = clock.vanishAtMs;
  const fade = vanishMs === null ? null : { startMs: vanishMs, endMs: vanishMs + DEMO_FADE_MS };
  return assembleTrajectory({
    kind: 'demo',
    parts,
    timeScale: Math.max(1, ...Object.values(parted).map(part => part.timeScale)),
    scaledParts,
    meta: {
      ...meta,
      runwayIdent: arrivalEnd.ident,
      departureRunwayIdent: departureEnd.ident,
      standCode: target ? target.code : null,
      statusKey: cancelled ? 'cancelledByProvider' : holdStatus,
      destination,
      fade,
      parts: parted,
    },
  });
}
