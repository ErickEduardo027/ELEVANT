import { ktToMs, normalizeDeg } from './units.js';

// Heading smoothing of the map kinematics (PR M6, design F5). A drawn aircraft turns the short way and no faster than
// a real one: 3°/s in the air, 20°/s on the ground. Below 2 kt an ADS-B track is noise, so the heading the map already
// draws holds; a parked aircraft takes its stand's heading. An estimated position needs none of this: its heading is
// the exact tangent of its path (a rounded taxi path, a filleted approach or climb), which a compressed demo turns
// faster than any rate limit would allow. The caller keeps the previous heading from frame to frame; these functions
// keep no state. Degrees true, clockwise from north; seconds; m/s. Pure: explicit '.js' imports, no clock, no JSON.

/** How fast a drawn heading may turn, in degrees a second, and the speed below which the heading holds (m/s). */
export const HEADING_RATES = Object.freeze({ airDegS: 3, groundDegS: 20, holdBelowMs: ktToMs(2) });

const finite = value => typeof value === 'number' && Number.isFinite(value);

/**
 * The turn from `fromDeg` to `toDeg` the short way, in degrees within (−180, 180]: positive turns clockwise (to the
 * right), and a half turn reads +180. `NaN` when either is not a number.
 */
export function angleDiff(fromDeg, toDeg) {
  if (!finite(fromDeg) || !finite(toDeg)) return Number.NaN;
  const diff = ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
  if (diff === -180) return 180;
  return diff === 0 ? 0 : diff;
}

/**
 * The heading after turning from `prevDeg` toward `targetDeg` the short way for `dtS` seconds at `maxRateDegS` at
 * most, in [0, 360). It never passes the target. Without a previous heading it is the target; without a target the
 * previous heading stays; `null` when neither is known.
 */
export function smoothHeading(prevDeg, targetDeg, dtS, maxRateDegS) {
  const hasPrevious = finite(prevDeg);
  if (!finite(targetDeg)) return hasPrevious ? normalizeDeg(prevDeg) : null;
  if (!hasPrevious) return normalizeDeg(targetDeg);
  const turn = angleDiff(prevDeg, targetDeg);
  const rate = finite(maxRateDegS) || maxRateDegS === Infinity ? Math.max(0, maxRateDegS) : 0;
  const dt = finite(dtS) || dtS === Infinity ? Math.max(0, dtS) : 0;
  const step = rate === 0 || dt === 0 ? 0 : rate * dt;
  if (Math.abs(turn) <= step) return normalizeDeg(targetDeg);
  return normalizeDeg(prevDeg + Math.sign(turn) * step);
}

/**
 * The heading to draw for one frame (design F5), in [0, 360), or `null` when nothing is known:
 * - parked (`parkedHeadingDeg`): the stand's heading;
 * - `estimated`: the track as it is, the tangent of the estimated path;
 * - without a track: the previous heading;
 * - below 2 kt (`gsMs`): the previous heading holds (the track itself when there is none yet);
 * - otherwise the previous heading turns toward the track for `dtS` seconds at 3°/s in the air and 20°/s on the
 *   ground (`onGround`).
 */
export function displayHeading({
  prevDeg = null, trackDeg = null, gsMs = null, onGround = false, parkedHeadingDeg = null, dtS = 0, estimated = false,
} = {}) {
  if (finite(parkedHeadingDeg)) return normalizeDeg(parkedHeadingDeg);
  const hasPrevious = finite(prevDeg);
  if (!finite(trackDeg)) return hasPrevious ? normalizeDeg(prevDeg) : null;
  if (estimated) return normalizeDeg(trackDeg);
  if (finite(gsMs) && gsMs < HEADING_RATES.holdBelowMs) return normalizeDeg(hasPrevious ? prevDeg : trackDeg);
  return smoothHeading(prevDeg, trackDeg, dtS, onGround === true ? HEADING_RATES.groundDegS : HEADING_RATES.airDegS);
}
