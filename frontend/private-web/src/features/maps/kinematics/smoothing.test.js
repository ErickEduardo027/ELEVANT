import { describe, expect, it } from 'vitest';
import { HEADING_RATES, angleDiff, displayHeading, smoothHeading } from './smoothing.js';
import { ktToMs } from './units.js';

const FRAME_S = 1 / 60;

/** Draws `seconds` of frames toward `trackDeg` and returns every heading drawn, from `startDeg`. */
function frames(startDeg, trackDeg, seconds, options) {
  const drawn = [startDeg];
  for (let at = 0; at < Math.round(seconds / FRAME_S); at += 1) {
    drawn.push(displayHeading({ prevDeg: drawn[drawn.length - 1], trackDeg, dtS: FRAME_S, ...options }));
  }
  return drawn;
}

describe('heading smoothing', () => {
  it('turns the short way across north', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(90, 90)).toBe(0);
    expect(Object.is(angleDiff(400, 40), 0)).toBe(true);
    expect(angleDiff(-10, 725)).toBe(15);
    expect(angleDiff(359.5, 0.25)).toBeCloseTo(0.75, 12);
    for (const [a, b] of [[350, 10], [10, 350], [0, 180], [123.4, 300.1], [-720, 1]]) {
      const turn = angleDiff(a, b);
      expect(turn, `${a} → ${b}`).toBeGreaterThan(-180);
      expect(turn, `${a} → ${b}`).toBeLessThanOrEqual(180);
    }
    expect(angleDiff(Number.NaN, 10)).toBeNaN();
    expect(angleDiff(10, null)).toBeNaN();

    // From 350° to 10° it goes through north, never through south.
    expect(smoothHeading(350, 10, 1, 3)).toBe(353);
    expect(smoothHeading(10, 350, 1, 3)).toBe(7);
    expect(smoothHeading(350, 10, 1, 20)).toBe(10);
    expect(smoothHeading(359, 1, 1, 1.5)).toBe(0.5);
    const across = frames(350, 10, 10, { gsMs: ktToMs(250) });
    for (const heading of across) expect(heading >= 350 || heading <= 10, String(heading)).toBe(true);
    expect(across[across.length - 1]).toBe(10);
    // Without a previous heading it takes the target; without a target it keeps the previous one.
    expect(smoothHeading(null, 370, 1, 3)).toBe(10);
    expect(smoothHeading(45, null, 1, 3)).toBe(45);
    expect(smoothHeading(null, null, 1, 3)).toBeNull();
    // No time, no turn; no limit, the whole turn.
    expect(smoothHeading(90, 180, 0, 3)).toBe(90);
    expect(smoothHeading(90, 180, 0, Infinity)).toBe(90);
    expect(smoothHeading(90, 180, 0.01, Infinity)).toBe(180);
    expect(smoothHeading(90, 180, Infinity, 3)).toBe(180);
  });

  it('never turns faster than 3°/s in the air or 20°/s on the ground', () => {
    expect(HEADING_RATES).toEqual({ airDegS: 3, groundDegS: 20, holdBelowMs: ktToMs(2) });
    expect(Object.isFrozen(HEADING_RATES)).toBe(true);
    for (const { onGround, rate, gsMs } of [
      { onGround: false, rate: 3, gsMs: ktToMs(180) },
      { onGround: true, rate: 20, gsMs: ktToMs(15) },
    ]) {
      // A track that jumps about, as a noisy feed would: 90°, then 250°, then 10°.
      const drawn = [];
      let heading = 0;
      for (const [trackDeg, seconds] of [[90, 40], [250, 70], [10, 50]]) {
        for (let at = 0; at < Math.round(seconds / FRAME_S); at += 1) {
          const next = displayHeading({ prevDeg: heading, trackDeg, gsMs, onGround, dtS: FRAME_S });
          expect(Math.abs(angleDiff(heading, next)), `${onGround ? 'ground' : 'air'} at ${trackDeg}°`)
            .toBeLessThanOrEqual(rate * FRAME_S + 1e-9);
          // It closes in on the track, never past it.
          expect(Math.abs(angleDiff(next, trackDeg))).toBeLessThanOrEqual(Math.abs(angleDiff(heading, trackDeg)) + 1e-9);
          heading = next;
          drawn.push(heading);
        }
        expect(heading, `${onGround ? 'ground' : 'air'} reaches ${trackDeg}°`).toBe(trackDeg);
      }
      // 90° in the air takes 30 s at 3°/s; on the ground 4.5 s at 20°/s.
      const toEast = (drawn.findIndex(value => value === 90) + 1) * FRAME_S;
      expect(Math.abs(toEast - 90 / rate)).toBeLessThanOrEqual(1.5 * FRAME_S);
    }
    // One long frame turns no more than its time allows.
    expect(displayHeading({ prevDeg: 0, trackDeg: 90, gsMs: ktToMs(200), dtS: 2 })).toBe(6);
    expect(displayHeading({ prevDeg: 0, trackDeg: 90, gsMs: ktToMs(10), onGround: true, dtS: 2 })).toBe(40);
  });

  it('holds the heading below 2 kt and takes the stand heading when parked', () => {
    // Stopped on the ground, an ADS-B track is noise: the drawn heading holds.
    expect(displayHeading({ prevDeg: 90, trackDeg: 200, gsMs: ktToMs(1.5), onGround: true, dtS: 1 })).toBe(90);
    expect(displayHeading({ prevDeg: 90, trackDeg: 200, gsMs: 0, onGround: true, dtS: 5 })).toBe(90);
    for (const heading of frames(90, 270, 30, { gsMs: ktToMs(1.9), onGround: true })) expect(heading).toBe(90);
    // With nothing drawn yet it takes the track it has.
    expect(displayHeading({ prevDeg: null, trackDeg: 200, gsMs: 0, onGround: true, dtS: 1 })).toBe(200);
    // From 2 kt it turns again, at the ground rate.
    expect(displayHeading({ prevDeg: 90, trackDeg: 200, gsMs: ktToMs(2), onGround: true, dtS: 1 })).toBe(110);
    // Parked, the stand's heading wins over the track and over what was drawn.
    expect(displayHeading({ prevDeg: 90, trackDeg: 200, gsMs: 0, onGround: true, parkedHeadingDeg: 182, dtS: 1 })).toBe(182);
    expect(displayHeading({ prevDeg: 90, trackDeg: null, parkedHeadingDeg: -2 })).toBe(358);
    // An estimated position keeps its own heading, the tangent of its path, on the ground and in the air.
    expect(displayHeading({ prevDeg: 90, trackDeg: 200, gsMs: ktToMs(12), onGround: true, dtS: FRAME_S, estimated: true })).toBe(200);
    expect(displayHeading({ prevDeg: 10, trackDeg: 80, gsMs: ktToMs(180), dtS: FRAME_S, estimated: true })).toBe(80);
    expect(displayHeading({ prevDeg: 10, trackDeg: 80, gsMs: 0, onGround: true, estimated: true })).toBe(80);
    // Without a track the drawn heading stays; with nothing at all there is none.
    expect(displayHeading({ prevDeg: 45, trackDeg: null, gsMs: ktToMs(100), dtS: 1 })).toBe(45);
    expect(displayHeading({})).toBeNull();
  });
});
