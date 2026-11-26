// The attitude of a 3D aircraft from what the map knows of it (CN-30): its height over the field, its pitch from its
// vertical rate and ground speed, its bank from its turn rate, whether its gear is down and which of its lights are on,
// eased over time so nothing snaps. The inputs are an aircraft of the map's frames (traffic/motionStore.js: a sample,
// with `altM`, `gsMs`, `vrateMs`, `trackDeg`, `onGround`, `phase` and, when the motion knows it, `turnDegS`). Pure:
// the tracker keeps its own small state per aircraft and reads no clock (the caller passes the time). Degrees, metres,
// m/s, seconds.

/** Gravity, for the bank of a coordinated turn. */
export const G = 9.80665;

/**
 * The numbers of the attitude: the bank's limit, the speed below which nothing banks, the body angle over the flight
 * path from slow (`slowMs`) to fast (`fastMs`, `cruiseMs`), the flare's height and pitch, the rotation's speeds and
 * pitch, the pitch's limits, the gear's heights (down below `gearApproachM` on an approach, up above `gearClimbM` after
 * the lift-off) and the easing time constants.
 */
export const ATTITUDE = Object.freeze({
  maxBankDeg: 30,
  minBankSpeedMs: 30,
  bodyAngleDeg: Object.freeze({ slow: 6, fast: 2.5, cruise: 1.5 }),
  slowMs: 70,
  fastMs: 130,
  cruiseMs: 230,
  flareM: 18,
  flareDeg: 4,
  rotateFromMs: 60,
  rotateSpanMs: 12,
  rotateDeg: 8.5,
  minPitchDeg: -8,
  maxPitchDeg: 18,
  gearApproachM: 610,
  gearClimbM: 25,
  climbVrateMs: 2,
  pitchTauS: 0.8,
  bankTauS: 1,
  heightTauS: 0.5,
  turnTauS: 1.5,
  // A gap longer than this between two updates starts the aircraft afresh.
  maxGapS: 10,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const toDegrees = radians => (radians * 180) / Math.PI;
const toRadians = degrees => (degrees * Math.PI) / 180;
const angleDiff = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const DEPARTING = new Set(['takeoff', 'climb', 'departure']);

/**
 * The height of an aircraft over the field: 0 on the ground and at or below the field's elevation (it never sinks
 * into the runway), else `altM − fieldElevationM`; `null` for an aircraft in the air without an altitude.
 */
export function heightAboveField({ altM = null, onGround = false, fieldElevationM = 0 } = {}) {
  if (onGround === true) return 0;
  if (!finite(altM)) return null;
  return Math.max(0, altM - (finite(fieldElevationM) ? fieldElevationM : 0));
}

/** The bank of a coordinated turn at `speedMs` turning `turnDegS` (positive right): atan(v·ω / g), within ±30°. */
export function bankFor(speedMs, turnDegS) {
  if (!finite(speedMs) || !finite(turnDegS) || speedMs < ATTITUDE.minBankSpeedMs) return 0;
  const bank = toDegrees(Math.atan((speedMs * toRadians(turnDegS)) / G));
  return clamp(bank, -ATTITUDE.maxBankDeg, ATTITUDE.maxBankDeg);
}

/** The angle of the body over the flight path at `speedMs`: slow (flaps out) high, fast low, linear between. */
export function bodyAngleFor(speedMs) {
  const { slow, fast, cruise } = ATTITUDE.bodyAngleDeg;
  const v = finite(speedMs) ? speedMs : ATTITUDE.fastMs;
  if (v <= ATTITUDE.slowMs) return slow;
  if (v <= ATTITUDE.fastMs) return slow + ((fast - slow) * (v - ATTITUDE.slowMs)) / (ATTITUDE.fastMs - ATTITUDE.slowMs);
  if (v <= ATTITUDE.cruiseMs) return fast + ((cruise - fast) * (v - ATTITUDE.fastMs)) / (ATTITUDE.cruiseMs - ATTITUDE.fastMs);
  return cruise;
}

/**
 * The attitude an aircraft aims at: `{ pitchDeg, bankDeg }`.
 * - In the air: the flight path's angle, atan(vrate / gs), plus the body angle of its speed (an approach on a 3° path
 *   flies about 2–3° nose up, a climb 10–15°); near the runway, descending, the flare raises the nose up to 4° more;
 *   the bank of its turn (bankFor).
 * - On the ground: level, unbanked; on a take-off roll (phase 'takeoff', climbing or accelerating) from 60 m/s the nose
 *   rotates up to 8.5° over the next 12 m/s.
 * Within −8° to 18°.
 */
export function targetAttitude({
  heightM = 0, gsMs = null, vrateMs = null, onGround = false, phase = null, turnDegS = 0, accelMs2 = 0,
} = {}) {
  const gs = finite(gsMs) ? Math.max(0, gsMs) : 0;
  const vrate = finite(vrateMs) ? vrateMs : 0;
  if (onGround === true || heightM === 0) {
    const takingOff = phase === 'takeoff' || vrate > 0.5 || (finite(accelMs2) && accelMs2 > 0.4);
    const rotation = takingOff && onGround === true
      ? clamp((gs - ATTITUDE.rotateFromMs) / ATTITUDE.rotateSpanMs, 0, 1) * ATTITUDE.rotateDeg : 0;
    return { pitchDeg: rotation, bankDeg: 0 };
  }
  const path = toDegrees(Math.atan2(vrate, Math.max(gs, 40)));
  let pitch = path + bodyAngleFor(gs);
  if (finite(heightM) && heightM < ATTITUDE.flareM && vrate <= 0.5) {
    pitch += (1 - heightM / ATTITUDE.flareM) * ATTITUDE.flareDeg;
  }
  return {
    pitchDeg: clamp(pitch, ATTITUDE.minPitchDeg, ATTITUDE.maxPitchDeg),
    bankDeg: bankFor(gs, turnDegS),
  };
}

/**
 * Whether the gear is down: always on the ground; in the air below 2 000 ft over the field on an approach, and after
 * a lift-off (phase 'takeoff' or 'climb', or climbing) only below 25 m, where it is retracted.
 */
export function gearDown({ heightM = null, vrateMs = null, onGround = false, phase = null } = {}) {
  if (onGround === true || heightM === 0) return true;
  if (!finite(heightM)) return false;
  const climbing = DEPARTING.has(phase) || (finite(vrateMs) && vrateMs > ATTITUDE.climbVrateMs);
  return heightM < (climbing ? ATTITUDE.gearClimbM : ATTITUDE.gearApproachM);
}

/**
 * The lights of an aircraft: the navigation lights always; the red beacon unless it stands parked on the ground
 * (stopped and parked, or on its stand); the white strobes in the air and on the runway at speed.
 */
export function lightsFor({ onGround = false, gsMs = null, phase = null, onStand = false } = {}) {
  const gs = finite(gsMs) ? gsMs : 0;
  const parked = onGround === true && gs < 0.5 && (onStand === true || phase === 'parked');
  return { nav: true, beacon: !parked, strobes: onGround !== true || gs > 25 };
}

const share = (dtS, tauS) => (dtS > 0 ? 1 - Math.exp(-dtS / tauS) : 0);

/**
 * The eased attitude of the map's aircraft (CN-30): `update(id, item, { nowMs, fieldElevationM, onStand })` answers
 * `{ heightM, pitchDeg, bankDeg, turnDegS, gearDown, lights }` for the aircraft at `nowMs` (milliseconds of any
 * monotonic clock), or `null` for one in the air without an altitude. The pitch and the bank ease toward their targets
 * (targetAttitude) over their time constants; the turn rate is the aircraft's `turnDegS` when it has one, else the
 * eased change of its track between updates; the height follows the aircraft and eases out a jump (a touchdown read
 * late, a new fix) over half a second, never below the ground. `retain(ids)` forgets the others; `size()` counts.
 */
export function createAttitudeTracker({ limits = ATTITUDE } = {}) {
  const states = new Map();
  return {
    update(id, item, { nowMs, fieldElevationM = 0, onStand = false } = {}) {
      const height = heightAboveField({ altM: item?.altM ?? null, onGround: item?.onGround === true, fieldElevationM });
      if (height === null || !finite(nowMs)) {
        states.delete(id);
        return null;
      }
      const gs = finite(item.gsMs) ? item.gsMs : null;
      const vrate = finite(item.vrateMs) ? item.vrateMs : 0;
      const track = finite(item.trackDeg) ? item.trackDeg : null;
      const previous = states.get(id) ?? null;
      const dtS = previous === null ? 0 : (nowMs - previous.atMs) / 1000;
      const fresh = previous === null || !(dtS >= 0) || dtS > limits.maxGapS;
      let turn = 0;
      if (finite(item.turnDegS)) turn = item.turnDegS;
      else if (!fresh && dtS > 0.02 && track !== null && previous.track !== null) {
        const measured = angleDiff(previous.track, track) / dtS;
        turn = previous.turn + (clamp(measured, -6, 6) - previous.turn) * share(dtS, limits.turnTauS);
      } else if (!fresh) turn = previous.turn;
      const accel = !fresh && dtS > 0.02 && gs !== null && previous.gs !== null ? (gs - previous.gs) / dtS : 0;
      const smoothedAccel = fresh ? 0 : previous.accel + (accel - previous.accel) * share(dtS, 1);
      const target = targetAttitude({
        heightM: height, gsMs: gs, vrateMs: vrate, onGround: item.onGround === true, phase: item.phase ?? null,
        turnDegS: turn, accelMs2: smoothedAccel,
      });
      let pitch = target.pitchDeg;
      let bank = target.bankDeg;
      let offset = 0;
      if (!fresh) {
        pitch = previous.pitch + (target.pitchDeg - previous.pitch) * share(dtS, limits.pitchTauS);
        bank = previous.bank + (target.bankDeg - previous.bank) * share(dtS, limits.bankTauS);
        // Where the height shown would be had it gone on as before, against where the aircraft is: a jump eases out
        // (a steady climb or descent predicts itself and adds nothing); one of more than 150 m is a new aircraft.
        const jump = previous.height + previous.vrate * dtS - height;
        offset = Math.abs(jump) > 150 ? 0 : jump * (1 - share(dtS, limits.heightTauS));
        if (Math.abs(offset) < 0.05) offset = 0;
      }
      const shown = Math.max(0, height + offset);
      states.set(id, {
        atMs: nowMs, track, gs, turn, pitch, bank, height: shown, vrate: item.onGround === true ? 0 : vrate,
        accel: smoothedAccel,
      });
      return {
        heightM: shown,
        pitchDeg: pitch,
        bankDeg: bank,
        turnDegS: turn,
        gearDown: gearDown({ heightM: height, vrateMs: vrate, onGround: item.onGround === true, phase: item.phase ?? null }),
        lights: lightsFor({ onGround: item.onGround === true, gsMs: gs, phase: item.phase ?? null, onStand }),
      };
    },
    retain(ids) {
      for (const id of [...states.keys()]) if (!ids.has(id)) states.delete(id);
    },
    size: () => states.size,
  };
}
