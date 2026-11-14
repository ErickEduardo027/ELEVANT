import { describe, expect, it } from 'vitest';
import { fromEnu, haversineM, pointAlong } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { KINEMATICS_ORIGIN, createKinematicsLayout } from './kinematicsFixtures.js';
import { fitGround } from './legPlans.js';
import {
  FIT_TOLERANCE_MS,
  altitudeAt,
  cutLeg,
  fitLegs,
  headingAt,
  legDurationS,
  legStateAt,
  moveLeg,
  scaleSpeed,
  speedAt,
  timeToDistanceS,
  waitLeg,
} from './legs.js';
import { PERF_PROFILES } from './perfProfiles.js';
import { TAXI_MAX_SHIFT_M, routeLandingTaxi } from './taxiRoute.js';
import { ktToMs } from './units.js';

const KT5 = ktToMs(5);
const KT25 = ktToMs(25);
const TAXI = [KT5, KT25];
// 1 000 m due east and 500 m on, on the synthetic aerodrome's plane (exact points, not rounded).
const at = (x, y) => fromEnu(KINEMATICS_ORIGIN, [x, y]);
const EAST = [at(0, 0), at(1000, 0)];
const ON = [at(1000, 0), at(1500, 0)];
const total = legs => legs.reduce((sum, leg) => sum + leg.durationMs, 0);

describe('legs', () => {
  it('a leg with linear speed change lasts 2L/(v0+v1) and samples continuously', () => {
    const leg = moveLeg({ phase: 'climb', path: EAST, v0: 10, v1: 30, alt0: 100, alt1: 600 });
    expect(leg.kind).toBe('move');
    expect(leg.lengthM).toBeCloseTo(1000, 6);
    // 2 · 1 000 m / (10 + 30) m/s.
    expect(legDurationS(leg)).toBeCloseTo((2 * leg.lengthM) / 40, 9);
    expect(legStateAt(leg, 0)).toMatchObject({ s: 0, v: 10, alt: 100 });
    const end = legStateAt(leg, legDurationS(leg));
    expect(end.s).toBeCloseTo(leg.lengthM, 9);
    expect(end.v).toBeCloseTo(30, 9);
    expect(end.alt).toBeCloseTo(600, 9);
    // s = v0·τ + ½·a·τ², halfway in time.
    const half = legDurationS(leg) / 2;
    const a = 20 / legDurationS(leg);
    expect(legStateAt(leg, half).s).toBeCloseTo(10 * half + 0.5 * a * half * half, 6);
    expect(legStateAt(leg, half).v).toBeCloseTo(20, 9);
    // Height is linear in distance and the vertical rate follows the speed.
    const state = legStateAt(leg, 17);
    expect(state.alt).toBeCloseTo(altitudeAt(leg, state.s), 9);
    expect(state.vrate).toBeCloseTo((500 / leg.lengthM) * state.v, 9);
    // v(s)² is linear in distance and the time to a distance inverts the position.
    expect(speedAt(leg, state.s)).toBeCloseTo(state.v, 6);
    expect(timeToDistanceS(leg, state.s)).toBeCloseTo(17, 6);
    // Every 0.1 s: never further than the faster speed times the step, the speed changing by a·dt.
    let previous = legStateAt(leg, 0);
    for (let tau = 0.1; tau <= legDurationS(leg); tau += 0.1) {
      const next = legStateAt(leg, tau);
      expect(next.s - previous.s).toBeGreaterThanOrEqual(0);
      expect(next.s - previous.s).toBeLessThanOrEqual(Math.max(previous.v, next.v) * 0.1 + 1e-9);
      expect(Math.abs(next.v - previous.v - a * 0.1)).toBeLessThan(1e-6);
      previous = next;
    }
    // Headings: the tangent (due east), its opposite, or a fixed one; a wait holds its own.
    expect(headingAt(leg, 300)).toBeCloseTo(90, 1);
    expect(headingAt(moveLeg({ phase: 'pushback', path: EAST, v0: 1, v1: 1, heading: 'reverse' }), 300)).toBeCloseTo(270, 1);
    expect(headingAt(moveLeg({ phase: 'taxiIn', path: EAST, v0: 1, v1: 1, heading: 12 }), 300)).toBe(12);
    // Exact tangents are interpolated the short way across north.
    const turning = moveLeg({ phase: 'taxiIn', path: EAST, v0: 1, v1: 1, tangentsDeg: [350, 10] });
    expect(headingAt(turning, leg.lengthM / 2)).toBeCloseTo(0, 6);
    // A wait lasts its duration and stays put.
    const wait = waitLeg({ phase: 'parked', point: EAST[1], nominalS: 45, heading: 175, alt: 13 });
    expect(legDurationS(wait)).toBe(45);
    expect(legStateAt(wait, 30)).toEqual({ s: 0, v: 0, alt: 13, vrate: 0 });
    expect(headingAt(wait, 0)).toBe(175);
    // A cut keeps the acceleration: its speeds are the original's at the cut points and it lasts the time between them.
    const cut = cutLeg(leg, 200, 700);
    expect(cut.lengthM).toBeCloseTo(500, 3);
    expect(cut.v0).toBeCloseTo(speedAt(leg, 200), 9);
    expect(cut.v1).toBeCloseTo(speedAt(leg, 700), 9);
    expect(legDurationS(cut)).toBeCloseTo(timeToDistanceS(leg, 700) - timeToDistanceS(leg, 200), 6);
    expect(haversineM(cut.path.coords[0], pointAlong(leg.path, 200).p)).toBeLessThan(1e-6);
    expect(cut.alt0).toBeCloseTo(altitudeAt(leg, 200), 9);
    expect(Object.isFrozen(leg) && Object.isFrozen(cut) && Object.isFrozen(wait)).toBe(true);
  });

  it('fitLegs hits the required time within 1 ms and clamps each leg to its range', () => {
    const taxi = moveLeg({ phase: 'taxiIn', path: EAST, v0: 8, v1: 8, adjustable: true, speedRange: TAXI, onGround: true });
    const fixed = moveLeg({ phase: 'taxiIn', path: ON, v0: 5, v1: 5, onGround: true });
    const engine = waitLeg({ phase: 'pushback', point: EAST[0], nominalS: 60, durationRange: [0, 60] });
    const legs = [taxi, fixed, engine];
    // Nominal: 125 s + 100 s + 60 s.
    expect(legs.reduce((sum, leg) => sum + legDurationS(leg), 0)).toBeCloseTo(285, 4);
    for (const requiredS of [270, 230, 190, 400]) {
      const fit = fitLegs(legs, requiredS * 1000);
      expect(fit.feasible, String(requiredS)).toBe(true);
      expect(fit.timeScale).toBe(1);
      expect(Math.abs(total(fit.legs) - requiredS * 1000), String(requiredS)).toBeLessThan(FIT_TOLERANCE_MS * 2);
      const [fast, same, wait] = fit.legs;
      // Each leg stays in its range: the taxi between 5 and 25 kt, the fixed leg as it was, the wait within [0, 60] s.
      expect(fast.v0).toBeGreaterThanOrEqual(KT5 - 1e-6);
      expect(fast.v0).toBeLessThanOrEqual(KT25 + 1e-6);
      expect(same.v0).toBeCloseTo(5, 6);
      expect(wait.durationMs).toBeGreaterThanOrEqual(0);
      expect(wait.durationMs).toBeLessThanOrEqual(60_000 + 1e-6);
    }
    // 190 s needs the taxi at its 25 kt ceiling and the wait shortened to what is left.
    const tight = fitLegs(legs, 190_000);
    expect(tight.legs[0].v0).toBeCloseTo(KT25, 6);
    expect(tight.legs[2].durationMs).toBeCloseTo(190_000 - (1000 * tight.legs[0].lengthM) / KT25 - legDurationS(fixed) * 1000, 0);
    expect(tight.factor).toBeGreaterThan(KT25 / 8);
    // 400 s slows the taxi (k < 1) while the wait cannot grow past its 60 s.
    const slow = fitLegs(legs, 400_000);
    expect(slow.factor).toBeLessThan(1);
    expect(slow.legs[2].durationMs).toBeLessThanOrEqual(60_000);
    expect(slow.legs[2].durationMs).toBeGreaterThan(60_000 - FIT_TOLERANCE_MS);
    // A stop stays a stop, a fixed end keeps its speed, a speed outside the range never moves further out.
    expect(scaleSpeed(0, 3, TAXI)).toBe(0);
    expect(scaleSpeed(1, 3, TAXI)).toBeCloseTo(3, 9);
    expect(scaleSpeed(KT5, 0.2, TAXI)).toBeCloseTo(KT5, 9);
    expect(scaleSpeed(40, 2, TAXI)).toBe(40);
    const docking = moveLeg({ phase: 'taxiIn', path: EAST, v0: 6, v1: 0, adjustable: true, speedRange: TAXI, fixedV0: true });
    // 333 s of docking that no factor changes and 125 s of taxi that has to become 87 s.
    const docked = fitLegs([docking, taxi], 420_000).legs[0];
    expect(docked.v0).toBeCloseTo(6, 6);
    expect(docked.v1).toBe(0);
    expect(Object.isFrozen(tight) && Object.isFrozen(tight.legs[0])).toBe(true);
  });

  it('spare time goes to the hold before the lead-in', () => {
    const taxi = moveLeg({ phase: 'taxiIn', path: EAST, v0: 8, v1: 8, adjustable: true, speedRange: TAXI, onGround: true });
    const hold = waitLeg({ phase: 'taxiIn', point: EAST[1], nominalS: 0, durationRange: [0, Infinity] });
    const leadIn = moveLeg({ phase: 'taxiIn', path: ON, v0: 4, v1: 0, adjustable: true, speedRange: TAXI, fixedV0: true });
    const nominal = legDurationS(taxi) + legDurationS(leadIn);
    // With time over the aircraft taxis at its own speeds and waits for the rest.
    const early = fitLegs([taxi, hold, leadIn], (nominal + 60) * 1000);
    expect(early.factor).toBe(1);
    expect(early.feasible).toBe(true);
    expect(early.legs[0].v0).toBeCloseTo(8, 6);
    expect(early.legs[1].durationMs).toBeCloseTo(60_000, 3);
    // Without time over the hold is skipped and the taxi speeds up.
    const late = fitLegs([taxi, hold, leadIn], (nominal - 20) * 1000);
    expect(late.factor).toBeGreaterThan(1);
    expect(late.legs[1].durationMs).toBeLessThan(FIT_TOLERANCE_MS);
    expect(Math.abs(total(late.legs) - (nominal - 20) * 1000)).toBeLessThan(FIT_TOLERANCE_MS * 2);

    // On the synthetic aerodrome: a landing with five minutes to taxi 1.3 km to S1 waits where S1's lead-in begins.
    const layout = createKinematicsLayout();
    const end09 = runwayEnd(layout, '09');
    const s1 = layout.stands.find(stand => stand.code === 'S1');
    const path = routeLandingTaxi(layout, { runwayEnd: end09, fromAlongM: 300, exitNodeId: 'x2', stand: s1, activeRunwayIds: ['09/27'] });
    const perf = PERF_PROFILES.narrow;
    const fit = fitGround(path, 300_000, { perf, toStand: true, standHeadingDeg: s1.headingTrue });
    expect(fit.factor).toBe(1);
    const waits = fit.legs.filter(leg => leg.kind === 'wait');
    expect(waits).toHaveLength(1);
    const [spare] = waits;
    expect(spare.durationRange).toEqual([0, Infinity]);
    expect(spare.durationMs).toBeGreaterThan(60_000);
    // It is where S1's lead-in begins (the rounded corner passes within 15 m of the join), and after it the aircraft
    // only docks.
    expect(haversineM(spare.path.coords[0], s1.leadIn[0])).toBeLessThan(TAXI_MAX_SHIFT_M);
    const after = fit.legs.slice(fit.legs.indexOf(spare) + 1);
    expect(after.every(leg => leg.kind === 'move' && leg.v0 <= perf.taxi.turnMs + 1e-9)).toBe(true);
    expect(Math.abs(total(fit.legs) - 300_000)).toBeLessThan(FIT_TOLERANCE_MS * 2);
  });

  it('an impossible fit reports a timeScale above 1', () => {
    const taxi = moveLeg({ phase: 'taxiIn', path: EAST, v0: 8, v1: 8, adjustable: true, speedRange: TAXI, onGround: true });
    const roll = moveLeg({ phase: 'landing', path: ON, v0: 70, v1: 10, onGround: true });
    // Even at 25 kt the taxi takes 77.8 s and the roll 12.5 s: 60 s is not enough.
    const fastest = (1000 * taxi.lengthM) / KT25 + legDurationS(roll) * 1000;
    const fit = fitLegs([roll, taxi], 60_000);
    expect(fit.feasible).toBe(false);
    expect(fit.timeScale).toBeCloseTo(fastest / 60_000, 3);
    expect(fit.timeScale).toBeGreaterThan(1);
    // Every duration is divided by it, so the legs still last exactly the time required, and every speed is
    // multiplied by it; each leg carries the scale.
    expect(Math.abs(total(fit.legs) - 60_000)).toBeLessThan(1e-6);
    expect(fit.legs[0].v0).toBeCloseTo(70 * fit.timeScale, 6);
    expect(fit.legs[1].v0).toBeCloseTo(KT25 * fit.timeScale, 6);
    expect(fit.legs.every(leg => leg.timeScale === fit.timeScale)).toBe(true);
    // Without compression the legs keep their fastest own time and the scale stays 1.
    const real = fitLegs([roll, taxi], 60_000, { compress: false });
    expect(real.feasible).toBe(false);
    expect(real.timeScale).toBe(1);
    expect(total(real.legs)).toBeCloseTo(fastest, 0);
    // Too much time and no wait to spend it in: the slowest legs are stretched, a scale below 1.
    const stretched = fitLegs([roll, taxi], 1_000_000);
    expect(stretched.feasible).toBe(false);
    expect(stretched.timeScale).toBeLessThan(1);
    expect(Math.abs(total(stretched.legs) - 1_000_000)).toBeLessThan(1e-3);
    // Nothing to do in no time at all.
    expect(fitLegs([], 0)).toMatchObject({ feasible: true, timeScale: 1 });
  });
});

