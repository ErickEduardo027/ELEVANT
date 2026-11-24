import { describe, expect, it } from 'vitest';
import {
  ATTITUDE, G, bankFor, createAttitudeTracker, gearDown, heightAboveField, lightsFor, targetAttitude,
} from './attitude';

// The attitude of a 3D aircraft from real data (CN-30): height over the field, pitch, bank, gear and lights, eased.
const FIELD_M = 14.3;
const KT = 0.514444;
const FPM = 0.00508;

describe('attitude of a 3D aircraft (CN-30)', () => {
  it('stands on the runway on the ground and never sinks below the field', () => {
    expect(heightAboveField({ altM: 300, onGround: true, fieldElevationM: FIELD_M })).toBe(0);
    expect(heightAboveField({ altM: FIELD_M - 20, onGround: false, fieldElevationM: FIELD_M })).toBe(0);
    expect(heightAboveField({ altM: FIELD_M + 150, onGround: false, fieldElevationM: FIELD_M })).toBeCloseTo(150, 6);
    expect(heightAboveField({ altM: null, onGround: false })).toBeNull();
    expect(heightAboveField({ altM: null, onGround: true })).toBe(0);
  });

  it('banks as a coordinated turn, within ±30°, and not on the ground or slow', () => {
    // A standard rate turn (3 °/s) at 250 kt: atan(v·ω/g) ≈ 35°, held at 30°; at 140 kt about 20.8°.
    expect(bankFor(250 * KT, 3)).toBe(ATTITUDE.maxBankDeg);
    const v = 140 * KT;
    expect(bankFor(v, 3)).toBeCloseTo((Math.atan((v * 3 * Math.PI) / 180 / G) * 180) / Math.PI, 6);
    expect(bankFor(v, 3)).toBeCloseTo(20.8, 0);
    expect(bankFor(v, -1.5)).toBeLessThan(0);
    expect(bankFor(20, 5)).toBe(0);
    expect(targetAttitude({ onGround: true, gsMs: 10, turnDegS: 10 }).bankDeg).toBe(0);
  });

  it('pitches for each phase: approach slightly nose up, climb 8–15°, a flare and a rotation', () => {
    // Approach on the 3° glide path at 140 kt (about 740 ft/min down): nose 1–4° up.
    const approach = targetAttitude({ heightM: 400, gsMs: 140 * KT, vrateMs: -740 * FPM });
    expect(approach.pitchDeg).toBeGreaterThan(1);
    expect(approach.pitchDeg).toBeLessThan(4);
    // Initial climb at 160 kt and 2 500 ft/min: 10–15°.
    const climb = targetAttitude({ heightM: 600, gsMs: 160 * KT, vrateMs: 2500 * FPM });
    expect(climb.pitchDeg).toBeGreaterThan(8);
    expect(climb.pitchDeg).toBeLessThan(15);
    // Cruise level: a little nose up.
    const cruise = targetAttitude({ heightM: 10_000, gsMs: 460 * KT, vrateMs: 0 });
    expect(cruise.pitchDeg).toBeCloseTo(ATTITUDE.bodyAngleDeg.cruise, 6);
    // The flare, a few metres over the runway: more nose up than on the approach.
    const flare = targetAttitude({ heightM: 4, gsMs: 135 * KT, vrateMs: -300 * FPM });
    expect(flare.pitchDeg).toBeGreaterThan(approach.pitchDeg + 2);
    // The take-off roll rotates from 60 m/s, up to 8.5°; a landing roll stays level.
    expect(targetAttitude({ onGround: true, gsMs: 50, phase: 'takeoff' }).pitchDeg).toBe(0);
    expect(targetAttitude({ onGround: true, gsMs: 66, phase: 'takeoff' }).pitchDeg).toBeCloseTo(4.25, 6);
    expect(targetAttitude({ onGround: true, gsMs: 80, accelMs2: 2 }).pitchDeg).toBe(ATTITUDE.rotateDeg);
    expect(targetAttitude({ onGround: true, gsMs: 70, accelMs2: -2 }).pitchDeg).toBe(0);
    // Never beyond its limits.
    expect(targetAttitude({ heightM: 3000, gsMs: 100, vrateMs: 60 }).pitchDeg).toBe(ATTITUDE.maxPitchDeg);
    expect(targetAttitude({ heightM: 3000, gsMs: 100, vrateMs: -60 }).pitchDeg).toBe(ATTITUDE.minPitchDeg);
  });

  it('shows the gear on the ground and on an approach below 2 000 ft, and retracts it after the lift-off', () => {
    expect(gearDown({ onGround: true })).toBe(true);
    expect(gearDown({ heightM: 500, vrateMs: -4 })).toBe(true);
    expect(gearDown({ heightM: 700, vrateMs: -4 })).toBe(false);
    expect(gearDown({ heightM: 15, vrateMs: 10, phase: 'takeoff' })).toBe(true);
    expect(gearDown({ heightM: 40, vrateMs: 10 })).toBe(false);
    expect(gearDown({ heightM: 300, vrateMs: 0, phase: 'climb' })).toBe(false);
    expect(gearDown({ heightM: null })).toBe(false);
  });

  it('turns off the beacon of a parked aircraft and the strobes on the ground at low speed', () => {
    expect(lightsFor({ onGround: true, gsMs: 0, onStand: true })).toEqual({ nav: true, beacon: false, strobes: false });
    expect(lightsFor({ onGround: true, gsMs: 8 })).toEqual({ nav: true, beacon: true, strobes: false });
    expect(lightsFor({ onGround: true, gsMs: 60 })).toMatchObject({ strobes: true });
    expect(lightsFor({ onGround: false, gsMs: 80 })).toEqual({ nav: true, beacon: true, strobes: true });
  });

  it('eases pitch and bank over time and reads the turn from the track when the motion gives none', () => {
    const tracker = createAttitudeTracker();
    const base = { altM: FIELD_M + 600, gsMs: 75, vrateMs: 0, onGround: false };
    const first = tracker.update('a', { ...base, trackDeg: 90 }, { nowMs: 0, fieldElevationM: FIELD_M });
    expect(first.bankDeg).toBe(0);
    // Turning right at 3 °/s: the bank grows toward the coordinated one, without jumping to it.
    let last = first;
    for (let step = 1; step <= 40; step += 1) {
      last = tracker.update('a', { ...base, trackDeg: 90 + 0.3 * step }, { nowMs: step * 100, fieldElevationM: FIELD_M });
      if (step === 1) expect(last.bankDeg).toBeLessThan(bankFor(75, 3) / 2);
    }
    expect(last.turnDegS).toBeGreaterThan(2);
    expect(last.bankDeg).toBeGreaterThan(0.6 * bankFor(75, 3));
    // A turn the motion gives (CN-18's turn rate) is taken as it is.
    const given = tracker.update('b', { ...base, trackDeg: 0, turnDegS: -2 }, { nowMs: 0, fieldElevationM: FIELD_M });
    expect(given.turnDegS).toBe(-2);
    expect(given.bankDeg).toBeLessThan(0);
    tracker.retain(new Set(['a']));
    expect(tracker.size()).toBe(1);
  });

  it('eases a jump of height out over half a second and lands on the runway, never under it', () => {
    const tracker = createAttitudeTracker();
    tracker.update('a', { altM: FIELD_M + 12, gsMs: 70, vrateMs: -2, onGround: false, trackDeg: 74 },
      { nowMs: 0, fieldElevationM: FIELD_M });
    // The touchdown is read: the wheels come down to the runway over a few tenths of a second.
    const touch = tracker.update('a', { altM: FIELD_M + 12, gsMs: 68, vrateMs: 0, onGround: true, trackDeg: 74 },
      { nowMs: 100, fieldElevationM: FIELD_M });
    expect(touch.heightM).toBeGreaterThan(0);
    expect(touch.heightM).toBeLessThan(12);
    let settled = touch;
    for (let step = 2; step <= 30; step += 1) {
      settled = tracker.update('a', { altM: FIELD_M + 12, gsMs: 60, vrateMs: 0, onGround: true, trackDeg: 74 },
        { nowMs: step * 100, fieldElevationM: FIELD_M });
      expect(settled.heightM).toBeGreaterThanOrEqual(0);
    }
    expect(settled.heightM).toBe(0);
    expect(settled.gearDown).toBe(true);
    // A steady descent predicts itself: the height shown is the aircraft's.
    const steady = createAttitudeTracker();
    for (let step = 0; step <= 10; step += 1) {
      const shown = steady.update('s', { altM: FIELD_M + 300 - 4 * step, gsMs: 70, vrateMs: -40, onGround: false },
        { nowMs: step * 100, fieldElevationM: FIELD_M });
      expect(shown.heightM).toBeCloseTo(300 - 4 * step, 1);
    }
    // In the air without an altitude: nothing to stand it on.
    expect(tracker.update('c', { altM: null, onGround: false }, { nowMs: 0 })).toBeNull();
  });
});
