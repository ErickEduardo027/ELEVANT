import {
  destinationPoint, greatCirclePath, haversineM, initialBearing, measurePolyline, slicePolyline,
} from '../airport/geo.js';
import { centrelineBetween } from '../airport/runwayInUse.js';
import { nearestNode } from '../airport/taxiGraph.js';
import { cutLeg, fitLegs, legDurationS, moveLeg, speedAt, timeToDistanceS, waitLeg } from './legs.js';
import { GATE_NM, HOLD_LEG_S, arrivalAirPath, climbPath, holdingPatternPath, takeoffPath } from './pathBuilder.js';
import { graphFor, routeFromApronHold, routeFromPoint, routeStandToHold } from './taxiRoute.js';
import { NM, degToRad, ftToM, normalizeDeg } from './units.js';

// The legs of each part of a flight (PR M6, design F2 as adjusted by contracts 2.3), built from the geometry of
// pathBuilder.js and taxiRoute.js and the numbers of perfProfiles.js: the arrival in the air from the counterpart
// airport to the touchdown point (cut to a demo flight's time, with a holding pattern over the approach gate when the
// whole of it is shorter), the landing roll and the taxi to a stand or an apron hold, the pushback and the taxi
// to the runway, the take-off roll and the climb. A ground path is driven with a speed profile: each 5 m segment has
// a target speed by what it is (straight, turn, apron, docking), and the speed ramps between targets at the taxi
// acceleration and braking. Nothing here is timed: estimator.js and demoProfile.js fit these legs to their instants.
// SI units, degrees true, `[lng, lat]`. Pure: explicit '.js' imports, no clock, no JSON.

/** The last metres of a lead-in are taxied at the docking speed; the rest of a long lead-in at the apron speed. */
export const DOCK_M = 40;
/** Over the first metres after a stop the heading turns from where the nose pointed to the path's direction. */
export const START_BLEND_M = 20;
/** The cruise slows to the descent speed over the last 10 NM before the top of descent. */
export const CRUISE_DECEL_M = 10 * NM;
/** A demo flight starts at least this far out along its arrival path (contracts 2.3: 5 NM minimum). */
export const MIN_START_M = 5 * NM;

const shortArc = (from, to) => ((to - from + 540) % 360) - 180;

/**
 * Legs between breakpoints `{ along, speed, alt, phase }` of a measured line: each with the breakpoints' acceleration
 * over its whole span, cut to the part of it on the line (a short sector begins before its first breakpoint, a climb
 * may end before its last).
 */
function legsBetween(line, points, { onGround = false, part }) {
  const legs = [];
  for (let at = 1; at < points.length; at += 1) {
    const start = points[at - 1];
    const end = points[at];
    const span = end.along - start.along;
    const from = Math.max(0, start.along);
    const to = Math.min(line.lengthM, end.along);
    if (!(span > 0) || !(to > from + 1e-6)) continue;
    const shape = { kind: 'move', v0: start.speed, v1: end.speed, lengthM: span };
    const altAt = along => start.alt + ((end.alt - start.alt) * (along - start.along)) / span;
    legs.push(moveLeg({
      phase: end.phase, path: slicePolyline(line, from, to), v0: speedAt(shape, from - start.along),
      v1: speedAt(shape, to - start.along), alt0: altAt(from), alt1: altAt(to), onGround, part,
    }));
  }
  return legs;
}

/**
 * The arrival in the air at its own speeds, from `origin` (`[lng, lat]`, or `null`: 40 NM out on the extended
 * centreline) to the touchdown point: `{ legs, line, entryAlongM, thresholdAlongM, gateAlongM, touchdownAlongM, mode }`,
 * frozen (distances along `line`).
 * En route at the cruise level and speed (lower for a short sector: the descent at 3 NM per 1 000 ft starts in its
 * second half at the latest), slowing to the descent speed over the last 10 NM before the top of descent, down to FL100
 * and on to the approach entry at the descent speeds, level through the approach at the approach speed, the 3° final
 * to 50 ft over the threshold at the reference speed, and the flare to the touchdown point 300 m beyond it.
 * With `start` (`{ altM, speedMs }`, a live fix at `origin`) the aircraft flies on at the fix's speed and descends
 * from the fix's height, never climbing (the gate is never above the fix); one already on final (within 2 NM of the
 * extended centreline, at most 12 NM out and heading for the threshold) flies straight to the threshold.
 */
export function arrivalAirLegs({ origin = null, runwayEnd, perf, start = null }) {
  if (start !== null && origin !== null && isOnFinal(origin, runwayEnd)) return finalFrom(origin, runwayEnd, perf, start);
  const air = arrivalAirPath({ origin, runwayEnd, speedMs: perf.approach.speedMs });
  const flare = centrelineBetween(runwayEnd, 0, perf.landing.touchdownAlongM);
  const line = measurePolyline([...air.coords, ...flare.slice(1)]);
  const elevation = ftToM(runwayEnd.elevationFt);
  const thresholdAlt = elevation + perf.final.thresholdCrossM;
  const startAlt = Number.isFinite(start?.altM) ? start.altM : null;
  const glideGate = thresholdAlt + (air.thresholdAlongM - air.gateAlongM) * Math.tan(degToRad(perf.final.glideDeg));
  const gateAlt = startAlt === null ? glideGate : Math.max(thresholdAlt, Math.min(glideGate, startAlt));
  const ratio = perf.descent.ratio;
  const entry = air.entryAlongM;
  const transition = perf.descent.transitionAltM;
  const cruiseAlt = startAlt !== null ? Math.max(gateAlt, startAlt)
    : Math.max(gateAlt, Math.min(perf.cruise.altM, gateAlt + entry / (2 * ratio)));
  let fl100 = null;
  let tod = entry;
  let todSpeed = perf.descent.lowSpeedMs;
  if (cruiseAlt > transition && transition > gateAlt) {
    fl100 = entry - (transition - gateAlt) * ratio;
    tod = fl100 - (cruiseAlt - transition) * ratio;
    todSpeed = perf.descent.highSpeedMs;
  } else if (cruiseAlt > gateAlt) {
    tod = entry - (cruiseAlt - gateAlt) * ratio;
    todSpeed = cruiseAlt > transition ? perf.descent.highSpeedMs : perf.descent.lowSpeedMs;
  }
  const cruise = Number.isFinite(start?.speedMs) && start.speedMs > 0 ? start.speedMs : perf.cruise.speedMs;
  const points = [
    { along: Math.min(0, tod - CRUISE_DECEL_M), speed: cruise, alt: cruiseAlt, phase: 'enroute' },
    { along: tod - CRUISE_DECEL_M, speed: cruise, alt: cruiseAlt, phase: 'enroute' },
    { along: tod, speed: todSpeed, alt: cruiseAlt, phase: 'enroute' },
    ...(fl100 === null ? [] : [{ along: fl100, speed: perf.descent.lowSpeedMs, alt: transition, phase: 'descent' }]),
    { along: entry, speed: perf.approach.speedMs, alt: gateAlt, phase: 'descent' },
    { along: air.gateAlongM, speed: perf.final.startSpeedMs, alt: gateAlt, phase: 'approach' },
    { along: air.thresholdAlongM, speed: perf.final.vrefMs, alt: thresholdAlt, phase: 'final' },
    { along: line.lengthM, speed: perf.final.vrefMs, alt: elevation, phase: 'final' },
  ];
  const legs = legsBetween(line, points, { part: 'air' });
  // A fix's own height and speed, exactly, where the legs begin.
  if (start !== null && legs.length > 0) {
    legs[0] = moveLeg({ ...legs[0], v0: cruise, alt0: startAlt ?? legs[0].alt0 });
  }
  return Object.freeze({
    legs: Object.freeze(legs),
    line,
    entryAlongM: entry,
    thresholdAlongM: air.thresholdAlongM,
    gateAlongM: air.gateAlongM,
    touchdownAlongM: line.lengthM,
    mode: air.mode,
  });
}

/** Whether a point is on final to a runway end: at most 12 NM out, within 2 NM of the centreline, heading for it. */
function isOnFinal(point, runwayEnd) {
  const toThreshold = initialBearing(point, runwayEnd.threshold);
  const distance = haversineM(point, runwayEnd.threshold);
  const off = Math.abs(((toThreshold - runwayEnd.headingTrue + 540) % 360) - 180);
  const lateral = distance * Math.sin(degToRad(off));
  return distance <= (GATE_NM + 2) * NM && distance > 300 && off <= 30 && lateral <= 2 * NM;
}

/** Straight from a fix on final to the threshold and the touchdown point, descending from the fix's height. */
function finalFrom(origin, runwayEnd, perf, start) {
  const flare = centrelineBetween(runwayEnd, 0, perf.landing.touchdownAlongM);
  const line = measurePolyline([origin, ...flare]);
  const elevation = ftToM(runwayEnd.elevationFt);
  const thresholdAlt = elevation + perf.final.thresholdCrossM;
  const thresholdAlong = line.cumM[1];
  const glide = thresholdAlt + thresholdAlong * Math.tan(degToRad(perf.final.glideDeg));
  const alt = Number.isFinite(start.altM) ? Math.max(thresholdAlt, start.altM) : glide;
  const speed = Number.isFinite(start.speedMs) && start.speedMs > 0 ? start.speedMs : perf.final.startSpeedMs;
  const points = [
    { along: 0, speed, alt, phase: 'final' },
    { along: thresholdAlong, speed: perf.final.vrefMs, alt: thresholdAlt, phase: 'final' },
    { along: line.lengthM, speed: perf.final.vrefMs, alt: elevation, phase: 'final' },
  ];
  return Object.freeze({
    legs: Object.freeze(legsBetween(line, points, { part: 'air' })),
    line,
    entryAlongM: 0,
    thresholdAlongM: thresholdAlong,
    gateAlongM: 0,
    touchdownAlongM: line.lengthM,
    mode: 'final',
  });
}

/** The metres from the start of the line at which each leg begins. */
function legStarts(legs) {
  const starts = [];
  let along = 0;
  for (const leg of legs) {
    starts.push(along);
    along += leg.lengthM;
  }
  return starts;
}

/**
 * The metres along an arrival's line from which its legs last `seconds` to the touchdown at their own speeds, or `null`
 * when the whole line lasts less.
 */
function startFor(legs, starts, seconds) {
  let remaining = seconds;
  for (let at = legs.length - 1; at >= 0; at -= 1) {
    const leg = legs[at];
    const duration = legDurationS(leg);
    if (remaining <= duration) {
      // The distance s into this leg from which the rest of it lasts `remaining`.
      let low = 0;
      let high = leg.lengthM;
      for (let step = 0; step < 80; step += 1) {
        const middle = (low + high) / 2;
        if (duration - timeToDistanceS(leg, middle) > remaining) low = middle;
        else high = middle;
      }
      return starts[at] + (low + high) / 2;
    }
    remaining -= duration;
  }
  return null;
}

// A leg ends at the gate when it ends within this of it; a hold's length is solved to within HOLD_MATCH_M; a hold
// lasting more than the time over by HOLD_OVER_S or less is taken as lasting exactly that.
const GATE_MATCH_M = 0.01;
const HOLD_MATCH_M = 1e-7;
const HOLD_OVER_S = 1e-6;

/**
 * Where an arrival's legs pass the approach gate, to hold over it: `{ index, fix, inboundDeg, speedMs, altM, afterS }`
 * (the leg that ends there, the gate, the course the final leaves it on, the speed and height the aircraft has there
 * and the seconds from it to the touchdown), or `null` when no leg ends at the gate before another one.
 */
function gateOf(air, legs, starts) {
  for (let at = 0; at < legs.length - 1; at += 1) {
    const leg = legs[at];
    if (Math.abs(starts[at] + leg.lengthM - air.gateAlongM) > GATE_MATCH_M) continue;
    const next = legs[at + 1];
    if (!(leg.v1 > 0) || next.path.coords.length < 2) return null;
    return {
      index: at,
      fix: leg.path.coords[leg.path.coords.length - 1],
      inboundDeg: initialBearing(next.path.coords[0], next.path.coords[1]),
      speedMs: leg.v1,
      altM: leg.alt1,
      afterS: legs.slice(at + 1).reduce((sum, item) => sum + legDurationS(item), 0),
    };
  }
  return null;
}

/**
 * The holding pattern over the gate that takes up `spareS` at the gate's speed (pathBuilder.js: holdingPatternPath):
 * as many standard laps (two one-minute legs each) as fit best, with the leg length that makes its measured length
 * last exactly `spareS`; or one circle when `spareS` is less than a circle lasts (it then lasts longer). `{ path, laps,
 * legM, durationS }`.
 */
function holdOver(gate, spareS) {
  const { fix, inboundDeg, speedMs } = gate;
  const build = (legM, laps) => holdingPatternPath({ fix, inboundDeg, speedMs, legM, laps });
  const circle = build(0, 1);
  const circleS = circle.lengthM / speedMs;
  if (!(spareS > circleS)) return { path: circle, laps: 1, legM: 0, durationS: circleS };
  const laps = Math.max(1, Math.round(spareS / (circleS + 2 * HOLD_LEG_S)));
  const wantedM = spareS * speedMs;
  const missM = legM => build(legM, laps).lengthM - wantedM;
  // The measured length grows with the legs almost linearly: a few secant steps make it exact.
  let a = Math.max(0, (wantedM / laps - circle.lengthM) / 2);
  let fa = missM(a);
  let b = a + 1;
  let fb = missM(b);
  for (let step = 0; step < 30 && Math.abs(fb) > HOLD_MATCH_M && fb !== fa; step += 1) {
    const next = Math.max(0, b - (fb * (b - a)) / (fb - fa));
    a = b;
    fa = fb;
    b = next;
    fb = missM(b);
  }
  const path = build(b, laps);
  return { path, laps, legM: b, durationS: path.lengthM / speedMs };
}

/**
 * The air legs cut to last `airMs` at their own speeds, as contracts 2.3 asks of a demo flight: walking back from the
 * touchdown, the aircraft starts where the time runs out. `{ legs, startAlongM, originPath, limit, hold }`, frozen:
 * `originPath` is the arrival path from the origin to the start point (flown, estimated).
 * - `limit` 'minimum': the start was held `minStartM` (5 NM) out along the path, so the legs last longer than `airMs`.
 * - `limit` 'origin': the whole path from the origin is shorter in time. The time over is flown at real speed in a
 *   holding pattern over the approach gate, at the speed and height the aircraft has there (`hold`: `{ laps, legM,
 *   lengthM, durationS, fix, inboundDeg, speedMs, altM, radiusM }`), and the aircraft starts at the origin, or on its
 *   path a little after it when the time over is less than one circle of the hold lasts. Without a gate to hold over,
 *   or with the start less than one circle before it, the legs are the whole path and last less than `airMs`.
 * - Otherwise `limit` and `hold` are `null`.
 */
export function backOutAir(air, airMs, { minStartM = MIN_START_M } = {}) {
  const legs = air.legs;
  const starts = legStarts(legs);
  const target = Math.max(0, airMs) / 1000;
  const limitAlong = Math.max(0, air.thresholdAlongM - minStartM);
  const totalS = legs.reduce((sum, leg) => sum + legDurationS(leg), 0);
  const gate = target > totalS ? gateOf(air, legs, starts) : null;
  let hold = gate === null ? null : holdOver(gate, target - totalS);
  // A circle that lasts longer than the time over moves the start on along the path; it must still be before the gate.
  if (hold !== null && target - hold.durationS <= gate.afterS + HOLD_OVER_S) hold = null;
  let startAlong = 0;
  let limit = null;
  if (hold !== null) {
    limit = 'origin';
    if (hold.durationS > target - totalS + HOLD_OVER_S) startAlong = startFor(legs, starts, target - hold.durationS) ?? 0;
  } else {
    const found = startFor(legs, starts, target);
    if (found === null) limit = 'origin';
    else startAlong = found;
  }
  if (startAlong > limitAlong) {
    startAlong = limitAlong;
    limit = 'minimum';
  }
  const cut = [];
  legs.forEach((leg, at) => {
    const end = starts[at] + leg.lengthM;
    if (end > startAlong + 1e-6) cut.push(starts[at] >= startAlong - 1e-6 ? leg : cutLeg(leg, startAlong - starts[at], leg.lengthM));
    if (hold !== null && at === gate.index) {
      cut.push(moveLeg({
        phase: leg.phase, path: hold.path.coords, v0: gate.speedMs, v1: gate.speedMs, alt0: gate.altM, alt1: gate.altM,
        part: leg.part,
      }));
    }
  });
  return Object.freeze({
    legs: Object.freeze(cut),
    startAlongM: startAlong,
    originPath: slicePolyline(air.line, 0, startAlong),
    limit,
    hold: hold === null ? null : Object.freeze({
      laps: hold.laps,
      legM: hold.legM,
      lengthM: hold.path.lengthM,
      durationS: hold.durationS,
      fix: gate.fix,
      inboundDeg: gate.inboundDeg,
      speedMs: gate.speedMs,
      altM: gate.altM,
      radiusM: hold.path.radiusM,
    }),
  });
}

/**
 * Legs along a sampled ground path (a TaxiPath) from sample `from` to its end, driven with a speed profile: segment j
 * (samples j → j+1) has the target `speedOf(j)`; the speed ramps up at `accelMs2` and down at `decelMs2`, starts at
 * `startSpeed` (the first segment's target when `null`) and ends at `endSpeed`; each sample index in `stops` is a stop
 * followed by `waitAt(index)`. Each constant run is one leg, each 5 m of a ramp another. Headings follow the path's
 * exact tangents (reversed for 'reverse'), turned smoothly from `startHeadingDeg` over START_BLEND_M and into
 * `endHeadingDeg` over DOCK_M when given. `{ legs, speeds }`: the speed profile at every sample.
 */
export function profileLegs(path, {
  from = 0, startSpeed = null, endSpeed = 0, speedOf, accelMs2, decelMs2, phase, part, speedRange, heading = 'tangent',
  stops = [], waitAt = () => null, startHeadingDeg = null, endHeadingDeg = null, adjustable = true, groundAltM = 0,
}) {
  const coords = path.coords;
  const along = path.alongM;
  const last = coords.length - 1;
  if (last <= from) return { legs: [], speeds: [] };
  const target = [];
  for (let at = from; at < last; at += 1) target[at] = speedOf(at);
  const speeds = new Array(last + 1).fill(0);
  for (let at = from; at <= last; at += 1) {
    speeds[at] = Math.min(at > from ? target[at - 1] : Infinity, at < last ? target[at] : Infinity);
  }
  speeds[from] = startSpeed ?? target[from];
  speeds[last] = Math.min(speeds[last], endSpeed);
  const stopSet = new Set(stops.filter(index => index > from && index < last));
  for (const index of stopSet) speeds[index] = 0;
  const limits = [...speeds];
  for (let at = from + 1; at <= last; at += 1) {
    speeds[at] = Math.min(limits[at], Math.sqrt(speeds[at - 1] ** 2 + 2 * accelMs2 * (along[at] - along[at - 1])));
  }
  for (let at = last - 1; at >= from; at -= 1) {
    speeds[at] = Math.min(speeds[at], Math.sqrt(speeds[at + 1] ** 2 + 2 * decelMs2 * (along[at + 1] - along[at])));
  }
  if (startSpeed !== null) speeds[from] = startSpeed;

  // Exact tangents (a pushback's are stored as its direction of travel), blended at the ends.
  const flip = heading === 'reverse' ? 180 : 0;
  const tangents = path.headingsDeg.map(value => (value === null ? null : normalizeDeg(value - flip)));
  if (startHeadingDeg !== null && tangents[from] !== null) {
    const offset = shortArc(tangents[from], normalizeDeg(startHeadingDeg - flip));
    for (let at = from; at <= last && along[at] - along[from] < START_BLEND_M; at += 1) {
      if (tangents[at] === null) continue;
      const weight = 1 - (along[at] - along[from]) / START_BLEND_M;
      tangents[at] = normalizeDeg(tangents[at] + offset * weight);
    }
  }
  if (endHeadingDeg !== null && tangents[last] !== null) {
    const offset = shortArc(tangents[last], normalizeDeg(endHeadingDeg - flip));
    for (let at = last; at >= from && along[last] - along[at] < DOCK_M; at -= 1) {
      if (tangents[at] === null) continue;
      const weight = 1 - (along[last] - along[at]) / DOCK_M;
      tangents[at] = normalizeDeg(tangents[at] + offset * weight);
    }
  }

  const bounds = [from];
  for (let at = from + 1; at < last; at += 1) {
    if (stopSet.has(at) || speeds[at - 1] !== speeds[at] || speeds[at] !== speeds[at + 1]) bounds.push(at);
  }
  bounds.push(last);
  const legs = [];
  for (let at = 1; at < bounds.length; at += 1) {
    const [a, b] = [bounds[at - 1], bounds[at]];
    let [v0, v1] = [speeds[a], speeds[b]];
    if (v0 + v1 <= 0) v1 = target[a] ?? speedOf(a);
    legs.push(moveLeg({
      phase, path: coords.slice(a, b + 1), v0, v1, alt0: groundAltM, heading, onGround: true, adjustable, speedRange,
      fixedV0: a === from && startSpeed !== null, tangentsDeg: tangents.slice(a, b + 1), part,
    }));
    if (stopSet.has(b)) {
      const wait = waitAt(b);
      if (wait) legs.push(wait);
    }
  }
  return { legs, speeds };
}

/** The target speed of a taxi segment: turn, apron (a lead-in beyond its docking metres), docking or straight. */
function taxiSpeedOf(path, perf, { docking }) {
  const { straightMs, turnMs, leadInMs } = perf.taxi;
  const length = path.lengthM;
  return at => {
    if (path.turning[at] || path.turning[at + 1]) return turnMs;
    const leadIn = path.kinds[at + 1] === 'leadin' || path.kinds[at] === 'leadin';
    if (leadIn) return docking && length - path.alongM[at] <= DOCK_M ? leadInMs : turnMs;
    return straightMs;
  };
}

/** The first sample past the landing roll: off the centreline, or where the turn-off begins. */
function turnOffIndex(path) {
  for (let at = 1; at < path.coords.length; at += 1) {
    if (path.kinds[at] !== 'runway' || path.turning[at]) return at;
  }
  return path.coords.length - 1;
}

/**
 * The landing roll from the touchdown point to the turn-off of a landing TaxiPath (taxiRoute.js: routeLandingTaxi),
 * at the reference speed slowing to `turnOffSpeed`: one leg at the deceleration that takes, or, for an exit farther
 * than the lightest braking reaches, braking at the nominal rate down to the exit speed and rolling on. The roll's end
 * speed is the taxi's first speed, so a fit scales both alike. `null` when the exit needs harder braking than the
 * profile's maximum.
 */
function rollLegs(path, turnOff, turnOffSpeed, perf, groundAltM) {
  const vref = perf.final.vrefMs;
  const { brakingMs2, brakingMinMs2, brakingMaxMs2, exitSpeedMs } = perf.landing;
  const length = path.alongM[turnOff];
  const range = [perf.taxi.minMs, perf.taxi.maxMs];
  if (!(length > 0)) return [];
  const needed = (vref * vref - turnOffSpeed * turnOffSpeed) / (2 * length);
  if (needed > brakingMaxMs2 + 1e-9) return null;
  const leg = (a, b, v0, v1, adjustableEnd) => moveLeg({
    phase: 'landing', path: path.coords.slice(a, b + 1), v0, v1, alt0: groundAltM, onGround: true, adjustable: adjustableEnd,
    speedRange: range, fixedV0: true, tangentsDeg: path.headingsDeg.slice(a, b + 1), part: 'taxiIn',
  });
  if (needed >= brakingMinMs2 || turnOff < 2) return [leg(0, turnOff, vref, turnOffSpeed, true)];
  // A far exit: braking at the nominal rate down to the exit speed, then rolling on to the turn-off.
  const braking = (vref * vref - exitSpeedMs * exitSpeedMs) / (2 * brakingMs2);
  let split = 1;
  while (split < turnOff - 1 && path.alongM[split + 1] <= braking) split += 1;
  const atSplit = speedAt({ kind: 'move', v0: vref, v1: exitSpeedMs, lengthM: braking }, path.alongM[split]);
  return [leg(0, split, vref, atSplit, false), leg(split, turnOff, atSplit, turnOffSpeed, true)];
}

/**
 * The legs of a ground path: `{ legs, turnOffIndex }`, or `null` when a landing's exit cannot be reached with the
 * profile's braking. A landing (`landing`, a TaxiPath of routeLandingTaxi) starts at the touchdown point: the roll in
 * phase 'landing' to the turn-off, then the taxi; otherwise the taxi starts at the path's first point at
 * `startSpeed` with the nose turning from `startHeadingDeg` (an aircraft given a stand mid-taxi, or a live fix on the
 * ground). The taxi is phase `phase` ('taxiIn'), all of part 'taxiIn'. To a stand it docks onto `standHeadingDeg` and
 * stops at the centre; with `holdBeforeLeadIn` it also stops where the lead-in begins and waits there as long as a fit
 * needs (a wait without upper bound). To an apron hold it stops at the hold and waits there in phase 'holding' with
 * `statusKey`, as long as a fit needs.
 */
export function groundLegs(path, {
  perf, landing = true, startSpeed = 0, startHeadingDeg = null, toStand = true, standHeadingDeg = null,
  holdBeforeLeadIn = false, statusKey = null, phase = 'taxiIn', groundAltM = 0,
}) {
  if (!path || path.coords.length < 2) return null;
  const from = landing ? turnOffIndex(path) : 0;
  const last = path.coords.length - 1;
  const leadInStart = toStand ? path.kinds.findIndex((kind, at) => at > from && kind === 'leadin') : -1;
  const holdIndex = holdBeforeLeadIn && leadInStart > from + 1 && leadInStart < last ? leadInStart - 1 : -1;
  const taxi = profileLegs(path, {
    from,
    startSpeed: landing ? null : Math.max(0, startSpeed ?? 0),
    speedOf: taxiSpeedOf(path, perf, { docking: toStand }),
    accelMs2: perf.taxi.accelMs2,
    decelMs2: perf.taxi.decelMs2,
    phase,
    part: 'taxiIn',
    speedRange: [perf.taxi.minMs, perf.taxi.maxMs],
    stops: holdIndex > 0 ? [holdIndex] : [],
    waitAt: index => waitLeg({
      phase, point: path.coords[index], nominalS: 0, durationRange: [0, Infinity],
      heading: path.headingsDeg[index] ?? 0, alt: groundAltM, part: 'taxiIn',
    }),
    startHeadingDeg: landing ? null : startHeadingDeg,
    endHeadingDeg: toStand ? standHeadingDeg : null,
    groundAltM,
  });
  const roll = landing ? rollLegs(path, from, taxi.speeds[from] ?? perf.taxi.straightMs, perf, groundAltM) : [];
  if (roll === null) return null;
  const legs = [...roll, ...taxi.legs];
  if (!toStand && legs.length > 0) {
    const end = legs[legs.length - 1];
    legs.push(waitLeg({
      phase: 'holding', point: path.coords[last], nominalS: 0, durationRange: [0, Infinity],
      heading: end.tangentsDeg?.[end.tangentsDeg.length - 1] ?? path.headingsDeg[last] ?? 0, alt: groundAltM, part: 'taxiIn',
      statusKey,
    }));
  }
  return Object.freeze({ legs: Object.freeze(legs), turnOffIndex: from });
}

const nominalS = legs => legs.reduce((sum, leg) => sum + legDurationS(leg), 0);

/**
 * A ground path's legs (groundLegs) fitted to last `requiredMs` (fitLegs): the taxi speeds scale between 5 and 25 kt;
 * to a stand the time left over goes to a wait before the lead-in while the aircraft taxis at its nominal speeds, and
 * when that stop leaves no time over the taxi slows instead; to an apron hold the time left over is spent at the hold.
 * `{ legs, factor, timeScale, feasible, turnOffIndex }`, or `null` when the exit is out of reach. Without `compress`
 * an impossible fit keeps the fastest legs' own time (estimator.js: real flights are never sped up).
 */
export function fitGround(path, requiredMs, options) {
  const compress = options.compress ?? true;
  const plain = groundLegs(path, { ...options, holdBeforeLeadIn: false });
  if (plain === null) return null;
  if (options.toStand !== false && nominalS(plain.legs) * 1000 < requiredMs) {
    const held = groundLegs(path, { ...options, holdBeforeLeadIn: true });
    if (held !== null && held.legs.length > plain.legs.length && nominalS(held.legs) * 1000 <= requiredMs) {
      return Object.freeze({ ...fitLegs(held.legs, requiredMs, { compress }), turnOffIndex: held.turnOffIndex });
    }
  }
  return Object.freeze({ ...fitLegs(plain.legs, requiredMs, { compress }), turnOffIndex: plain.turnOffIndex });
}

/**
 * The departure on the ground from a stand (pushback, engine start, taxi), from an apron hold (taxi) or from a point
 * (`fromPoint`: `{ point, headingDeg, speedMs }`, a live fix on the ground: taxi), then the hold short of the runway,
 * the line-up and the take-off roll to the lift-off: `{ legs, liftoff, liftoffAlongM, holdingPoint, pushbackEnd,
 * rollFits }`, frozen, or `null` without a route. All of part 'taxiOut' at the runway's elevation; the pushback is
 * phase 'pushback' (its engine start too), the taxi, the hold and the line-up 'taxiOut', the roll 'takeoff'. With
 * `demo` the engine start is left out and the hold short of the runway is a wait without upper bound that takes the
 * time over (contracts 2.3: no engine start or hold in the demo); otherwise the engine start lasts 60 s and the hold
 * 20 s, both compressible to nothing, and the hold takes the time over. `startHeadingDeg` is where the nose points at
 * an apron hold. `holdingPointId` names the holding point to taxi to (an intersection, taxiRoute.js:
 * departureHoldingPoints); without it the one that leaves the full length. `rollFits` says whether the runway left
 * after the line-up holds the whole take-off roll (the roll is drawn to the runway's end at most).
 */
export function departureGroundLegs({
  layout, runwayEnd, stand = null, apronHold = null, fromPoint = null, perf, activeRunwayIds = [], demo = false,
  startHeadingDeg = null, holdingPointId = null,
}) {
  if (!runwayEnd) return null;
  let route = null;
  let startSpeed = 0;
  let heading = startHeadingDeg;
  if (fromPoint !== null) {
    // The holding point and the line-up the nearest node would get, and the taxi from where the aircraft is.
    const near = nearestNode(graphFor(layout), fromPoint.point);
    const fromNear = near && routeFromApronHold(layout, {
      apronHold: { id: 'fix', node: near.node.id, p: near.node.p }, departureEnd: runwayEnd, activeRunwayIds,
    });
    const taxi = fromNear && routeFromPoint(layout, {
      point: fromPoint.point, headingDeg: fromPoint.headingDeg, toNodeId: fromNear.holdingPoint.node, activeRunwayIds,
    });
    route = taxi ? { pushback: null, taxi, holdingPoint: fromNear.holdingPoint, lineUp: fromNear.lineUp } : null;
    startSpeed = Math.max(0, Math.min(perf.taxi.maxMs, fromPoint.speedMs ?? 0));
    heading = fromPoint.headingDeg ?? null;
  } else {
    route = stand
      ? routeStandToHold(layout, { stand, departureEnd: runwayEnd, activeRunwayIds, holdingPointId })
      : routeFromApronHold(layout, { apronHold, departureEnd: runwayEnd, activeRunwayIds, holdingPointId });
  }
  if (!route || !route.taxi || !route.lineUp) return null;
  const groundAltM = ftToM(runwayEnd.elevationFt);
  const taxiRange = [perf.taxi.minMs, perf.taxi.maxMs];
  const legs = [];
  let pushbackEnd = null;
  if (route.pushback) {
    const push = route.pushback;
    const pushback = profileLegs(push, {
      from: 0, startSpeed: 0, speedOf: () => perf.pushback.speedMs, accelMs2: perf.pushback.accelMs2,
      decelMs2: perf.pushback.accelMs2, phase: 'pushback', part: 'taxiOut', heading: 'reverse',
      speedRange: [perf.pushback.minSpeedMs, perf.pushback.maxSpeedMs], groundAltM,
    });
    legs.push(...pushback.legs);
    pushbackEnd = push.coords[push.coords.length - 1];
    if (!demo) {
      legs.push(waitLeg({
        phase: 'pushback', point: pushbackEnd, nominalS: perf.pushback.engineStartS,
        durationRange: [0, perf.pushback.engineStartS], heading: push.headingsDeg[push.headingsDeg.length - 1] ?? 0,
        alt: groundAltM, part: 'taxiOut',
      }));
    }
  }
  const taxi = profileLegs(route.taxi, {
    from: 0, startSpeed, speedOf: taxiSpeedOf(route.taxi, perf, { docking: false }), accelMs2: perf.taxi.accelMs2,
    decelMs2: perf.taxi.decelMs2, phase: 'taxiOut', part: 'taxiOut', speedRange: taxiRange,
    startHeadingDeg: route.pushback ? null : heading, groundAltM,
  });
  legs.push(...taxi.legs);
  const hold = route.holdingPoint;
  legs.push(waitLeg({
    phase: 'taxiOut', point: route.taxi.coords[route.taxi.coords.length - 1], nominalS: demo ? 0 : perf.takeoff.holdShortS,
    durationRange: [0, Infinity], heading: route.taxi.headingsDeg[route.taxi.headingsDeg.length - 1] ?? 0,
    alt: groundAltM, part: 'taxiOut',
  }));
  const lineUpSpeed = perf.takeoff.lineUpMs;
  const lineUp = profileLegs(route.lineUp, {
    from: 0, startSpeed: 0, endSpeed: lineUpSpeed, speedOf: () => lineUpSpeed, accelMs2: perf.taxi.accelMs2,
    decelMs2: perf.taxi.decelMs2, phase: 'taxiOut', part: 'taxiOut', speedRange: taxiRange, groundAltM,
  });
  legs.push(...lineUp.legs);
  const rollStart = lineUp.speeds[lineUp.speeds.length - 1] ?? lineUpSpeed;
  const liftoffSpeed = perf.takeoff.liftoffMs;
  const rollM = (liftoffSpeed * liftoffSpeed - rollStart * rollStart) / (2 * perf.takeoff.accelMs2);
  const roll = takeoffPath(runwayEnd, route.lineUp.runwayAlongM, rollM);
  legs.push(moveLeg({
    phase: 'takeoff', path: roll.coords, v0: rollStart, v1: liftoffSpeed, alt0: groundAltM, onGround: true,
    adjustable: true, speedRange: taxiRange, fixedV1: true, part: 'taxiOut',
  }));
  return Object.freeze({
    legs: Object.freeze(legs),
    liftoff: roll.coords[roll.coords.length - 1],
    liftoffAlongM: roll.toAlongM,
    holdingPoint: hold,
    pushbackEnd,
    rollFits: route.lineUp.runwayAlongM + rollM <= runwayEnd.lengthM + 1e-6,
  });
}

/**
 * The climb from the lift-off at its own speeds, drawn 250 NM at most: runway heading to 1 500 ft above the runway
 * while accelerating to the initial climb speed, then the turn onto the great circle to `destination` (none: runway
 * heading), on to FL100 accelerating to the climb speed and to the cruise level accelerating to the cruise speed, all
 * at the profile's climb rate; phase 'climb', then 'enroute' at the cruise level. Part 'climb'.
 */
export function climbLegs({ runwayEnd, liftoff, destination = null, perf }) {
  const climb = perf.climb;
  const elevation = ftToM(runwayEnd.elevationFt);
  const liftoffSpeed = perf.takeoff.liftoffMs;
  const turnAlt = elevation + climb.turnAltM;
  const straightM = (climb.turnAltM / climb.rateMs) * ((liftoffSpeed + climb.startSpeedMs) / 2);
  const path = climbPath({
    runwayEnd, liftoff, destination, straightM, turnSpeedMs: climb.startSpeedMs, maxDistanceM: climb.maxDistanceM,
  });
  const line = measurePolyline(path.coords);
  const transition = Math.max(turnAlt, perf.descent.transitionAltM);
  const cruiseAlt = Math.max(transition, perf.cruise.altM);
  const toTransition = straightM + ((transition - turnAlt) / climb.rateMs) * ((climb.startSpeedMs + climb.endSpeedMs) / 2);
  const toCruise = toTransition + ((cruiseAlt - transition) / climb.rateMs) * ((climb.endSpeedMs + perf.cruise.speedMs) / 2);
  const points = [
    { along: 0, speed: liftoffSpeed, alt: elevation, phase: 'climb' },
    { along: straightM, speed: climb.startSpeedMs, alt: turnAlt, phase: 'climb' },
    { along: toTransition, speed: climb.endSpeedMs, alt: transition, phase: 'climb' },
    { along: toCruise, speed: perf.cruise.speedMs, alt: cruiseAlt, phase: 'climb' },
    { along: Math.max(toCruise + 1, line.lengthM), speed: perf.cruise.speedMs, alt: cruiseAlt, phase: 'enroute' },
  ];
  return Object.freeze(legsBetween(line, points, { part: 'climb' }));
}

/**
 * The climb of an airborne departure rebuilt from a live fix (`{ lon, lat, altM, gsMs, trackDeg }`): along the great
 * circle to `destination` (none: on its track), from the fix's height and speed up to the cruise level and speed at
 * the profile's climb rate, drawn 250 NM at most. Part 'climb'.
 */
export function climbLegsFrom({ fix, destination = null, perf }) {
  const start = [fix.lon, fix.lat];
  const far = destination ?? destinationPoint(start, fix.trackDeg ?? 0, perf.climb.maxDistanceM);
  const line = measurePolyline(slicePolyline(greatCirclePath(start, far), 0, perf.climb.maxDistanceM));
  const climb = perf.climb;
  const alt = Number.isFinite(fix.altM) ? fix.altM : climb.turnAltM;
  const speed = Number.isFinite(fix.gsMs) && fix.gsMs > 0 ? fix.gsMs : climb.startSpeedMs;
  const cruiseAlt = Math.max(alt, perf.cruise.altM);
  const toCruise = ((cruiseAlt - alt) / climb.rateMs) * ((speed + perf.cruise.speedMs) / 2);
  const points = [
    { along: 0, speed, alt, phase: 'climb' },
    { along: Math.max(1, toCruise), speed: perf.cruise.speedMs, alt: cruiseAlt, phase: 'climb' },
    { along: Math.max(toCruise + 2, line.lengthM), speed: perf.cruise.speedMs, alt: cruiseAlt, phase: 'enroute' },
  ];
  return Object.freeze(legsBetween(line, points, { part: 'climb' }));
}
