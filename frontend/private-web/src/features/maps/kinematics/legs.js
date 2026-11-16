import { measurePolyline, pointAlong, slicePolyline } from '../airport/geo.js';
import { normalizeDeg } from './units.js';

// The legs a trajectory is made of (PR M6, design F2). A moving leg follows a measured path with its speed changing
// linearly in time (a constant acceleration), so it lasts 2L / (v0 + v1) and its position is found by time, never
// integrated frame by frame; a wait holds one point. fitLegs fits a run of legs to a required time with one factor.
// SI units: metres, m/s, seconds inside a leg, milliseconds for the durations a fit returns; headings in degrees true.
// Pure: explicit '.js' imports, no clock, no randomness, no JSON. Every leg is frozen.

/** A fit stops when the legs last within this of the required time (a microsecond: parts meet without overlap). */
export const FIT_TOLERANCE_MS = 0.001;
// The factor a fit searches between, and how many halvings it may take.
const FACTOR_MIN = 1e-4;
const FACTOR_MAX = 1e4;
const MAX_STEPS = 200;

const shortArc = (from, to) => ((to - from + 540) % 360) - 180;

/**
 * A moving leg, frozen: `{ kind: 'move', phase, path: { coords, cumM, lengthM }, lengthM, v0, v1, alt0, alt1,
 * heading, onGround, adjustable, speedRange, fixedV0, fixedV1, tangentsDeg, part, statusKey }`.
 * - `heading`: 'tangent' (the path's direction), 'reverse' (its opposite: a pushback) or a fixed number of degrees.
 * - `tangentsDeg`: the exact bearing of the path at each of its points, when known (a rounded taxi path); else the
 *   heading is the bearing of the segment the aircraft is on.
 * - `adjustable`: a fit may scale `v0` and `v1` within `speedRange` ([min, max] m/s), except an end marked fixed.
 */
export function moveLeg({
  phase, path, v0, v1 = v0, alt0 = 0, alt1 = alt0, heading = 'tangent', onGround = false, adjustable = false,
  speedRange = null, fixedV0 = false, fixedV1 = false, tangentsDeg = null, part = null, statusKey = null,
}) {
  const measured = measurePolyline(path);
  return Object.freeze({
    kind: 'move',
    phase,
    path: measured,
    lengthM: measured.lengthM,
    v0,
    v1,
    alt0,
    alt1,
    heading,
    onGround,
    adjustable,
    speedRange: speedRange === null ? null : Object.freeze([speedRange[0], speedRange[1]]),
    fixedV0,
    fixedV1,
    tangentsDeg: tangentsDeg === null ? null : Object.freeze([...tangentsDeg]),
    part,
    statusKey,
  });
}

/**
 * A wait at `point`, frozen: `{ kind: 'wait', phase, path: { coords: [point], … }, lengthM: 0, nominalS,
 * durationRange: [min, max], adjustable, heading (degrees), onGround, alt0, alt1, v0: 0, v1: 0, part, statusKey }`.
 * A fit compresses or stretches it within its range (`adjustable` when min < max); a wait whose range ends at
 * Infinity takes the time left over.
 */
export function waitLeg({
  phase, point, nominalS = 0, durationRange = null, heading = 0, onGround = true, alt = 0, part = null,
  statusKey = null,
}) {
  const range = durationRange ?? [nominalS, nominalS];
  return Object.freeze({
    kind: 'wait',
    phase,
    path: measurePolyline([point]),
    lengthM: 0,
    nominalS,
    durationRange: Object.freeze([range[0], range[1]]),
    adjustable: range[0] < range[1],
    heading,
    onGround,
    alt0: alt,
    alt1: alt,
    v0: 0,
    v1: 0,
    part,
    statusKey,
  });
}

/**
 * The seconds a leg lasts: `durationMs` once a fit or a trajectory set it; else a moving leg's 2L / (v0 + v1) (0 for
 * no length, Infinity when it never moves) and a wait's nominal duration.
 */
export function legDurationS(leg) {
  if (Number.isFinite(leg.durationMs) || leg.durationMs === Infinity) return leg.durationMs / 1000;
  if (leg.kind === 'wait') return leg.nominalS;
  if (!(leg.lengthM > 0)) return 0;
  const sum = leg.v0 + leg.v1;
  return sum > 0 ? (2 * leg.lengthM) / sum : Infinity;
}

/** The speed in m/s `s` metres into a moving leg: v² changes linearly with distance under a constant acceleration. */
export function speedAt(leg, s) {
  if (leg.kind === 'wait' || !(leg.lengthM > 0)) return leg.v0;
  const fraction = Math.max(0, Math.min(1, s / leg.lengthM));
  return Math.sqrt(Math.max(0, leg.v0 * leg.v0 + (leg.v1 * leg.v1 - leg.v0 * leg.v0) * fraction));
}

/** The height in metres `s` metres into a leg: linear in distance. */
export function altitudeAt(leg, s) {
  if (!(leg.lengthM > 0)) return leg.alt0;
  return leg.alt0 + ((leg.alt1 - leg.alt0) * Math.max(0, Math.min(leg.lengthM, s))) / leg.lengthM;
}

/** The seconds a moving leg takes to cover its first `s` metres: 2s / (v0 + v(s)). */
export function timeToDistanceS(leg, s) {
  if (!(s > 0)) return 0;
  const sum = leg.v0 + speedAt(leg, s);
  return sum > 0 ? (2 * s) / sum : Infinity;
}

/**
 * Where a leg is `tauS` seconds after it starts: `{ s, v, alt, vrate }` (metres along, m/s, metres, m/s). Under a
 * constant acceleration s = v0·τ + ½·a·τ²; the leg's own duration is authoritative, so a leg a fit compressed in time
 * covers its length in exactly that time. The height is linear in distance and the vertical rate follows the speed.
 */
export function legStateAt(leg, tauS) {
  if (leg.kind === 'wait') return { s: 0, v: 0, alt: leg.alt0, vrate: 0 };
  const duration = legDurationS(leg);
  const length = leg.lengthM;
  if (!(length > 0)) return { s: 0, v: leg.v1, alt: leg.alt1, vrate: 0 };
  if (!(duration > 0)) return { s: length, v: leg.v1, alt: leg.alt1, vrate: 0 };
  const grade = (leg.alt1 - leg.alt0) / length;
  if (duration === Infinity) return { s: 0, v: 0, alt: leg.alt0, vrate: 0 };
  const u = Math.max(0, Math.min(1, tauS / duration));
  const mean = (leg.v0 + leg.v1) / 2;
  // The shape of the speed (v0 → v1) scaled to the leg's real pace: length / duration.
  const pace = mean > 0 ? length / duration / mean : 0;
  const fraction = mean > 0 ? (leg.v0 * u + 0.5 * (leg.v1 - leg.v0) * u * u) / mean : u;
  const s = Math.max(0, Math.min(length, length * fraction));
  const v = Math.max(0, (leg.v0 + (leg.v1 - leg.v0) * u) * pace);
  return { s, v, alt: leg.alt0 + grade * s, vrate: grade * v };
}

/**
 * The heading in degrees true `s` metres into a leg: a wait's own; a fixed number; else the path's tangent (from
 * `tangentsDeg` when the leg has them, interpolated the short way, else the segment's bearing), reversed for
 * 'reverse'. A leg without length keeps its first tangent, or 0.
 */
export function headingAt(leg, s) {
  if (leg.kind === 'wait' || typeof leg.heading === 'number') return normalizeDeg(leg.heading);
  const flip = leg.heading === 'reverse' ? 180 : 0;
  const along = pointAlong(leg.path, s);
  let tangent = along?.bearingDeg ?? null;
  const tangents = leg.tangentsDeg;
  if (tangents !== null && tangents.length === leg.path.coords.length && along !== null) {
    const index = along.index;
    const from = tangents[index];
    const to = tangents[Math.min(index + 1, tangents.length - 1)];
    if (from !== null && to !== null) {
      const start = leg.path.cumM[index];
      const span = (leg.path.cumM[index + 1] ?? start) - start;
      const fraction = span > 0 ? Math.max(0, Math.min(1, (s - start) / span)) : 0;
      tangent = from + shortArc(from, to) * fraction;
    }
  }
  if (tangent === null) tangent = tangents?.[0] ?? 0;
  return normalizeDeg(tangent + flip);
}

/**
 * The moving leg's part between `fromM` and `toM` metres along it (clamped), as a new leg with the speeds and heights
 * it has at those points, the same acceleration and the same rules; its duration is dropped (it has its own).
 */
export function cutLeg(leg, fromM, toM) {
  const length = leg.lengthM;
  const from = Math.max(0, Math.min(length, fromM));
  const to = Math.max(from, Math.min(length, toM));
  let tangentsDeg = null;
  if (leg.tangentsDeg !== null) {
    const inner = [];
    leg.path.cumM.forEach((distance, at) => {
      if (distance > from + 1e-6 && distance < to - 1e-6) inner.push(leg.tangentsDeg[at]);
    });
    const tangentAt = s => headingAt({ ...leg, heading: 'tangent' }, s);
    tangentsDeg = [tangentAt(from), ...inner, tangentAt(to)];
  }
  return moveLeg({
    ...leg,
    path: slicePolyline(leg.path, from, to),
    v0: speedAt(leg, from),
    v1: speedAt(leg, to),
    alt0: altitudeAt(leg, from),
    alt1: altitudeAt(leg, to),
    tangentsDeg,
  });
}

/**
 * A speed scaled by a fit's factor within `[min, max]`: 0 stays 0 (a stop is a stop), a speed already outside the
 * range never moves further out than it was, and without a range it scales freely.
 */
export function scaleSpeed(speed, factor, range) {
  if (speed === 0) return 0;
  if (range === null || range === undefined) return speed * factor;
  return Math.min(Math.max(speed * factor, Math.min(range[0], speed)), Math.max(range[1], speed));
}

const isSpareWait = leg => leg.kind === 'wait' && leg.adjustable && leg.durationRange[1] === Infinity;

function scaledSpeeds(leg, factor) {
  if (leg.kind !== 'move' || !leg.adjustable) return [leg.v0, leg.v1];
  return [
    leg.fixedV0 ? leg.v0 : scaleSpeed(leg.v0, factor, leg.speedRange),
    leg.fixedV1 ? leg.v1 : scaleSpeed(leg.v1, factor, leg.speedRange),
  ];
}

function durationAtS(leg, factor) {
  if (leg.kind === 'wait') {
    if (!leg.adjustable) return leg.nominalS;
    const [min, max] = leg.durationRange;
    return Math.min(max, Math.max(min, leg.nominalS / factor));
  }
  const [v0, v1] = scaledSpeeds(leg, factor);
  if (!(leg.lengthM > 0)) return 0;
  return v0 + v1 > 0 ? (2 * leg.lengthM) / (v0 + v1) : Infinity;
}

/**
 * Fits a run of legs to last `requiredMs`: `{ legs, factor, timeScale, feasible }`, frozen, each leg with its
 * `durationMs` and the run's `timeScale`.
 * - One factor k for everything adjustable: speeds become scaleSpeed(v, k, range) and waits clamp(d / k, range), so
 *   the total time only falls as k grows; k is found by bisection in log k to within FIT_TOLERANCE_MS.
 * - A wait whose range ends at Infinity (the hold before a stand's lead-in) takes the time left over: while the legs
 *   at k = 1 are faster than required, k stays 1 and that wait gets the rest.
 * - When even the fastest legs are too slow, `timeScale` = their time / the required time (> 1) and, with
 *   `compress` (the default), every duration is divided by it: speeds are multiplied, waits shortened. When even the
 *   slowest legs are too fast and no wait takes the rest, `timeScale` < 1 the same way. Without `compress` an
 *   impossible run keeps the limit factor's own durations and `timeScale` 1. `feasible` is false in either case.
 */
export function fitLegs(legs, requiredMs, { compress = true } = {}) {
  const list = Array.isArray(legs) ? legs : [];
  const required = Number.isFinite(requiredMs) ? Math.max(0, requiredMs) / 1000 : 0;
  const tolerance = FIT_TOLERANCE_MS / 1000;
  const spare = list.findIndex(isSpareWait);
  const total = factor => list.reduce((sum, leg) => sum + durationAtS(leg, factor), 0);

  let factor = 1;
  let spareS = 0;
  const atOne = total(1);
  if (spare >= 0 && atOne <= required + tolerance) {
    spareS = Math.max(0, required - atOne);
  } else if (Math.abs(atOne - required) > tolerance) {
    let low = 1;
    let high = 1;
    if (atOne > required) {
      while (total(high) > required && high < FACTOR_MAX) {
        low = high;
        high *= 2;
      }
    } else {
      while (total(low) < required && low > FACTOR_MIN) {
        high = low;
        low /= 2;
      }
    }
    if (total(high) > required + tolerance) {
      factor = high;
    } else if (total(low) < required - tolerance) {
      factor = low;
    } else {
      factor = high;
      for (let step = 0; step < MAX_STEPS; step += 1) {
        const middle = Math.sqrt(low * high);
        const value = total(middle);
        factor = middle;
        if (Math.abs(value - required) <= tolerance) break;
        if (value > required) low = middle;
        else high = middle;
      }
    }
  }

  const durations = list.map((leg, at) => durationAtS(leg, factor) + (at === spare ? spareS : 0));
  const sum = durations.reduce((acc, value) => acc + value, 0);
  const feasible = Math.abs(sum - required) <= tolerance && sum !== Infinity;
  if (feasible) {
    // Less than the tolerance off: a wait that can take the difference does, and no speed is touched (a leg at its
    // 25 kt ceiling stays exactly there).
    const residual = required - sum;
    const order = spare >= 0 ? [spare, ...list.keys()] : [...list.keys()];
    const taker = order.find(at => list[at].kind === 'wait' && list[at].adjustable
      && durations[at] + residual >= list[at].durationRange[0] && durations[at] + residual <= list[at].durationRange[1]);
    if (taker !== undefined) durations[taker] += residual;
  }
  // An impossible fit is off by its time scale, which every leg shares when it is compressed.
  const ratio = required > 0 ? sum / required : (sum > 0 ? Infinity : 1);
  const applied = !feasible && compress ? ratio : 1;
  const timeScale = applied;
  const fitted = list.map((leg, at) => {
    const duration = applied === Infinity ? 0 : durations[at] / applied;
    const [v0, v1] = scaledSpeeds(leg, factor);
    const pace = applied === Infinity || leg.kind === 'wait' ? 1 : applied;
    return Object.freeze({ ...leg, v0: v0 * pace, v1: v1 * pace, durationMs: duration * 1000, timeScale });
  });
  return Object.freeze({ legs: Object.freeze(fitted), factor, timeScale, feasible });
}
