import { parseInstant } from '../../../services/serverClock';
import { normalizeStandCode } from '../../../services/standCodes';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM, initialBearing } from '../airport/geo';
import { indexLayout, matchStand } from '../airport/layoutIndex';
import { runwayEnd, runwayEnds, runwayIdsInUse, runwayInUse } from '../airport/runwayInUse';
import { demoClock, endDemoTrajectory, fitDemoTrajectory } from '../kinematics/demoProfile';
import {
  buildArrivalTrajectory, buildDepartureTrajectory, departureAnchors, flightTimesFromRow, shouldEstimate,
} from '../kinematics/estimator';
import { TRACK_CONFIG, createTrack, needsReplan, reduceTrack, renderTrack, trackConfigFor } from '../kinematics/handoff';
import { perfFor } from '../kinematics/perfProfiles';
import { apronHoldFor } from '../kinematics/taxiRoute';
import { NM, ftToM } from '../kinematics/units';
import { claimFixes, fixIdentity } from './situationModel';

// What moves on an OCC map and how (PR M6, design F4's «track store»): the tracks of the hand-off
// (kinematics/handoff.js), one per aircraft the map draws, fed with every fix of the air picture and with the
// trajectory planned for each ELEVANT flight it estimates (kinematics/estimator.js for real flights,
// kinematics/demoProfile.js for the demo flight). It keeps state and a cache, so it lives here and not in the pure
// kinematics. Everything it answers is a function of an explicit server instant: the frame loop (core/frameLoop.js)
// samples it at the render clock's time, the data block reads one aircraft through the telemetry store, and the
// situation (traffic/situationModel.js) takes its estimates at the instant of the last read.
//
// - Decision F-1 decides which ELEVANT flight without a live fix is drawn at all (estimator.js: shouldEstimate); a demo
//   flight always is. One aircraft per visit: the departure takes the aircraft from its off-block (a demo flight) or
//   from the moment shouldEstimate draws it (its PUSHBACK, or a live fix); before that the arrival has it, parked at
//   its stand. An imported flight never leaves its stand by estimate. A visit with a live fix on either leg is drawn by
//   the fix alone.
// - A demo flight follows fitDemoTrajectory with the server's instants on runway 08 (contracts 2.3), its stand only
//   once OCC imported it, else its terminal's apron hold; imported later it continues from where it is drawn, at the
//   instant of the flights read that brought the import (every screen that reads that answer draws the same), and what
//   comes after (its off-block, its state) is rebuilt from that same continuation; cancelled it fades out where it is.
//   A demo visit a newer read of the station no longer lists (the server dismissed its rows before the import: a
//   cancellation, OCC's dismissal, «Terminar demo», the worker at vanishAt) fades out where it is too, from that read
//   on, and is forgotten once its fade is over (leavingDemo).
// - A real flight lands and departs on the runway in use: the live arrivals seen on final in the newest picture that had
//   any, for FINAL_VOTE.keepMs after they were seen, then (from PR M8) the METAR wind, then the layout's preferred
//   runway (airport/runwayInUse.js).
// - A trajectory is built when its inputs change (planInputsKey), never per frame: a demo flight's takes about 15 ms.
// - Per sample, a track whose fix aged past its coast is rebuilt once from that fix (handoff.js: needsReplan) at the
//   instant the coast ended, so every screen blends the same way. A fix stopped on the ground starts nothing
//   (estimator.js, Decision F-1): an aircraft parked at its stand, or a departure nothing recorded leaving, waits where
//   the fix has it, and a departure with its PUSHBACK leaves its stand then.

/** How long the store keeps a track nobody draws any more, from the last read that named it. */
export const FORGET_AFTER_MS = 10 * 60_000;
/**
 * A live aircraft «on final» votes for its runway (runwayInUse): this close to the threshold, below this height, not
 * climbing, with the threshold ahead within `maxOffDeg`. The votes of the newest picture that had any keep the runway
 * of real flights for `keepMs` after the newest of them was seen (contracts 2.3: «recent live arrivals»), so the gaps
 * between arrivals neither turn the runway back to the preferred one nor rebuild the trajectories planned on it.
 */
export const FINAL_VOTE = Object.freeze({
  maxDistanceM: 15 * NM, maxHeightM: ftToM(6_000), maxOffDeg: 20, climbMs: 1, keepMs: 30 * 60_000,
});
// The taxi-out a departure nobody imported is placed back from its take-off by: the server's demo constant.
const NOMINAL_TAXI_OUT_MS = 5 * 60_000;
// Below this speed an aircraft stands still (a fix on the ground under 2 kt holds its position).
const MOVING_MS = 0.5;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const pointOf = airport => (finite(airport?.longitude) && finite(airport?.latitude) ? [airport.longitude, airport.latitude] : null);
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const milestoneAt = (row, code) => (Array.isArray(row?.milestones) ? row.milestones : [])
  .find(item => item?.code === code && item?.actualAt != null)?.actualAt ?? null;
const visitOf = row => row.visitKey ?? row.flightKey;

/**
 * The key of what a flight's trajectory is built from (PR M6): equal keys, the same trajectory. It holds the flight's
 * key, direction and provider phase, its times (scheduled, estimated, actual and their kind), its BLOCK_ON and
 * PUSHBACK, whether it is imported, its stand, and from `ctx` the apron hold it waits at, the runway it lands and
 * departs on, its origin and destination and its performance category. A demo flight's key holds its clock instead of
 * its phase and times: the server's demo phase and the row's phase move with the time while its instants stay, and a
 * rebuild would undo a continuation (fitDemoTrajectory: continueFrom).
 */
export function planInputsKey(flight, ctx = {}) {
  const demo = flight?.isDemo === true && flight?.demo ? flight.demo : null;
  const common = [
    flight?.flightKey ?? null, flight?.direction ?? null, flight?.imported === true,
    normalizeStandCode(text(flight?.stand?.code) ?? '') || null, ctx.apronHoldId ?? null,
    ctx.runway?.arrival ?? null, ctx.runway?.departure ?? null, pointOf(flight?.counterpart), ctx.destination ?? null,
    ctx.perfCategory ?? null,
  ];
  if (demo) {
    return JSON.stringify(['demo', ...common, demo.state ?? null, demo.appearAt ?? null, demo.touchdownAt ?? null,
      demo.onBlockAt ?? null, demo.scheduledOffBlockAt ?? null, demo.offBlockAt ?? null, demo.takeoffAt ?? null,
      demo.vanishAt ?? null]);
  }
  return JSON.stringify(['flight', ...common, flight?.phase ?? null, flight?.scheduledAt ?? null,
    flight?.estimatedAt ?? null, flight?.actualAt ?? null, flight?.actualKind ?? null, milestoneAt(flight, 'BLOCK_ON'),
    milestoneAt(flight, 'PUSHBACK')]);
}

const indexes = new WeakMap();
function standOfCode(layout, code) {
  if (!layout || text(code) === null) return null;
  let index = indexes.get(layout);
  if (!index) {
    index = indexLayout(layout);
    indexes.set(layout, index);
  }
  const found = matchStand(code, index)?.stand ?? null;
  return found && found.retired !== true ? found : null;
}

/**
 * The live arrivals of a picture on final for a runway end of the layout, as runwayInUse takes them, with the instant
 * each was seen (`[{ trackDeg, positionAt }]`): airborne, not climbing, below 6 000 ft, within 15 NM of a threshold
 * that lies ahead of them on that end's heading.
 */
export function arrivalsOnFinal(fixes, layout) {
  const ends = runwayEnds(layout);
  const votes = [];
  for (const fix of Array.isArray(fixes) ? fixes : []) {
    if (fix?.onGround === true || !finite(fix?.trackDeg) || !finite(fix?.lon) || !finite(fix?.lat)) continue;
    if (finite(fix.vrateMs) && fix.vrateMs > FINAL_VOTE.climbMs) continue;
    const here = [fix.lon, fix.lat];
    const onFinal = ends.some(end => {
      const height = finite(fix.altM) ? fix.altM - ftToM(end.elevationFt) : 0;
      if (height > FINAL_VOTE.maxHeightM || haversineM(here, end.threshold) > FINAL_VOTE.maxDistanceM) return false;
      return angleBetween(initialBearing(here, end.threshold), end.headingTrue) <= FINAL_VOTE.maxOffDeg;
    });
    if (onFinal) votes.push({ trackDeg: fix.trackDeg, positionAt: fix.positionAt });
  }
  return votes;
}

/** A trajectory that never moves: a flight a stopped fix holds where it is (estimator.js), which is no route. */
const holdsStill = trajectory => trajectory.legs.every(leg => leg.kind === 'wait');

/**
 * A demo row as the map reads it once it took the flight for cancelled at `atMs` (leavingDemo): the flight cancelled,
 * and its demo clock as the server writes a cancelled one (no departure, vanishing then).
 */
function cancelledRow(row, atMs) {
  if (!row) return row;
  const demo = row.demo && typeof row.demo === 'object' ? Object.freeze({
    ...row.demo, state: 'Cancelled', phase: 'Gone', offBlockAt: null, takeoffAt: null,
    vanishAt: new Date(atMs).toISOString(),
  }) : row.demo;
  return Object.freeze({ ...row, phase: 'cancelled', demo });
}

/** Where a sample of a track moves: it has a speed, a blend or a fade under way, or it is fading out. */
function moves(track, render, tMs, config) {
  if (render === null) return false;
  if (finite(render.gsMs) && render.gsMs > MOVING_MS) return true;
  if (render.opacity < 1) return true;
  const blend = track?.blend;
  if (blend && tMs < blend.startMs + blend.durationMs) return true;
  return finite(track?.snapAtMs) && tMs < track.snapAtMs + config.snapFadeS * 1_000;
}

/** The instants of a trajectory at which what the situation draws changes: it appears, lands, parks, leaves, fades, ends. */
function trajectoryInstants(trajectory) {
  if (!trajectory) return [];
  const instants = [trajectory.startMs];
  const first = phases => trajectory.legs.find(leg => phases.includes(leg.phase))?.t0Ms;
  instants.push(first(['landing']), first(['parked', 'holding']), first(['pushback', 'taxiOut']));
  const fade = trajectory.meta?.fade;
  if (fade) instants.push(fade.startMs);
  instants.push(trajectory.endMs);
  return instants.filter(finite);
}

/**
 * The motion of one map.
 * - `layout` (MDPC by default), `clock` (the render clock: core/frameLoop.js createRenderClock; the frame loop draws at
 *   its time), `perf` (perfFor) and `build` (the trajectory builders, for the tests).
 * - `ingest({ picture, flights })`: the models of situationModel.js (toPictureModel, toFlightsModel), after every read;
 *   the same two again change nothing.
 * - `estimatesAt(tMs)`: the positions of the ELEVANT flights it estimates, for buildSituation's `estimates`. A demo
 *   flight a newer read no longer lists, while it fades out (leavingDemo), comes with its last row as `flight`: the
 *   situation draws it from that row, cancelled when it left before its touchdown.
 * - `sample(aircraft, tMs)`: the aircraft of a situation where they are drawn at `tMs`: each one the store knows takes
 *   its track's render (position, height, speed, heading, phase, mode, ageS, statusKey, opacity, timeScale and, where a
 *   plan places it, quality 'estimated'), `null` when its track draws nothing then; one it does not know is as given.
 *   `sampleOne(id, tMs, aircraft)` does it for one.
 * - `isAnimating(tMs)`: whether anything drawn moves; `nextChangeAt(tMs)`: the next instant after `tMs` when what it
 *   estimates changes (an appearance, a touchdown, an on-block, an off-block, a fade, an ELEVANT flight's fix losing its
 *   signal or its coast), or `null`.
 * - `trajectoryOf(flightKey)` and `followTargets(flightKey)` (`{ airport, threshold, stand, apronHold }`, for
 *   kinematics/followCamera.js): of a flight it plans.
 * - `trajectoryForRoute(flight)` (PR M6, for the chosen flight's route, traffic/routeFeatures.js): the trajectory it
 *   plans for a flight row, else, for one it does not draw (Decision F-1: merely scheduled, a departure waiting for
 *   its push-back, the other leg of a visit drawn as one aircraft), one built from its schedule for the route alone
 *   (cached by its inputs, never sampled for a position): an arrival from its origin to its stand, a departure from
 *   its stand at its planned off-block. A flight a stopped fix holds where it is (estimator.js) takes its visit's plan,
 *   else its schedule's, as one it does not draw. `null` for a cancelled or diverted flight, a demo flight it does not
 *   plan or that fades out after it left the reads, or without the instants.
 * - `runway()`: the runway in use for real flights (`{ arrival, departure, source }`: FINAL_VOTE), `dataAt()`: the
 *   server instant of the last read; `subscribe(listener)` hears every ingest; `clock` is the clock it was given.
 */
export function createMotionStore({
  layout = MDPC_LAYOUT, clock = null, perf = perfFor,
  build = { fitDemoTrajectory, buildArrivalTrajectory, buildDepartureTrajectory },
} = {}) {
  const listeners = new Set();
  const tracks = new Map();
  const seenAt = new Map();
  // The trajectories built for the route of a flight the store does not draw, by its key: `{ key, trajectory }`.
  let routePlans = new Map();
  let plans = new Map();
  let units = [];
  let flightsByKey = new Map();
  let config = TRACK_CONFIG;
  let lastPicture;
  let lastFlights;
  let runway = runwayInUse({ layout });
  // The arrivals on final of the newest picture that had any, and when the newest of them was seen (FINAL_VOTE).
  let finalVote = null;
  let dataAt = null;
  let lastSample = null;

  const arp = Array.isArray(layout?.meta?.arp) ? layout.meta.arp : null;

  function trackOf(id, kind) {
    return tracks.get(id) ?? createTrack({ id, kind });
  }

  // The apron hold a flight without a stand waits at: its suggested stand's terminal's (a demo not imported), or none.
  function apronHoldOf(row) {
    const terminal = text(row?.stand?.terminalCode) ?? standOfCode(layout, row?.suggestedStandCode)?.terminal ?? null;
    return apronHoldFor(layout, terminal);
  }

  function contextOf(row, { destination = null } = {}) {
    const hold = apronHoldOf(row);
    return {
      apronHoldId: hold?.id ?? null,
      apronHold: hold,
      runway,
      destination,
      perf: perf({ typeIcao: row?.aircraft?.typeIcaoCode ?? null, sizeCategory: row?.aircraft?.sizeCategory ?? null }),
    };
  }

  // A real flight's trajectory from its schedule (or anchored at a live fix), or `null`.
  function realTrajectory(row, ctx, anchor = undefined) {
    const stand = standOfCode(layout, row?.stand?.code);
    const activeRunwayIds = runwayIdsInUse(layout, ctx.runway);
    const times = flightTimesFromRow(row, parseInstant);
    if (row.direction === 'Departure') {
      const anchors = departureAnchors(times, {
        imported: row.imported === true, liveFixAtMs: null, nominalTaxiOutMs: NOMINAL_TAXI_OUT_MS,
      });
      return build.buildDepartureTrajectory({
        times: anchors, destination: pointOf(row.counterpart), layout, runwayEnd: runwayEnd(layout, ctx.runway.departure),
        stand, apronHold: stand ? null : ctx.apronHold, perf: ctx.perf, activeRunwayIds,
        ...(anchor === undefined ? {} : { anchor }),
      });
    }
    return build.buildArrivalTrajectory({
      times, origin: pointOf(row.counterpart), layout, runwayEnd: runwayEnd(layout, ctx.runway.arrival), stand,
      apronHold: stand ? null : ctx.apronHold, perf: ctx.perf, imported: row.imported === true, activeRunwayIds,
      ...(anchor === undefined ? {} : { anchor }),
    });
  }

  // A demo visit's trajectory: fitted to the server's instants, continued from the one drawn when it was imported or
  // given another stand after the touchdown, and faded where it is when cancelled. A continuation lasts: rebuilt for its
  // same stand (an off-block, «Terminar demo», a new state), the trajectory continues again from the instant the drawn
  // one did (its `meta.anchor.continuedAtMs`, before any off-block), so its taxi stays as drawn and only what follows
  // the arrival changes.
  function demoTrajectory(unit, previous, flights) {
    const clockOfDemo = demoClock(unit.demo, parseInstant);
    if (clockOfDemo === null) return null;
    const imported = unit.arrival.imported === true;
    const stand = standOfCode(layout, unit.arrival.stand?.code ?? unit.departure?.stand?.code);
    const target = imported && stand ? stand.code : null;
    const old = previous?.trajectory ?? null;
    const continuedAtMs = old?.meta?.anchor?.continuedAtMs;
    let continueFrom = null;
    if (old !== null) {
      if (clockOfDemo.state === 'Cancelled') {
        if (previous.state !== 'Cancelled') continueFrom = { trajectory: old };
      } else if (target !== null && previous.target !== target && finite(flights?.serverTime)) {
        continueFrom = { trajectory: old, atMs: flights.serverTime };
      } else if (target !== null && previous.target === target && finite(continuedAtMs)) {
        continueFrom = { trajectory: old, atMs: continuedAtMs };
      }
    }
    const trajectory = build.fitDemoTrajectory({
      demo: clockOfDemo, imported, stand, apronHold: unit.ctx.apronHold, counterpart: pointOf(unit.arrival.counterpart),
      destination: unit.ctx.destination, perf: unit.ctx.perf, layout, continueFrom,
    });
    return { trajectory, state: clockOfDemo.state, target, offBlockAtMs: clockOfDemo.offBlockAtMs };
  }

  // The visits of the flights and what the store plans for each (one aircraft per visit).
  function unitsOf(flights, claimed) {
    const visits = new Map();
    for (const row of flights?.flights ?? []) {
      if (row?.flightKey == null) continue;
      const legs = visits.get(visitOf(row)) ?? [];
      legs.push(row);
      visits.set(visitOf(row), legs);
    }
    const planned = [];
    for (const [visitKey, legs] of visits) {
      const arrival = legs.find(leg => leg.direction !== 'Departure') ?? null;
      const departure = legs.find(leg => leg.direction === 'Departure') ?? null;
      const demoLeg = legs.find(leg => leg.isDemo === true && leg.demo) ?? null;
      if (demoLeg) {
        const first = arrival ?? demoLeg;
        const ctx = contextOf(first, { destination: pointOf(departure?.counterpart) ?? pointOf(first.counterpart) });
        // A demo flight always uses the layout's preferred runway: the runway in use is not one of its inputs.
        planned.push({
          id: `v:${visitKey}`, kind: 'demo', demo: demoLeg.demo, arrival: first, departure, ctx, estimated: true,
          key: planInputsKey({ ...first, demo: demoLeg.demo }, {
            apronHoldId: ctx.apronHoldId, destination: ctx.destination, perfCategory: ctx.perf.category,
          }),
        });
        continue;
      }
      const live = legs.find(leg => claimed.has(leg.flightKey) && leg.direction === 'Departure')
        ?? legs.find(leg => claimed.has(leg.flightKey)) ?? null;
      const departureDrawn = departure !== null && shouldEstimate(departure, { hasLiveFix: claimed.has(departure.flightKey) }).draw;
      for (const row of [arrival, departure]) {
        if (row === null) continue;
        const hasFix = claimed.has(row.flightKey);
        const drawn = row.direction === 'Departure' ? departureDrawn : shouldEstimate(row).draw;
        // A visit with a live fix is drawn by the fix: its leg plans only to coast along; the other leg draws nothing.
        if (live !== null && row !== live) continue;
        if (live === null && row === arrival && departureDrawn) continue;
        if (!drawn) continue;
        const ctx = contextOf(row);
        planned.push({
          id: `${row.direction === 'Departure' ? 'd' : 'a'}:${row.flightKey}`, kind: 'flight', row, ctx, estimated: !hasFix,
          key: planInputsKey(row, { ...ctx, perfCategory: ctx.perf.category }),
        });
      }
    }
    return planned;
  }

  // The flight keys a unit draws its aircraft as at `tMs`.
  function drawnKeyAt(unit, tMs) {
    if (unit.kind !== 'demo') return unit.row.flightKey;
    const offBlock = unit.plan?.offBlockAtMs;
    if (unit.departure && finite(offBlock) && tMs >= offBlock) return unit.departure.flightKey;
    return unit.arrival.flightKey;
  }
  const keysOf = unit => (unit.kind === 'demo'
    ? [unit.arrival.flightKey, ...(unit.departure ? [unit.departure.flightKey] : [])]
    : [unit.row.flightKey]);

  function dispatchPlan(unit, atMs) {
    for (const key of keysOf(unit)) {
      const id = `f:${key}`;
      const track = trackOf(id, 'aviam');
      tracks.set(id, reduceTrack(track, { type: 'plan', trajectory: unit.plan?.trajectory ?? null, atMs }, config));
    }
  }

  // A demo visit of the last read that a newer read of the same station no longer lists (the server dismissed its rows
  // before the import: a cancellation, OCC's dismissal, «Terminar demo», the worker at vanishAt): the unit it leaves
  // as, fading out where it is drawn from `atMs` (the instant of that read; kinematics/demoProfile.js:
  // endDemoTrajectory), or `null` once nothing of it is left to draw at `nowMs`. Before its touchdown a flight nobody
  // imported leaves the reads only cancelled (contracts 1.1: «Cancelar vuelo» before it, «Terminar demo» after; OCC's
  // dismissal cancels it too), so it fades out cancelled by the provider and its rows read as cancelled; after it, or
  // imported (its rows are never dismissed: OCC cancelled its turnaround), nothing new is said. One that was fading
  // already (cancelled, past its own vanishAt, or leaving) goes on as it is.
  function leavingDemo(unit, atMs, nowMs) {
    const trajectory = unit.plan?.trajectory ?? null;
    if (trajectory === null) return null;
    let leaving = unit;
    if (unit.leaving !== true) {
      const fade = trajectory.meta?.fade ?? null;
      if (unit.plan.state === 'Cancelled' || (fade !== null && fade.startMs <= atMs)) {
        leaving = { ...unit, leaving: true };
      } else {
        const clockOfDemo = demoClock(unit.demo, parseInstant);
        const cancelled = unit.arrival.imported !== true && clockOfDemo !== null && atMs < clockOfDemo.touchdownAtMs;
        const ended = endDemoTrajectory(trajectory, { atMs, statusKey: cancelled ? 'cancelledByProvider' : null });
        if (ended === null) return null;
        leaving = {
          ...unit,
          leaving: true,
          arrival: cancelled ? cancelledRow(unit.arrival, atMs) : unit.arrival,
          departure: cancelled ? cancelledRow(unit.departure, atMs) : unit.departure,
          plan: {
            ...unit.plan, key: `${unit.plan.key}|left`, trajectory: ended, state: cancelled ? 'Cancelled' : unit.plan.state,
          },
        };
      }
    }
    return nowMs < leaving.plan.trajectory.endMs ? leaving : null;
  }

  function ingest({ picture = null, flights = null } = {}) {
    if (picture === lastPicture && flights === lastFlights) return;
    const previousFlights = lastFlights ?? null;
    const previousUnits = units;
    lastPicture = picture;
    lastFlights = flights;
    config = trackConfigFor(picture?.refreshAfterSeconds);
    flightsByKey = flights?.byKey ?? new Map((flights?.flights ?? []).map(row => [row.flightKey, row]));
    dataAt = Math.max(picture?.serverTime ?? -Infinity, flights?.serverTime ?? -Infinity);
    if (!finite(dataAt)) dataAt = null;
    const owners = claimFixes({ picture, flights });
    const current = new Set();

    // Every fix of the picture on its aircraft's track, received at the instant the server answered. Also when only the
    // flights changed: a picture read before the flights left the fix of an ELEVANT flight on other traffic's track,
    // and the flight takes it now; a track that has the fix already keeps it as it is (handoff.js: onFix).
    for (const fix of owners.fixes) {
      const { id, flight } = fixIdentity(fix, owners);
      current.add(id);
      tracks.set(id, reduceTrack(trackOf(id, flight ? 'aviam' : 'other'), {
        type: 'fix', fix, atMs: finite(picture?.serverTime) ? picture.serverTime : fix.positionAt,
      }, config));
    }

    // The runway in use for real flights (FINAL_VOTE): the arrivals on final of the newest picture that had any, while
    // they are recent; then a plan for every visit the map draws.
    const onFinal = arrivalsOnFinal(owners.fixes, layout);
    const seenOnFinal = Math.max(...onFinal.map(vote => vote.positionAt));
    if (onFinal.length > 0 && (finalVote === null || seenOnFinal >= finalVote.seenAt)) {
      finalVote = { arrivals: onFinal, seenAt: seenOnFinal };
    }
    const recent = finalVote !== null && dataAt !== null && dataAt - finalVote.seenAt <= FINAL_VOTE.keepMs;
    runway = runwayInUse({ recentLiveArrivals: recent ? finalVote.arrivals : [], wind: null, layout });
    const atMs = finite(flights?.serverTime) ? flights.serverTime : (dataAt ?? 0);
    const next = new Map();
    units = unitsOf(flights, owners.claimed);
    for (const unit of units) {
      const previous = plans.get(unit.id) ?? null;
      if (previous !== null && previous.key === unit.key) {
        unit.plan = previous;
      } else if (unit.kind === 'demo') {
        unit.plan = { key: unit.key, ...demoTrajectory(unit, previous, flights) };
      } else {
        unit.plan = { key: unit.key, trajectory: realTrajectory(unit.row, unit.ctx) };
      }
      next.set(unit.id, unit.plan);
      if (unit.plan !== previous) dispatchPlan(unit, atMs);
      for (const key of keysOf(unit)) current.add(`f:${key}`);
    }
    // A demo visit that left the reads of its station fades out where it is before it is forgotten (leavingDemo).
    if (flights !== null && previousFlights !== null && flights.stationId === previousFlights.stationId) {
      const listed = new Set(units.map(unit => unit.id));
      for (const unit of previousUnits) {
        if (unit.kind !== 'demo' || listed.has(unit.id)) continue;
        const leaving = leavingDemo(unit, atMs, dataAt ?? atMs);
        if (leaving === null) continue;
        units.push(leaving);
        next.set(leaving.id, leaving.plan);
        if (leaving.plan !== unit.plan) dispatchPlan(leaving, atMs);
        for (const key of keysOf(leaving)) current.add(`f:${key}`);
      }
    }
    plans = next;
    // A route's own trajectory goes with its flight's row.
    routePlans = new Map([...routePlans].filter(([key]) => flightsByKey.has(key)));

    // A track nobody draws is kept a while (an aircraft may come back) and then forgotten.
    const now = dataAt ?? 0;
    for (const id of current) seenAt.set(id, now);
    for (const id of [...tracks.keys()]) {
      if (current.has(id)) continue;
      if (now - (seenAt.get(id) ?? now) > FORGET_AFTER_MS) {
        tracks.delete(id);
        seenAt.delete(id);
      }
    }
    lastSample = null;
    listeners.forEach(listener => listener());
  }

  function estimatesAt(tMs) {
    const estimates = [];
    for (const unit of units) {
      if (!unit.estimated || !unit.plan?.trajectory) continue;
      const flightKey = drawnKeyAt(unit, tMs);
      const render = renderTrack(tracks.get(`f:${flightKey}`), tMs, config);
      if (render === null) continue;
      // A demo visit no read lists any more brings the row it is drawn from (leavingDemo).
      const row = unit.leaving === true ? [unit.arrival, unit.departure].find(leg => leg?.flightKey === flightKey) : null;
      estimates.push(Object.freeze({
        flightKey, lon: render.lon, lat: render.lat, altM: render.altM, gsMs: render.gsMs, trackDeg: render.trackDeg,
        vrateMs: render.vrateMs, onGround: render.onGround, positionAt: tMs, statusKey: render.statusKey,
        timeScale: render.timeScale, opacity: render.opacity, mode: render.mode, ...(row ? { flight: row } : {}),
      }));
    }
    return Object.freeze(estimates);
  }

  // A track whose fix aged past its coast gets the trajectory rebuilt from that fix, once, at the instant the coast
  // ended (handoff.js: needsReplan), so every screen blends the same way. The builders keep Decision F-1 with a stopped
  // fix (estimator.js): the row's times and stand say whether it waits or leaves its stand.
  function replanFromFix(id, track, item) {
    const fix = track.lastFix;
    const row = flightsByKey.get(item?.flightKey) ?? null;
    const coastS = fix.onGround ? config.groundCoastMaxAgeS : config.coastMaxAgeS;
    const atMs = Math.max(fix.positionAt + coastS * 1_000, track.plan?.atMs ?? -Infinity);
    let trajectory = null;
    if (row !== null) {
      const ctx = contextOf(row);
      trajectory = realTrajectory(row, ctx, { kind: 'fix', fix });
    }
    const next = reduceTrack(track, { type: 'plan', trajectory, atMs, anchorFixAt: fix.positionAt }, config);
    tracks.set(id, next);
    return next;
  }

  function sampleItem(item, tMs) {
    if (item == null) return null;
    let track = tracks.get(item.id);
    if (!track) return item;
    if (needsReplan(track, tMs, config)) track = replanFromFix(item.id, track, item);
    track = reduceTrack(track, { type: 'tick', tMs }, config);
    tracks.set(item.id, track);
    const render = renderTrack(track, tMs, config);
    if (render === null) return null;
    return {
      sampled: Object.freeze({
        ...item,
        lon: render.lon,
        lat: render.lat,
        altM: render.altM,
        gsMs: render.gsMs,
        trackDeg: render.trackDeg,
        vrateMs: render.vrateMs,
        onGround: render.onGround,
        phase: render.phase ?? item.phase ?? null,
        mode: render.mode,
        quality: render.quality === 'estimated' ? 'estimated' : item.quality,
        ageS: render.ageS ?? item.ageS ?? 0,
        statusKey: render.statusKey,
        opacity: render.opacity,
        timeScale: render.timeScale,
        runwayIdent: runwayIdentOf(track, item),
        runwaySource: runwaySourceOf(track, item),
      }),
      moving: moves(track, render, tMs, config),
    };
  }

  // The runway a flight's plan lands or departs on, and where that choice comes from (the data block says it).
  function runwayIdentOf(track, item) {
    const meta = track.plan?.trajectory?.meta;
    if (!meta || item.kind !== 'aviam') return null;
    return (item.direction === 'Departure' ? meta.departureRunwayIdent : meta.runwayIdent) ?? meta.runwayIdent ?? null;
  }
  function runwaySourceOf(track, item) {
    if (runwayIdentOf(track, item) === null) return null;
    return item.isDemo === true ? 'demo' : runway.source;
  }

  function sample(aircraft, tMs) {
    const list = Array.isArray(aircraft) ? aircraft : [];
    let moving = false;
    const result = list.map(item => {
      const out = sampleItem(item, tMs);
      if (out === null) return null;
      if (out === item) return item;
      moving = moving || out.moving;
      return out.sampled;
    });
    lastSample = { tMs, moving, ids: new Set(list.map(item => item?.id)) };
    return result;
  }

  function sampleOne(id, tMs, aircraft = null) {
    const item = aircraft ?? (tracks.has(id) ? { id } : null);
    const out = sampleItem(item, tMs);
    if (out === null || out === item) return out;
    return out.sampled;
  }

  function isAnimating(tMs) {
    if (lastSample !== null && lastSample.tMs === tMs) return lastSample.moving;
    for (const [id, track] of tracks) {
      if (lastSample !== null && !lastSample.ids.has(id)) continue;
      if (moves(track, renderTrack(track, tMs, config), tMs, config)) return true;
    }
    return false;
  }

  function nextChangeAt(tMs) {
    let next = null;
    const consider = at => {
      if (finite(at) && at > tMs && (next === null || at < next)) next = at;
    };
    for (const unit of units) {
      trajectoryInstants(unit.plan?.trajectory).forEach(consider);
      consider(unit.plan?.offBlockAtMs);
    }
    // An ELEVANT flight's fix losing its signal, then its coast; other traffic changes nothing the situation holds (its
    // frames carry it on and fade it out), so its fixes add no instant.
    for (const track of tracks.values()) {
      const fix = track.lastFix;
      if (!fix || track.kind !== 'aviam') continue;
      consider(fix.positionAt + config.liveMaxAgeS * 1_000 + 1);
      consider(fix.positionAt + (fix.onGround ? config.groundCoastMaxAgeS : config.coastMaxAgeS) * 1_000 + 1);
    }
    return next;
  }

  function trajectoryOf(flightKey) {
    const fromTrack = tracks.get(`f:${flightKey}`)?.plan?.trajectory ?? null;
    if (fromTrack) return fromTrack;
    const unit = units.find(candidate => keysOf(candidate).includes(flightKey));
    return unit?.plan?.trajectory ?? null;
  }

  // A departure's trajectory for its route alone: from its stand (or apron hold) at its push-back, else its planned
  // off-block, without any rule of when it may be drawn leaving.
  function routeDeparture(row, ctx) {
    const times = flightTimesFromRow(row, parseInstant);
    const offBlockMs = [times.pushbackAtMs, times.estimatedAtMs, times.scheduledAtMs].find(finite) ?? null;
    if (offBlockMs === null) return null;
    const stand = standOfCode(layout, row?.stand?.code);
    return build.buildDepartureTrajectory({
      times: { offBlockMs, takeoffMs: times.actualKind === 'Runway' ? times.actualAtMs : null },
      destination: pointOf(row.counterpart), layout, runwayEnd: runwayEnd(layout, ctx.runway.departure), stand,
      apronHold: stand ? null : ctx.apronHold, perf: ctx.perf, activeRunwayIds: runwayIdsInUse(layout, ctx.runway),
    });
  }

  // What the store plans now for a flight it draws: its track's plan (rebuilt from its last fix once that aged) unless
  // that only holds it where a stopped fix left it, else its visit's; `null` for a flight no visit of the last read
  // draws, and for a demo visit that left the reads and fades out (leavingDemo).
  function plannedFor(flightKey) {
    const unit = units.find(candidate => keysOf(candidate).includes(flightKey));
    if (!unit || unit.leaving === true) return null;
    const tracked = tracks.get(`f:${flightKey}`)?.plan?.trajectory ?? null;
    if (tracked !== null && !holdsStill(tracked)) return tracked;
    return unit.plan?.trajectory ?? null;
  }

  function trajectoryForRoute(row) {
    const key = row?.flightKey ?? null;
    if (key === null || row.phase === 'cancelled' || row.phase === 'diverted') return null;
    const planned = plannedFor(key);
    if (planned || row.isDemo === true) return planned;
    const ctx = contextOf(row);
    const inputs = planInputsKey(row, { ...ctx, perfCategory: ctx.perf.category });
    const cached = routePlans.get(key);
    if (cached?.key === inputs) return cached.trajectory;
    const trajectory = row.direction === 'Departure' ? routeDeparture(row, ctx) : realTrajectory(row, ctx);
    routePlans.set(key, { key: inputs, trajectory });
    return trajectory;
  }

  function followTargets(flightKey) {
    const trajectory = trajectoryOf(flightKey);
    const row = flightsByKey.get(flightKey) ?? null;
    const meta = trajectory?.meta ?? null;
    const ident = row?.direction === 'Departure' ? (meta?.departureRunwayIdent ?? meta?.runwayIdent) : meta?.runwayIdent;
    const end = ident ? runwayEnd(layout, ident) : null;
    const stand = standOfCode(layout, meta?.standCode ?? row?.stand?.code);
    const hold = (layout?.apronHolds ?? []).find(item => item.id === meta?.apronHoldId) ?? null;
    return Object.freeze({
      airport: arp ? [arp[0], arp[1]] : null,
      threshold: end ? [end.threshold[0], end.threshold[1]] : null,
      stand: stand ? [stand.center[0], stand.center[1]] : null,
      apronHold: hold ? [hold.p[0], hold.p[1]] : null,
    });
  }

  return Object.freeze({
    clock,
    ingest,
    estimatesAt,
    sample,
    sampleOne,
    isAnimating,
    nextChangeAt,
    trajectoryOf,
    trajectoryForRoute,
    followTargets,
    runway: () => runway,
    dataAt: () => dataAt,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}
