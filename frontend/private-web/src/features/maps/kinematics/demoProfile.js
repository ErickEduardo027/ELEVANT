import { demoRunway, runwayEnd as runwayEndOf, runwayIdsInUse } from '../airport/runwayInUse.js';
import { assembleTrajectory, sampleTrajectory } from './estimator.js';
import { cutLeg, fitLegs, legDurationS, legStateAt, waitLeg } from './legs.js';
import { arrivalAirLegs, backOutAir, climbLegs, departureGroundLegs, fitGround, groundLegs } from './legPlans.js';
import { landingExitCandidates } from './pathBuilder.js';
import { departureHoldingPoints, routeFromPoint, routeLandingTaxi } from './taxiRoute.js';
import { ftToM } from './units.js';

// The demo flight on the map (PR M6, contracts 1.1 and 2.3, plan «Ajustes» 2 to 4). The server owns every instant of
// a demo flight (DemoFlightTimeline): appearAt, touchdownAt, onBlockAt, offBlockAt, takeoffAt and vanishAt. The map
// fits its legs to them and never derives one of its own: the aircraft appears backed out along its arrival path far
// enough for real speeds to fit (5 NM at least; time over, when even the whole path from the origin is shorter, is
// flown in a holding pattern over the approach gate), lands and departs on the layout's preferred runway (08 at Punta
// Cana) whatever the wind or the live traffic, taxis to its stand once OCC imported it (to the apron hold before, where
// it waits «Esperando posición · sin importar»), waits at its stand while its off-block is unknown, and fades out at
// vanishAt, or where it is when the reads stop listing it (endDemoTrajectory). A part that cannot be flown at real
// speeds is scaled in time and named in `scaledParts`, so the data block can say «Demo acelerada ×N»
// (kinematicsMessages.js: timeScaleMessage, also for a part that ever had to run slower). SI units inside, instants as
// epoch milliseconds. Pure: explicit '.js' imports, no clock, no randomness, no JSON; every result is frozen.

/** How long a demo aircraft takes to fade out from its vanishing instant. */
export const DEMO_FADE_MS = 8000;

const STATES = new Set(['Active', 'Cancelled', 'Finished']);
const PARTS = Object.freeze(['air', 'taxiIn', 'taxiOut']);
const SCALED = 1 + 1e-6;
// A part runs in real time unless its scale is off 1 by more than a millionth, either way.
const isScaled = scale => scale > SCALED || scale < 1 / SCALED;
const offBy = scale => Math.abs(Math.log(scale));

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
 * the lead-in); when none does, the one whose time scale is nearest 1. `{ fit, path }` or `null`.
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
    if (!isScaled(fit.timeScale)) return { fit, path };
    if (best === null || offBy(fit.timeScale) < offBy(best.fit.timeScale) - 1e-9) best = { fit, path };
  }
  return best;
}

/**
 * The departure on the ground of a demo flight fitted to [off-block, take-off] (contracts 2.3; the orchestrator's
 * decision of 2026-11-14): to the holding point that leaves the whole runway, unless that taxi needs more than real
 * speeds (25 kt at most) in the time it has; then to the first holding point of the runway after it, from the
 * threshold, whose taxi fits at real speeds and whose runway left still holds the take-off roll (at Punta Cana,
 * terminal A's farthest stands depart from H on 08: kinematics/demoProfile.test.js lists them). When none does, the full
 * length, compressed («Demo acelerada ×N»). `{ ground, fit }`, or `null` without a route.
 */
function demoDeparture({ layout, departureEnd, stand, apronHold, perf, activeRunwayIds, startHeadingDeg, requiredMs }) {
  const build = holdingPointId => departureGroundLegs({
    layout, runwayEnd: departureEnd, stand, apronHold, perf, activeRunwayIds, demo: true, startHeadingDeg, holdingPointId,
  });
  const ground = build(null);
  if (!ground) return null;
  const fit = fitLegs(ground.legs, requiredMs);
  if (!(fit.timeScale > SCALED)) return { ground, fit };
  for (const { hold } of departureHoldingPoints(layout, departureEnd)) {
    if (hold.id === ground.holdingPoint?.id) continue;
    const other = build(hold.id);
    if (!other || !other.rollFits) continue;
    const otherFit = fitLegs(other.legs, requiredMs);
    if (!(otherFit.timeScale > SCALED)) return { ground: other, fit: otherFit };
  }
  return { ground, fit };
}

/**
 * What follows the arrival: the wait at the stand or the apron hold from `arrivalMs` until the off-block (or without
 * end), then, once the off-block is known, the departure fitted to [off-block, take-off] (demoDeparture) and the climb
 * at real speed. `{ parts, departureFit, holdingPointId }`: the holding point the departure taxis to, or `null`.
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
  if (!leaves) return { parts, departureFit: null, holdingPointId: null };
  const departure = demoDeparture({
    layout, departureEnd, stand, apronHold: stand ? null : apronHold, perf, activeRunwayIds,
    startHeadingDeg: stand ? null : holdHeading, requiredMs: clock.takeoffAtMs - offBlockMs,
  });
  if (!departure) return { parts, departureFit: null, holdingPointId: null };
  const { ground, fit: departureFit } = departure;
  parts.push({ startMs: offBlockMs, legs: departureFit.legs });
  parts.push({ startMs: clock.takeoffAtMs, legs: climbLegs({ runwayEnd: departureEnd, liftoff: ground.liftoff, destination, perf }) });
  return { parts, departureFit, holdingPointId: ground.holdingPoint?.id ?? null };
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
 *   path from the origin takes less time (a near origin, or none: 40 NM out) it starts at the origin and flies the time
 *   over at real speed in a holding pattern over the approach gate (`meta.airHold`; legPlans.js: backOutAir).
 *   `meta.originPath` is the path from the origin to the start point, flown and estimated.
 * - (b) [touchdownAt, onBlockAt]: the roll, the exit and the taxi to the stand (the time over spent before the
 *   lead-in), or to the apron hold. The stand counts only once OCC `imported` the flight (contracts 2.3); before, or
 *   without one, the aircraft goes to `apronHold` (else the one the cheapest taxi reaches) and holds there:
 *   'awaitingStandNotImported' before the import, 'awaitingStand' after.
 * - (c) [onBlockAt, offBlockAt ?? ∞]: parked at the stand's centre on its heading, or holding.
 * - (d) [offBlockAt, takeoffAt]: pushback (from a stand) and taxi, the line-up and the roll lifting off at takeoffAt;
 *   no engine start or hold ('taxiOut' when compressed). It taxis to the holding point that leaves the whole runway,
 *   or, when that taxi does not fit at real speeds, to the first intersection that does and still holds the roll
 *   (demoDeparture); `meta.departureHoldingPointId` names it.
 * - (e) [takeoffAt, vanishAt]: the climb at real speed, fading out over DEMO_FADE_MS from vanishAt.
 * - Cancelled: the same parts, fading out from vanishAt (the cancel instant), `meta.statusKey` 'cancelledByProvider'.
 *   With `continueFrom` (the trajectory drawn until the cancellation came; `atMs` is not needed) its legs stay exactly
 *   as they were and only the fade and the status change, so the aircraft fades out where it is: a cancelled clock has
 *   no departure, and rebuilt from it alone an aircraft nobody imported that was taxiing to the runway or climbing
 *   would be back at its apron hold.
 * - `continueFrom: { trajectory, atMs }` (a stand given later): the old legs up to `atMs` stay as they were (a landing
 *   roll in progress is finished first) and the taxi to the stand starts from where the old trajectory has the
 *   aircraft at that instant, at its speed and heading; it arrives at onBlockAt when there is time, else at nominal
 *   speed. Before the touchdown the trajectory is the fresh one, whose air part is the same. Given a continued
 *   trajectory again with its own `meta.anchor.continuedAtMs` (a rebuild for the same stand: an off-block, «Terminar
 *   demo», a new state), it keeps the same taxi and only what follows the arrival changes.
 * Each leg carries its part's time scale. Every part whose scale is not 1 is named in `scaledParts`, above 1 (faster
 * than real time) or below (slower), and `timeScale` is the scale farthest from 1 (1 when every part runs in real
 * time).
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

  if (cancelled && continueFrom?.trajectory) {
    const faded = cancelledFrom(continueFrom.trajectory, clock);
    if (faded !== null) return faded;
  }
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
      departureHoldingPointId: after.holdingPointId,
      originPath: backed.originPath,
      startAlongM: backed.startAlongM,
      airLimit: backed.limit,
      airHold: backed.hold,
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
      departureHoldingPointId: after.holdingPointId,
      originPath: old.meta.originPath,
      startAlongM: old.meta.startAlongM ?? null,
      airLimit: old.meta.airLimit ?? null,
      airHold: old.meta.airHold ?? null,
      anchor: { kind: 'demo', continuedAtMs: cutMs },
    },
  });
}

/**
 * The time scales of a demo trajectory's parts (`fits`: `{ air, taxiIn, taxiOut }`, each a fit or `{ timeScale,
 * factor }`, or `null`): `{ parts, scaledParts, timeScale }`. Every part whose scale is not 1 is named in
 * `scaledParts`, whichever way it goes, and `timeScale` is the scale farthest from 1, or 1 when every part runs in real
 * time.
 */
function timeScales(fits) {
  const parts = {};
  const scaledParts = [];
  let timeScale = 1;
  for (const name of PARTS) {
    const fit = fits[name];
    if (!fit) continue;
    const scale = scaleOf(fit);
    parts[name] = { timeScale: scale, factor: fit.factor ?? null };
    if (!isScaled(scale)) continue;
    scaledParts.push(name);
    if (offBy(scale) > offBy(timeScale)) timeScale = scale;
  }
  return { parts, scaledParts, timeScale };
}

/**
 * A demo trajectory (`old`, the one drawn until then) faded out from `fadeAtMs` where it is: its legs exactly as they
 * were, fading out over DEMO_FADE_MS from `fadeAtMs` (or from its own fade, when that began first), with `statusKey` as
 * its status while it fades and `anchor` added to its anchor. The parts still drawn keep their time scales. `null` when
 * `old` is not a demo trajectory or begins after `fadeAtMs`.
 */
function fadedFrom(old, fadeAtMs, { statusKey, anchor }) {
  if (old?.kind !== 'demo' || !Array.isArray(old.legs) || !Number.isFinite(fadeAtMs) || !(old.startMs <= fadeAtMs)) {
    return null;
  }
  const own = old.meta?.fade ?? null;
  const fade = own !== null && own.startMs <= fadeAtMs ? own : { startMs: fadeAtMs, endMs: fadeAtMs + DEMO_FADE_MS };
  const kept = old.legs.filter(leg => leg.t0Ms < fade.endMs);
  const drawn = new Set(kept.map(leg => leg.part));
  const before = old.meta?.parts ?? {};
  const scales = timeScales(Object.fromEntries(PARTS.map(name => [name, drawn.has(name) ? (before[name] ?? null) : null])));
  return assembleTrajectory({
    kind: 'demo',
    // Each leg at its own instant, so nothing before the fade moves.
    parts: kept.map(leg => ({ startMs: leg.t0Ms, legs: [leg] })),
    timeScale: scales.timeScale,
    scaledParts: scales.scaledParts,
    meta: {
      ...old.meta,
      statusKey,
      fade,
      parts: scales.parts,
      anchor: { ...(old.meta?.anchor ?? { kind: 'demo' }), ...anchor },
    },
  });
}

/**
 * A cancelled demo flight continued from the trajectory drawn until then (`old`): its legs exactly as they were,
 * fading out from the cancel instant (or from its own fade, when that began first), with the status
 * 'cancelledByProvider'. `null` when `old` is not a demo trajectory or begins after the cancel instant.
 */
function cancelledFrom(old, clock) {
  const cancelAtMs = clock.vanishAtMs;
  return fadedFrom(old, cancelAtMs, { statusKey: 'cancelledByProvider', anchor: { cancelledAtMs: cancelAtMs } });
}

/**
 * A demo trajectory (`old`, the one drawn until then) ended at `atMs` where it is, for a demo flight the reads no
 * longer list (traffic/motionStore.js: the server dismissed its rows before the import, so no clock of its own says
 * how it ends): its legs exactly as they were, fading out over DEMO_FADE_MS from `atMs`, or from its own fade when
 * that began first, with `meta.anchor.endedAtMs`. `statusKey` is what it says while it fades: 'cancelledByProvider'
 * for a flight that left before its touchdown, when only a cancellation ends one; `null` leaves each leg its own. The
 * parts still drawn keep their time scales. `null` when `old` is not a demo trajectory or begins after `atMs`.
 */
export function endDemoTrajectory(old, { atMs, statusKey = null } = {}) {
  return fadedFrom(old, atMs, { statusKey, anchor: { endedAtMs: atMs } });
}

/** The trajectory's time scales, fade and status, and its assembly. */
function finish({ clock, cancelled, fits, holdStatus, arrivalEnd, departureEnd, destination, target, parts, meta }) {
  const scales = timeScales(fits);
  const vanishMs = clock.vanishAtMs;
  const fade = vanishMs === null ? null : { startMs: vanishMs, endMs: vanishMs + DEMO_FADE_MS };
  return assembleTrajectory({
    kind: 'demo',
    parts,
    timeScale: scales.timeScale,
    scaledParts: scales.scaledParts,
    meta: {
      ...meta,
      runwayIdent: arrivalEnd.ident,
      departureRunwayIdent: departureEnd.ident,
      standCode: target ? target.code : null,
      statusKey: cancelled ? 'cancelledByProvider' : holdStatus,
      destination,
      fade,
      parts: scales.parts,
    },
  });
}
