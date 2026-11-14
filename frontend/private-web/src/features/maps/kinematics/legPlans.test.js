import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout.js';
import { haversineM, pointAlong, pointToPolylineM } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { legDurationS } from './legs.js';
import {
  MIN_START_M, arrivalAirLegs, backOutAir, climbLegs, departureGroundLegs, groundLegs,
} from './legPlans.js';
import { perfFor } from './perfProfiles.js';
import { routeLandingTaxi } from './taxiRoute.js';
import { NM, ftToM, ktToMs, msToKt } from './units.js';

const PERF = perfFor({ typeIcao: 'A320' });
const END_08 = runwayEnd(MDPC_LAYOUT, '08');
const MIA = [-80.287, 25.7959];
const SDQ = [-69.6689, 18.4297];
const A5 = MDPC_LAYOUT.stands.find(stand => stand.code === 'A5');
const seconds = legs => legs.reduce((sum, leg) => sum + legDurationS(leg), 0);

/** Each leg begins where the one before ends, at its speed and height. */
function expectJoined(legs, label) {
  legs.forEach((leg, at) => {
    if (at === 0) return;
    const before = legs[at - 1];
    const end = before.path.coords[before.path.coords.length - 1];
    expect(haversineM(end, leg.path.coords[0]), `${label} leg ${at}`).toBeLessThan(0.01);
    if (before.kind === 'move' && leg.kind === 'move') expect(Math.abs(before.v1 - leg.v0), `${label} leg ${at}`).toBeLessThan(1e-6);
    expect(Math.abs(before.alt1 - leg.alt0), `${label} leg ${at}`).toBeLessThan(1e-6);
  });
}

describe('leg plans', () => {
  it('the arrival in the air descends from the cruise to the touchdown without climbing, and a short sector cruises lower', () => {
    const air = arrivalAirLegs({ origin: MIA, runwayEnd: END_08, perf: PERF });
    expectJoined(air.legs, 'MIA');
    expect(air.legs[0].phase).toBe('enroute');
    expect(air.legs[0].alt0).toBeCloseTo(PERF.cruise.altM, 6);
    expect(air.legs[0].v0).toBeCloseTo(PERF.cruise.speedMs, 6);
    expect(air.legs.every(leg => leg.alt1 <= leg.alt0 + 1e-9 && leg.onGround === false && leg.part === 'air')).toBe(true);
    expect([...new Set(air.legs.map(leg => leg.phase))]).toEqual(['enroute', 'descent', 'approach', 'final']);
    // Over the threshold at 50 ft and the reference speed; the wheels touch 300 m beyond it.
    const elevation = ftToM(END_08.elevationFt);
    const last = air.legs[air.legs.length - 1];
    expect(haversineM(last.path.coords[0], END_08.threshold)).toBeLessThan(0.01);
    expect(last.alt0).toBeCloseTo(elevation + ftToM(50), 6);
    expect(last.alt1).toBeCloseTo(elevation, 6);
    expect(msToKt(last.v1)).toBeCloseTo(137, 6);
    expect(haversineM(last.path.coords[last.path.coords.length - 1], pointAlong(END_08.centerline, 300).p)).toBeLessThan(0.01);
    expect(air.legs.reduce((sum, leg) => sum + leg.lengthM, 0)).toBeCloseTo(air.line.lengthM, 3);
    // Santo Domingo is 90 NM away: the cruise is low enough for the descent to begin halfway to the approach at the
    // earliest.
    const short = arrivalAirLegs({ origin: SDQ, runwayEnd: END_08, perf: PERF });
    expect(short.legs[0].alt0).toBeLessThan(ftToM(20_000));
    const tod = short.legs.find(leg => leg.phase === 'descent');
    const todAlong = short.line.lengthM - short.legs.slice(short.legs.indexOf(tod)).reduce((sum, leg) => sum + leg.lengthM, 0);
    expect(todAlong).toBeGreaterThanOrEqual(short.entryAlongM / 2 - 1);
    expect(todAlong).toBeLessThan(short.entryAlongM);
    // Without an origin it starts 40 NM out, level at the gate's height, at the approach speed.
    const straight = arrivalAirLegs({ origin: null, runwayEnd: END_08, perf: PERF });
    expect(haversineM(straight.legs[0].path.coords[0], END_08.threshold) / NM).toBeCloseTo(40, 3);
    expect(straight.legs[0].phase).toBe('approach');
    expect(msToKt(straight.legs[0].v0)).toBeCloseTo(180, 6);
    // From a fix below the glide path it never climbs back to it; from one on final it flies straight in.
    const low = arrivalAirLegs({ origin: [-68.62, 18.78], runwayEnd: END_08, perf: PERF, start: { altM: ftToM(1_800), speedMs: ktToMs(200) } });
    expect(low.legs[0].alt0).toBeCloseTo(ftToM(1_800), 6);
    expect(low.legs[0].v0).toBeCloseTo(ktToMs(200), 6);
    expect(low.legs.every(leg => leg.alt1 <= leg.alt0 + 1e-9)).toBe(true);
    const onFinal = arrivalAirLegs({ origin: pointAlong([END_08.threshold, [-68.52, 18.53]], 9_000).p, runwayEnd: END_08, perf: PERF, start: { altM: ftToM(1_700), speedMs: ktToMs(150) } });
    expect(onFinal.mode).toBe('final');
    expect(onFinal.legs.map(leg => leg.phase)).toEqual(['final', 'final']);
  });

  it('backing out the air part keeps its own speeds and holds the start 5 NM out at the least', () => {
    const air = arrivalAirLegs({ origin: MIA, runwayEnd: END_08, perf: PERF });
    // 264 s: the air time of an 8-minute demo.
    const eight = backOutAir(air, 264_000);
    expect(eight.limit).toBeNull();
    expect(seconds(eight.legs)).toBeCloseTo(264, 6);
    expect(air.thresholdAlongM - eight.startAlongM).toBeGreaterThan(MIN_START_M);
    expect(haversineM(eight.originPath[eight.originPath.length - 1], eight.legs[0].path.coords[0])).toBeLessThan(0.01);
    // The cut keeps the speeds: where the cut begins the aircraft flies as fast as the whole arrival does there.
    const whole = air.legs.find(leg => leg.phase === eight.legs[0].phase && leg.path.coords.length >= 2);
    expect(eight.legs[0].v0).toBeGreaterThanOrEqual(Math.min(whole.v0, whole.v1) - 1e-6);
    expect(eight.legs.slice(1)).toEqual(air.legs.slice(air.legs.length - eight.legs.length + 1));
    // 30 s: held 5 NM out, so the legs last longer than the time there is.
    const two = backOutAir(air, 30_000);
    expect(two.limit).toBe('minimum');
    expect(air.thresholdAlongM - two.startAlongM).toBeCloseTo(MIN_START_M, 3);
    expect(seconds(two.legs)).toBeGreaterThan(30);
    // More time than the whole flight from the origin takes: it starts at the origin.
    const long = backOutAir(arrivalAirLegs({ origin: SDQ, runwayEnd: END_08, perf: PERF }), 3 * 3_600_000);
    expect(long.limit).toBe('origin');
    expect(long.startAlongM).toBe(0);
    expect(long.originPath).toHaveLength(2);
  });

  it('a far exit brakes at the nominal rate and rolls on, a near one brakes harder, and one out of reach gives nothing', () => {
    const vref = PERF.final.vrefMs;
    const landing = exitNodeId => routeLandingTaxi(MDPC_LAYOUT, {
      runwayEnd: END_08, fromAlongM: 300, exitNodeId, stand: A5, activeRunwayIds: ['08/26'],
    });
    // The end exit, 2.8 km from the touchdown point: braking at 1.8 m/s² to 15 m/s, then rolling on.
    const groundAltM = ftToM(END_08.elevationFt);
    const far = groundLegs(landing('n1956558350'), { perf: PERF, standHeadingDeg: A5.headingTrue, groundAltM });
    const [braking, rolling] = far.legs;
    expect([braking.phase, rolling.phase]).toEqual(['landing', 'landing']);
    expect(braking.v0).toBeCloseTo(vref, 9);
    expect((braking.v0 ** 2 - braking.v1 ** 2) / (2 * braking.lengthM)).toBeCloseTo(PERF.landing.brakingMs2, 1);
    expect(rolling.v0).toBeCloseTo(braking.v1, 9);
    expect(rolling.v1).toBeLessThanOrEqual(PERF.taxi.maxMs);
    expect(braking.adjustable).toBe(false);
    expect(rolling.adjustable && rolling.fixedV0).toBe(true);
    // The rapid exit 1 050 m from it: one roll at the firmer braking that takes, under 2.5 m/s².
    const near = groundLegs(landing('n7592209935'), { perf: PERF, standHeadingDeg: A5.headingTrue, groundAltM });
    const roll = near.legs[0];
    expect(near.legs[1].phase).toBe('taxiIn');
    const deceleration = (roll.v0 ** 2 - roll.v1 ** 2) / (2 * roll.lengthM);
    expect(deceleration).toBeGreaterThan(PERF.landing.brakingMs2);
    expect(deceleration).toBeLessThanOrEqual(PERF.landing.brakingMaxMs2);
    // The taxi docks: it ends stopped at the centre, on the stand heading, slowest on the lead-in.
    const dock = near.legs[near.legs.length - 1];
    expect(dock.v1).toBe(0);
    expect(dock.path.coords[dock.path.coords.length - 1]).toEqual(A5.center);
    expect(Math.abs(((dock.tangentsDeg[dock.tangentsDeg.length - 1] - A5.headingTrue + 540) % 360) - 180)).toBeLessThan(1e-6);
    expect(near.legs.every(leg => leg.alt0 === groundAltM && leg.alt1 === groundAltM && leg.onGround)).toBe(true);
    // Touching down 800 m along leaves 550 m to that exit: more braking than 2.5 m/s².
    const short = routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: END_08, fromAlongM: 800, exitNodeId: 'n7592209935', stand: A5, activeRunwayIds: ['08/26'] });
    expect(groundLegs(short, { perf: PERF })).toBeNull();
  });

  it('the departure on the ground leaves out the engine start and holds without bound in the demo; a real one waits 60 s and 20 s', () => {
    const real = departureGroundLegs({ layout: MDPC_LAYOUT, runwayEnd: END_08, stand: A5, perf: PERF, activeRunwayIds: ['08/26'] });
    const demo = departureGroundLegs({ layout: MDPC_LAYOUT, runwayEnd: END_08, stand: A5, perf: PERF, activeRunwayIds: ['08/26'], demo: true });
    for (const [label, plan] of [['real', real], ['demo', demo]]) {
      expectJoined(plan.legs, label);
      const phases = plan.legs.map(leg => leg.phase).filter((phase, at, all) => phase !== all[at - 1]);
      expect(phases, label).toEqual(['pushback', 'taxiOut', 'takeoff']);
      expect(plan.legs[0].heading).toBe('reverse');
      expect(plan.legs[0].v0).toBe(0);
      expect(plan.holdingPoint.id).toBe('hp-E-08-26');
      // It lifts off on the centreline at 148 kt.
      expect(pointToPolylineM(plan.liftoff, END_08.centerline).distanceM).toBeLessThan(0.05);
      expect(msToKt(plan.legs[plan.legs.length - 1].v1)).toBeCloseTo(148, 6);
      expect(plan.legs.every(leg => leg.part === 'taxiOut')).toBe(true);
    }
    const waits = plan => plan.legs.filter(leg => leg.kind === 'wait');
    expect(waits(real).map(leg => [leg.phase, leg.nominalS, leg.durationRange[1]])).toEqual([['pushback', 60, 60], ['taxiOut', 20, Infinity]]);
    expect(waits(demo).map(leg => [leg.phase, leg.nominalS, leg.durationRange[1]])).toEqual([['taxiOut', 0, Infinity]]);
    // From an apron hold there is no pushback; from a point the taxi starts there, at its speed.
    const hold = MDPC_LAYOUT.apronHolds.find(item => item.id === 'ah-b');
    const fromHold = departureGroundLegs({ layout: MDPC_LAYOUT, runwayEnd: END_08, apronHold: hold, perf: PERF, demo: true });
    expect(fromHold.legs.some(leg => leg.phase === 'pushback')).toBe(false);
    expect(fromHold.legs[0].path.coords[0]).toEqual(hold.p);
    const point = A5.leadIn[0];
    const fromPoint = departureGroundLegs({ layout: MDPC_LAYOUT, runwayEnd: END_08, perf: PERF, fromPoint: { point, headingDeg: 260, speedMs: ktToMs(10) } });
    expect(haversineM(fromPoint.legs[0].path.coords[0], point)).toBeLessThan(0.01);
    expect(fromPoint.legs[0].v0).toBeCloseTo(ktToMs(10), 9);
    expect(departureGroundLegs({ layout: MDPC_LAYOUT, runwayEnd: null, stand: A5, perf: PERF })).toBeNull();
  });

  it('the climb reaches the cruise level and is drawn 250 NM at most', () => {
    const liftoff = pointAlong(END_08.centerline, 1_500).p;
    const legs = climbLegs({ runwayEnd: END_08, liftoff, destination: MIA, perf: PERF });
    expectJoined(legs, 'climb');
    expect(haversineM(legs[0].path.coords[0], liftoff)).toBeLessThan(0.01);
    expect(msToKt(legs[0].v0)).toBeCloseTo(148, 6);
    expect(legs[0].alt0).toBeCloseTo(ftToM(END_08.elevationFt), 6);
    // 1 500 ft above the runway at the end of the first leg, then up to the cruise at the climb rate.
    expect(legs[0].alt1 - legs[0].alt0).toBeCloseTo(ftToM(1_500), 6);
    expect(legs.every(leg => leg.alt1 >= leg.alt0 - 1e-9)).toBe(true);
    const climbing = legs.filter(leg => leg.phase === 'climb');
    expect(climbing[climbing.length - 1].alt1).toBeCloseTo(PERF.cruise.altM, 6);
    expect(legs[legs.length - 1].phase).toBe('enroute');
    const rate = (climbing[1].alt1 - climbing[1].alt0) / legDurationS(climbing[1]);
    expect(rate).toBeCloseTo(PERF.climb.rateMs, 6);
    expect(legs.reduce((sum, leg) => sum + leg.lengthM, 0)).toBeLessThanOrEqual(250 * NM + 1);
    expect(legs.every(leg => leg.part === 'climb' && leg.onGround === false)).toBe(true);
  });
});
