import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { MDPC_LAYOUT } from '../airport/airportLayout.js';
import { destinationPoint, haversineM, initialBearing, measurePolyline, pointToPolylineM } from '../airport/geo.js';
import { demoRunway, runwayEnd, runwayInUse } from '../airport/runwayInUse.js';
import { DEMO_FADE_MS, demoClock, endDemoTrajectory, fitDemoTrajectory } from './demoProfile.js';
import { buildArrivalTrajectory, sampleTrajectory } from './estimator.js';
import { STATUS_MESSAGES, formatTimeScale, kinematicsMessages, timeScaleMessage } from './kinematicsMessages.js';
import { MIN_START_M } from './legPlans.js';
import { GATE_NM, centrelinePoint, landingExitCandidates } from './pathBuilder.js';
import { perfFor } from './perfProfiles.js';
import { departureHoldingPoints, routeLandingTaxi } from './taxiRoute.js';
import { ftToM, ktToMs, msToKt, nmToM } from './units.js';

// The demo flight against the signed Punta Cana layout (contracts 2.3). The clock is built the way the server's
// DemoFlightTimeline builds it and read back through demoClock, as the map reads the flights' demo block.
const parseInstant = value => (typeof value === 'string' ? Date.parse(value) : null);
const T0 = Date.parse('2026-11-14T15:00:00Z');
const iso = ms => (ms === null ? null : new Date(ms).toISOString());
const MIA = [-80.287, 25.7959];
// Santo Domingo, the nearest origin of the server's catalogue (DemoAirports): 74 NM from the 08 threshold.
const SDQ = [-69.6689, 18.4297];
const PERF = perfFor({ typeIcao: 'A320' });
const ACTIVE = MDPC_LAYOUT.stands.filter(stand => !stand.retired);
const END_08 = runwayEnd(MDPC_LAYOUT, '08');
const standOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code);
const holdOf = id => MDPC_LAYOUT.apronHolds.find(hold => hold.id === id);
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const KT25 = ktToMs(25);
const NM_M = nmToM(1);

/**
 * The demo block the API sends for a flight triggered at T0 to reach its stand `minutes` later (DemoFlightTimeline):
 * the taxi-in is 45 % of the time, between 90 s and 5 min, in whole milliseconds; the off-block is null while an
 * imported aircraft waits for its push-back, the scheduled one when nobody imported it, or `offBlockAfterMin` after the
 * on-block; the take-off follows 5 min later and the aircraft vanishes 10 min after that. Cancelled: no departure and
 * vanishing at `cancelAtMs`.
 */
function demoBlock(minutes, { imported = true, offBlockAfterMin = null, cancelAtMs = null } = {}) {
  const appear = T0;
  const onBlock = T0 + minutes * 60_000;
  const span = onBlock - appear;
  const taxiIn = Math.min(Math.max(Math.floor(span * 0.45), 90_000), 300_000, span);
  const scheduledOffBlock = onBlock + 60 * 60_000;
  let offBlock = null;
  if (offBlockAfterMin !== null) offBlock = onBlock + offBlockAfterMin * 60_000;
  else if (!imported) offBlock = scheduledOffBlock;
  const cancelled = cancelAtMs !== null;
  const takeoff = cancelled || offBlock === null ? null : offBlock + 5 * 60_000;
  return {
    demoFlightId: '6b1e2c3d-0000-4000-8000-000000000042',
    state: cancelled ? 'Cancelled' : 'Active',
    phase: 'Approach',
    appearAt: iso(appear),
    touchdownAt: iso(onBlock - taxiIn),
    onBlockAt: iso(onBlock),
    scheduledOffBlockAt: iso(scheduledOffBlock),
    offBlockAt: cancelled ? null : iso(offBlock),
    takeoffAt: iso(takeoff),
    vanishAt: cancelled ? iso(cancelAtMs) : iso(takeoff === null ? null : takeoff + 10 * 60_000),
  };
}

const clockOf = (minutes, options) => demoClock(demoBlock(minutes, options), parseInstant);

function demo(minutes, { code = 'A5', imported = true, layout = MDPC_LAYOUT, counterpart = MIA, ...options } = {}) {
  const clock = clockOf(minutes, { imported, ...options });
  const stand = code === null ? null : layout.stands.find(item => item.code === code);
  return {
    clock,
    trajectory: fitDemoTrajectory({
      demo: clock, imported, stand, counterpart, destination: counterpart, perf: PERF, layout, ...options.fit,
    }),
  };
}

/** The first leg of a phase, or of a kind and phase. */
const firstLeg = (trajectory, phase, kind = null) => trajectory.legs.find(leg => leg.phase === phase && (kind === null || leg.kind === kind));

/**
 * Position, height, heading and speed never jump at a leg boundary (the speed in each part's own time: a compressed
 * part runs its real speeds times its scale); every 250 ms the aircraft moves no faster than it says.
 */
function expectContinuous(trajectory, label) {
  const realSpeed = state => state.gsMs / (trajectory.legs[state.legIndex].timeScale ?? 1);
  trajectory.legs.forEach((leg, at) => {
    if (at === 0 || !Number.isFinite(leg.t0Ms) || leg.t0Ms >= trajectory.endMs) return;
    const before = sampleTrajectory(trajectory, leg.t0Ms - 1);
    const after = sampleTrajectory(trajectory, leg.t0Ms + 1);
    if (!before || !after) return;
    const where = `${label}: leg ${at} (${trajectory.legs[at - 1].phase} → ${leg.phase})`;
    expect(haversineM([before.lon, before.lat], [after.lon, after.lat]), where).toBeLessThanOrEqual(Math.max(before.gsMs, after.gsMs) * 0.002 + 0.01);
    expect(Math.abs(after.altM - before.altM), where).toBeLessThan(0.1);
    expect(angleBetween(before.trackDeg, after.trackDeg), where).toBeLessThan(2);
    expect(Math.abs(realSpeed(after) - realSpeed(before)), where).toBeLessThan(0.5);
  });
  const legs = trajectory.legs;
  const end = Number.isFinite(trajectory.endMs) ? trajectory.endMs - 1 : legs[legs.length - 1].t0Ms + 30_000;
  let previous = sampleTrajectory(trajectory, trajectory.startMs);
  let pointer = 0;
  const phases = new Set([previous.phase]);
  for (let t = trajectory.startMs + 250; t <= end; t += 250) {
    const next = sampleTrajectory(trajectory, t);
    let fastest = Math.max(previous.gsMs, next.gsMs);
    while (pointer < legs.length && legs[pointer].t0Ms <= t - 250) pointer += 1;
    for (let at = pointer; at < legs.length && legs[at].t0Ms < t; at += 1) {
      fastest = Math.max(fastest, sampleTrajectory(trajectory, legs[at].t0Ms)?.gsMs ?? 0);
    }
    expect(haversineM([previous.lon, previous.lat], [next.lon, next.lat]) - fastest * 0.25, `${label} at ${t - T0} ms`)
      .toBeLessThanOrEqual(0.01);
    phases.add(next.phase);
    previous = next;
  }
  return phases;
}

describe('demo flight profile', () => {
  it('every phase samples continuously with no jump at leg boundaries', { timeout: 60_000 }, () => {
    const cases = [];
    for (const minutes of [2, 8, 30]) {
      cases.push([`${minutes} min, imported, A5`, demo(minutes, { offBlockAfterMin: 20 })]);
      cases.push([`${minutes} min, imported, no stand`, demo(minutes, { code: null, offBlockAfterMin: 20 })]);
      cases.push([`${minutes} min, not imported`, demo(minutes, { imported: false })]);
    }
    cases.push(['8 min, imported, B37 (its taxi compressed)', demo(8, { code: 'B37', offBlockAfterMin: 20 })]);
    // With time over in the air: two laps of the hold over the gate, and one circle with the start moved on.
    cases.push(['30 min from SDQ (a hold over the gate)', demo(30, { counterpart: SDQ, offBlockAfterMin: 20 })]);
    cases.push(['20 min without an origin (one circle)', demo(20, { counterpart: null, offBlockAfterMin: 20 })]);
    const seen = new Set();
    for (const [label, { trajectory }] of cases) {
      expectContinuous(trajectory, label).forEach(phase => seen.add(phase));
    }
    // Every phase a demo flight goes through was sampled (from MIA even 30 minutes begin in the descent; from SDQ the
    // 30-minute demo begins en route, over the origin).
    expect([...seen].sort()).toEqual(['approach', 'climb', 'descent', 'enroute', 'final', 'holding', 'landing', 'parked',
      'pushback', 'taxiIn', 'taxiOut', 'takeoff'].sort());
  });

  it('the fitted trajectory hits appearAt, touchdownAt, onBlockAt, offBlockAt, takeoffAt and vanishAt within 1 s', { timeout: 30_000 }, () => {
    for (const [minutes, code] of [[2, 'A5'], [5, 'B24'], [8, 'BN11'], [15, 'A1'], [30, 'B37']]) {
      const { clock, trajectory } = demo(minutes, { code, offBlockAfterMin: 25 });
      const label = `${minutes} min ${code}`;
      // It appears at appearAt, airborne.
      expect(trajectory.startMs, label).toBe(clock.appearAtMs);
      expect(sampleTrajectory(trajectory, clock.appearAtMs - 1), label).toBeNull();
      expect(sampleTrajectory(trajectory, clock.appearAtMs).onGround, label).toBe(false);
      // Wheels on the runway at touchdownAt, 300 m past the 08 threshold.
      const landing = firstLeg(trajectory, 'landing');
      expect(Math.abs(landing.t0Ms - clock.touchdownAtMs), label).toBeLessThan(1_000);
      const wheels = sampleTrajectory(trajectory, clock.touchdownAtMs);
      expect(haversineM([wheels.lon, wheels.lat], END_08.threshold), label).toBeCloseTo(300, 0);
      expect(sampleTrajectory(trajectory, clock.touchdownAtMs - 1_000).onGround, label).toBe(false);
      expect(sampleTrajectory(trajectory, clock.touchdownAtMs + 1_000).onGround, label).toBe(true);
      // At the stand's centre at onBlockAt.
      const stand = standOf(code);
      expect(Math.abs(firstLeg(trajectory, 'parked').t0Ms - clock.onBlockAtMs), label).toBeLessThan(1_000);
      const parked = sampleTrajectory(trajectory, clock.onBlockAtMs);
      expect(haversineM([parked.lon, parked.lat], stand.center), label).toBeLessThan(0.5);
      expect(parked.gsMs, label).toBe(0);
      // Off the stand at offBlockAt, off the ground at takeoffAt.
      expect(Math.abs(firstLeg(trajectory, 'pushback').t0Ms - clock.offBlockAtMs), label).toBeLessThan(1_000);
      expect(Math.abs(firstLeg(trajectory, 'climb').t0Ms - clock.takeoffAtMs), label).toBeLessThan(1_000);
      expect(sampleTrajectory(trajectory, clock.takeoffAtMs - 1_000).onGround, label).toBe(true);
      expect(sampleTrajectory(trajectory, clock.takeoffAtMs + 1_000).onGround, label).toBe(false);
      expect(msToKt(sampleTrajectory(trajectory, clock.takeoffAtMs + 1).gsMs), label).toBeCloseTo(148, 0);
      // Fading from vanishAt, gone DEMO_FADE_MS later.
      expect(trajectory.meta.fade, label).toEqual({ startMs: clock.vanishAtMs, endMs: clock.vanishAtMs + DEMO_FADE_MS });
      expect(sampleTrajectory(trajectory, clock.vanishAtMs).opacity, label).toBe(1);
      expect(sampleTrajectory(trajectory, clock.vanishAtMs + DEMO_FADE_MS / 2).opacity, label).toBeCloseTo(0.5, 6);
      expect(sampleTrajectory(trajectory, clock.vanishAtMs + DEMO_FADE_MS), label).toBeNull();
      expect(trajectory.endMs, label).toBe(clock.vanishAtMs + DEMO_FADE_MS);
    }
    // The clock is read only in order.
    const block = demoBlock(8, { offBlockAfterMin: 20 });
    expect(demoClock(block, parseInstant)).toMatchObject({ state: 'Active', appearAtMs: T0, onBlockAtMs: T0 + 480_000 });
    expect(demoClock({ ...block, touchdownAt: iso(T0 - 1) }, parseInstant)).toBeNull();
    expect(demoClock({ ...block, takeoffAt: null }, parseInstant)).toBeNull();
    expect(demoClock({ ...block, vanishAt: 'not an instant' }, parseInstant)).toBeNull();
    expect(demoClock({ ...block, state: 'Paused' }, parseInstant)).toBeNull();
    expect(demoClock(null, parseInstant)).toBeNull();
  });

  it('for minutesToOnBlock = 8 every active stand of MDPC is reached on runway 08 with a fitted taxi speed of 25 kt or less', { timeout: 120_000 }, () => {
    // The server's clock for an 8-minute demo: 45 % of 480 s is a 216 s taxi-in.
    const clock = clockOf(8);
    expect(clock.onBlockAtMs - clock.touchdownAtMs).toBe(216_000);
    expect(ACTIVE).toHaveLength(41);
    const vref = PERF.final.vrefMs;
    const minRollM = (vref * vref - PERF.landing.exitSpeedMs ** 2) / (2 * PERF.landing.brakingMaxMs2);
    // The exits a landing on 08 can take and stop for: the rapid exits 1 349 m and 2 231 m along. The others past the
    // touchdown point turn more than 90°: n7592209929 and n7592262113, built for 26, turn 149° and 164° back towards the
    // threshold, and the right-angle exit at the far end reads 92°.
    const exits = landingExitCandidates(MDPC_LAYOUT, END_08, { minRollM });
    expect(exits.map(exit => exit.nodeId)).toEqual(['n7592209935', 'n7592262104']);
    const compressed = [];
    for (const stand of ACTIVE) {
      const trajectory = fitDemoTrajectory({ demo: clock, imported: true, stand, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT });
      const label = stand.code;
      expect(trajectory.meta.runwayIdent, label).toBe('08');
      expect(trajectory.meta.departureRunwayIdent, label).toBe('08');
      expect(exits.map(exit => exit.nodeId), label).toContain(trajectory.meta.exitNodeId);
      const taxi = trajectory.legs.filter(leg => leg.part === 'taxiIn' && leg.kind === 'move' && leg.phase === 'taxiIn');
      const scale = trajectory.meta.parts.taxiIn.timeScale;
      // The fitted taxi speed: what the fit gives each taxi leg, before any time compression.
      const fitted = Math.max(...taxi.map(leg => Math.max(leg.v0, leg.v1))) / scale;
      expect(fitted, label).toBeLessThanOrEqual(KT25 + 1e-9);
      // And what the map shows: sampled every half second from touchdown to on-block.
      let shown = 0;
      for (let t = clock.touchdownAtMs; t <= clock.onBlockAtMs; t += 500) {
        const state = sampleTrajectory(trajectory, t);
        if (state.phase === 'taxiIn') shown = Math.max(shown, state.gsMs);
      }
      if (scale > 1) {
        compressed.push({ code: stand.code, scale, shownKt: msToKt(shown) });
        expect(trajectory.scaledParts, label).toContain('taxiIn');
      } else {
        expect(trajectory.scaledParts, label).not.toContain('taxiIn');
        expect(shown, label).toBeLessThanOrEqual(KT25 + 1e-9);
      }
    }
    // Every stand but B36 and B37 is reached at real speeds. Those two are not: the server's 216 s taxi-in is too
    // short for them, so the map compresses their ground part by under 2 % and the data block says so with the real
    // scale, «Demo acelerada ×1,01» and «×1,02» (two decimals below ×1,1, never a rounded-up ×1,1). The orchestrator's
    // decision of 2026-11-14: the server's taxi-in share (0.45) stays, ADR-0043 records this as a known limit, and the
    // presentation guide fires its demo flight with 10 minutes, where every active stand fits at real speeds.
    expect(compressed.map(item => item.code)).toEqual(['B36', 'B37']);
    expect(compressed.map(item => [item.code, formatTimeScale(item.scale, 'es')])).toEqual([['B36', '×1,01'], ['B37', '×1,02']]);
    const es = createTranslator(kinematicsMessages, 'es');
    expect(es(timeScaleMessage(compressed[1].scale), { factor: formatTimeScale(compressed[1].scale, 'es') }))
      .toBe('Demo acelerada ×1,02');
    const brake = PERF.landing.brakingMaxMs2;
    const brakeM = (vref * vref - KT25 * KT25) / (2 * brake);
    const stopM = (KT25 * KT25) / (2 * brake);
    for (const { code, scale, shownKt } of compressed) {
      expect(scale, code).toBeLessThan(1.02);
      expect(shownKt, code).toBeLessThan(25.5);
      for (const exit of exits) {
        const label = `${code} ${exit.nodeId}`;
        const path = routeLandingTaxi(MDPC_LAYOUT, {
          runwayEnd: END_08, fromAlongM: 300, exitNodeId: exit.nodeId, stand: standOf(code), activeRunwayIds: ['08/26'],
        });
        const rollM = exit.alongM - 300;
        const taxiM = path.lengthM - rollM;
        // The fastest ground run this profile can be fitted to: its roll is one deceleration from Vref, at best down to
        // 25 kt at the exit, and at best every taxi leg runs at 25 kt.
        const profileS = (2 * rollM) / (vref + KT25) + taxiM / KT25;
        expect(profileS, label).toBeGreaterThan(216);
        // Nor could any roll on that route within the profile's limits: Vref held after the touchdown and the maximum
        // braking (2.5 m/s²) down to 25 kt at the exit, 25 kt from there, and the same braking to stop at the centre.
        expect(rollM, label).toBeGreaterThanOrEqual(brakeM);
        const fastestS = (rollM - brakeM) / vref + (vref - KT25) / brake + (taxiM - stopM) / KT25 + KT25 / brake;
        expect(fastestS, label).toBeGreaterThan(216);
      }
    }
    // With 222 s of taxi-in (46.25 % of the 8 minutes) every active stand is reached at real speeds, and so it is with
    // the 10 minutes the presentation guide fires (270 s of taxi-in).
    const longer = demoClock({ ...demoBlock(8), touchdownAt: iso(clock.onBlockAtMs - 222_000) }, parseInstant);
    for (const [label, demoClockOf] of [['222 s', longer], ['10 min', clockOf(10)]]) {
      const stillScaled = ACTIVE.filter(stand => fitDemoTrajectory({
        demo: demoClockOf, imported: true, stand, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT,
      }).scaledParts.length > 0);
      expect(stillScaled.map(stand => stand.code), label).toEqual([]);
    }
  });

  it('the 5-minute taxi-out of every active stand runs at 25 kt or less, terminal A from an intersection where the full length does not fit', { timeout: 120_000 }, () => {
    // The server's clock: PUJ's take-off 5 minutes after the off-block.
    const clock = clockOf(8, { offBlockAfterMin: 20 });
    expect(clock.takeoffAtMs - clock.offBlockAtMs).toBe(300_000);
    const holds = departureHoldingPoints(MDPC_LAYOUT, END_08);
    // The holding points of 08 from its threshold: E and the unnamed lane beside it leave the whole runway; H is an
    // intersection 1.5 km along; A and P are too far along for any take-off roll of the profiles.
    expect(holds.map(item => item.hold.id)).toEqual(['hp-E-08-26', 'hp-w812822709-08-26', 'hp-H-08-26', 'hp-A-08-26', 'hp-P-08-26']);
    const shownKt = trajectory => {
      let fastest = 0;
      for (let t = clock.offBlockAtMs; t <= clock.takeoffAtMs; t += 500) {
        const state = sampleTrajectory(trajectory, t);
        if (state.phase === 'taxiOut') fastest = Math.max(fastest, state.gsMs);
      }
      return msToKt(fastest);
    };
    const byHold = {};
    for (const stand of ACTIVE) {
      const trajectory = fitDemoTrajectory({
        demo: clock, imported: true, stand, counterpart: MIA, destination: MIA, perf: PERF, layout: MDPC_LAYOUT,
      });
      const label = stand.code;
      // Real time on the ground: nothing of the departure is scaled, and no taxi leg goes faster than 25 kt.
      expect(trajectory.meta.parts.taxiOut.timeScale, label).toBe(1);
      expect(trajectory.scaledParts, label).not.toContain('taxiOut');
      const taxi = trajectory.legs.filter(leg => leg.part === 'taxiOut' && leg.kind === 'move' && leg.phase === 'taxiOut');
      expect(Math.max(...taxi.map(leg => Math.max(leg.v0, leg.v1))), label).toBeLessThanOrEqual(KT25 + 1e-9);
      expect(shownKt(trajectory), label).toBeLessThanOrEqual(25 + 1e-6);
      // It lifts off at takeoffAt on the 08 centreline, inside the runway.
      const climb = firstLeg(trajectory, 'climb');
      expect(Math.abs(climb.t0Ms - clock.takeoffAtMs), label).toBeLessThan(1_000);
      const roll = firstLeg(trajectory, 'takeoff');
      const liftoff = roll.path.coords[roll.path.coords.length - 1];
      expect(pointToPolylineM(liftoff, END_08.centerline).distanceM, label).toBeLessThan(0.5);
      expect(haversineM(liftoff, END_08.threshold), label).toBeLessThan(END_08.lengthM);
      (byHold[trajectory.meta.departureHoldingPointId] ??= []).push(stand.code);
    }
    // Terminal A's farthest stands do not fit the full length in 5 minutes at 25 kt: A1, A2 and AN1 depart from the
    // intersection H, A3 and AN2 from the lane beside the threshold (ADR-0043). Every other stand takes E.
    expect(byHold['hp-H-08-26']).toEqual(['A1', 'A2', 'AN1']);
    expect(byHold['hp-w812822709-08-26']).toEqual(['A3', 'AN2']);
    expect(byHold['hp-E-08-26']).toHaveLength(ACTIVE.length - 5);
    expect(Object.keys(byHold).sort()).toEqual(['hp-E-08-26', 'hp-H-08-26', 'hp-w812822709-08-26']);
    // The full length is tried first: from H it would not have been needed for a stand of terminal B.
    expect(byHold['hp-E-08-26']).toContain('B20');
    // A flight nobody imported leaves its terminal's apron hold at its scheduled time, by the full length, in real time.
    const scheduled = clockOf(8, { imported: false });
    for (const hold of MDPC_LAYOUT.apronHolds) {
      const trajectory = fitDemoTrajectory({
        demo: scheduled, imported: false, apronHold: hold, counterpart: MIA, destination: MIA, perf: PERF, layout: MDPC_LAYOUT,
      });
      expect(trajectory.meta.parts.taxiOut.timeScale, hold.id).toBe(1);
      expect(trajectory.meta.departureHoldingPointId, hold.id).toBe('hp-E-08-26');
    }
  });

  it('for 8, 15 and 30 minutes the approach starts as far back as real speeds need and timeScale is 1', { timeout: 30_000 }, () => {
    const starts = [];
    for (const minutes of [8, 15, 30]) {
      const { clock, trajectory } = demo(minutes, { offBlockAfterMin: 20 });
      expect(trajectory.timeScale, String(minutes)).toBe(1);
      expect(trajectory.scaledParts, String(minutes)).toEqual([]);
      expect(trajectory.meta.parts.air.timeScale).toBe(1);
      expect(trajectory.meta.airLimit).toBeNull();
      expect(trajectory.meta.airHold).toBeNull();
      expect(timeScaleMessage(trajectory.timeScale)).toBeNull();
      // The nominal arrival from MIA that lands at the same instant is exactly there when the demo appears: the demo
      // flies the same legs at the same speeds, only cut where its time begins.
      const nominal = buildArrivalTrajectory({
        times: { actualAtMs: clock.touchdownAtMs, actualKind: 'Runway', estimatedAtMs: clock.onBlockAtMs },
        origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand: standOf('A5'), perf: PERF,
      });
      for (const t of [clock.appearAtMs, (clock.appearAtMs + clock.touchdownAtMs) / 2, clock.touchdownAtMs - 30_000]) {
        const shown = sampleTrajectory(trajectory, t);
        const real = sampleTrajectory(nominal, t);
        expect(haversineM([shown.lon, shown.lat], [real.lon, real.lat]), `${minutes} min`).toBeLessThan(1);
        expect(shown.gsMs).toBeCloseTo(real.gsMs, 3);
        expect(shown.altM).toBeCloseTo(real.altM, 2);
        expect(shown.phase).toBe(real.phase);
      }
      const first = sampleTrajectory(trajectory, clock.appearAtMs);
      starts.push({ minutes, nm: haversineM([first.lon, first.lat], END_08.threshold) / nmToM(1), first });
    }
    // Further out the longer the demo: about 12 NM on the approach at 180 kt for 8 minutes, descending in the region
    // view for 30.
    expect(starts[0].nm).toBeGreaterThan(5);
    expect(starts[0].nm).toBeLessThan(15);
    expect(msToKt(starts[0].first.gsMs)).toBeCloseTo(180, 0);
    expect(starts[1].nm).toBeGreaterThan(starts[0].nm + 10);
    expect(starts[2].nm).toBeGreaterThan(60);
    expect(starts[2].first.phase).toBe('descent');
    expect(starts[2].first.altM).toBeGreaterThan(ftToM(10_000));
  });

  it('when even the whole path from the origin is shorter, the time over is flown in a hold over the gate at real speeds', { timeout: 60_000 }, () => {
    const gate = centrelinePoint(END_08, -GATE_NM * NM_M);
    // From Santo Domingo the whole flight takes 17 minutes at these speeds, without an origin (40 NM out) 14: a demo of
    // 25 or 30 minutes has more time than that in the air (its taxi-in is 5 minutes). 22.5 minutes from SDQ and 20
    // without an origin leave less time over than one circle of the hold lasts.
    for (const [label, counterpart, minutes, laps] of [
      ['SDQ 30 min', SDQ, 30, 2], ['SDQ 25 min', SDQ, 25, 1], ['SDQ 22.5 min', SDQ, 22.5, 1],
      ['no origin 30 min', null, 30, 3], ['no origin 20 min', null, 20, 1],
    ]) {
      const { clock, trajectory } = demo(minutes, { counterpart, offBlockAfterMin: 20 });
      // Every part in real time: nothing is scaled and the data block says nothing of it.
      expect(trajectory.meta.airLimit, label).toBe('origin');
      expect(trajectory.meta.parts.air, label).toEqual({ timeScale: 1, factor: 1 });
      expect(trajectory.scaledParts, label).toEqual([]);
      expect(trajectory.timeScale, label).toBe(1);
      expect(timeScaleMessage(trajectory.timeScale), label).toBeNull();
      // On time, on the 08 final at the reference speed, and wheels on the runway at touchdownAt.
      expect(msToKt(sampleTrajectory(trajectory, clock.touchdownAtMs - 1).gsMs), label).toBeCloseTo(137, 0);
      expect(Math.abs(firstLeg(trajectory, 'landing').t0Ms - clock.touchdownAtMs), label).toBeLessThan(1_000);
      // The hold: laps over the gate at the approach speed, level at the gate's height, in phase 'approach'.
      const hold = trajectory.meta.airHold;
      expect(hold.laps, label).toBe(laps);
      expect(haversineM(hold.fix, gate), label).toBeLessThan(0.01);
      expect(msToKt(hold.speedMs), label).toBeCloseTo(180, 6);
      const holding = trajectory.legs.find(leg => leg.part === 'air' && Math.abs(leg.lengthM - hold.lengthM) < 1e-6);
      expect(holding.durationMs / 1000, label).toBeCloseTo(hold.durationS, 6);
      for (const share of [0.01, 0.37, 0.5, 0.99]) {
        const state = sampleTrajectory(trajectory, holding.t0Ms + share * holding.durationMs);
        expect(state.phase, label).toBe('approach');
        expect(msToKt(state.gsMs), label).toBeCloseTo(180, 3);
        expect(state.altM, label).toBeCloseTo(hold.altM, 6);
        expect(haversineM([state.lon, state.lat], gate), label).toBeLessThan(hold.legM + 2 * hold.radiusM + 1);
      }
      // Everything else flies as the arrival without a hold does: the hold's time later before it, at the same instant
      // after it.
      const nominal = buildArrivalTrajectory({
        times: { actualAtMs: clock.touchdownAtMs, actualKind: 'Runway', estimatedAtMs: clock.onBlockAtMs },
        origin: counterpart, layout: MDPC_LAYOUT, runwayEnd: END_08, stand: standOf('A5'), perf: PERF,
      });
      const before = [clock.appearAtMs, (clock.appearAtMs + holding.t0Ms) / 2, holding.t0Ms - 1_000].map(t => [t, t + holding.durationMs]);
      const after = [holding.t1Ms + 1_000, (holding.t1Ms + clock.touchdownAtMs) / 2, clock.touchdownAtMs - 1_000].map(t => [t, t]);
      for (const [t, at] of [...before, ...after]) {
        const shown = sampleTrajectory(trajectory, t);
        const real = sampleTrajectory(nominal, at);
        expect(haversineM([shown.lon, shown.lat], [real.lon, real.lat]), `${label} at ${t - T0} ms`).toBeLessThan(1);
        expect(shown.gsMs, label).toBeCloseTo(real.gsMs, 3);
        expect(shown.altM, label).toBeCloseTo(real.altM, 2);
      }
      // It appears at the origin, or a little along its path when one circle is more than the time over.
      const first = sampleTrajectory(trajectory, clock.appearAtMs);
      const origin = counterpart ?? centrelinePoint(END_08, -40 * NM_M);
      if (hold.legM > 0) expect(haversineM([first.lon, first.lat], origin), label).toBeLessThan(1);
      else expect(haversineM([first.lon, first.lat], origin), label).toBeGreaterThan(NM_M);
      const originPath = trajectory.meta.originPath;
      expect(haversineM(originPath[originPath.length - 1], [first.lon, first.lat]), label).toBeLessThan(1);
    }
    // Santo Domingo appears at its cruise level and speed.
    const { clock, trajectory } = demo(30, { counterpart: SDQ });
    expect(msToKt(sampleTrajectory(trajectory, clock.appearAtMs).gsMs)).toBeCloseTo(450, 3);
  });

  it('a part that has to run slower than real time is named and says so', () => {
    // A made-up origin 15.5 NM out, just off the extended centreline, and 10.6 minutes to the stand: the whole path
    // lasts less than the 350 s in the air, and the time over is less than one circle of the hold, which there is no
    // room to fly before the gate.
    const near = destinationPoint(END_08.threshold, END_08.headingTrue + 182, 15.5 * NM_M);
    const { clock, trajectory } = demo(10.6, { counterpart: near });
    expect(clock.touchdownAtMs - clock.appearAtMs).toBe(349_800);
    expect(trajectory.meta.airLimit).toBe('origin');
    expect(trajectory.meta.airHold).toBeNull();
    const scale = trajectory.meta.parts.air.timeScale;
    expect(scale).toBeLessThan(1);
    expect(trajectory.scaledParts).toEqual(['air']);
    expect(trajectory.timeScale).toBe(scale);
    expect(trajectory.legs.filter(leg => leg.part === 'air').every(leg => leg.timeScale === scale)).toBe(true);
    // Still on time, at its real speeds times the scale, and the data block names it.
    expect(Math.abs(firstLeg(trajectory, 'landing').t0Ms - clock.touchdownAtMs)).toBeLessThan(1_000);
    expect(msToKt(sampleTrajectory(trajectory, clock.touchdownAtMs - 1).gsMs) / scale).toBeCloseTo(137, 0);
    const es = createTranslator(kinematicsMessages, 'es');
    // Slower by under a tenth, so with two decimals (kinematicsMessages.js: formatTimeScale).
    expect(scale).toBeGreaterThan(0.9);
    expect(es(timeScaleMessage(trajectory.timeScale), { factor: formatTimeScale(trajectory.timeScale, 'es') }))
      .toMatch(/^Demo ralentizada ×0,\d\d$/u);
  });

  it('for 2 and 3 minutes the approach starts 5 NM out and timeScale is above 1', () => {
    for (const minutes of [2, 3]) {
      const { clock, trajectory } = demo(minutes);
      const first = sampleTrajectory(trajectory, clock.appearAtMs);
      // 5 NM out on the 08 final, on the glide path.
      expect(trajectory.meta.airLimit).toBe('minimum');
      expect(haversineM([first.lon, first.lat], END_08.threshold) / nmToM(1)).toBeCloseTo(MIN_START_M / nmToM(1), 3);
      expect(first.phase).toBe('final');
      expect((first.altM - ftToM(END_08.elevationFt)) / ftToM(1)).toBeCloseTo(50 + 5 * 318.4, -1);
      // The air part had to be compressed, and it says by how much.
      expect(trajectory.scaledParts).toContain('air');
      const scale = trajectory.meta.parts.air.timeScale;
      expect(scale).toBeGreaterThan(1);
      expect(trajectory.timeScale).toBeGreaterThanOrEqual(scale);
      expect(timeScaleMessage(trajectory.timeScale)).toBe('demo.accelerated');
      expect(trajectory.legs.filter(leg => leg.part === 'air').every(leg => leg.timeScale === scale)).toBe(true);
      // Still on time: it touches down at touchdownAt, so its speeds on the map are the real ones times the scale.
      expect(Math.abs(firstLeg(trajectory, 'landing').t0Ms - clock.touchdownAtMs)).toBeLessThan(1_000);
      expect(msToKt(sampleTrajectory(trajectory, clock.touchdownAtMs - 1).gsMs) / scale).toBeCloseTo(137, 0);
    }
    // 2 minutes leave 30 s in the air, 3 minutes 90 s: the shorter one is compressed more.
    const two = demo(2).trajectory.meta.parts.air.timeScale;
    const three = demo(3).trajectory.meta.parts.air.timeScale;
    expect(two).toBeGreaterThan(three);
    expect(formatTimeScale(three, 'es')).toMatch(/^×\d,\d$/u);
  });

  it('a demo flight lands and departs on 08 whatever the wind or live arrivals', () => {
    // Real traffic would use 26 with a westerly wind or with arrivals seen on it; the demo flight carries 08.
    const westerly = { directionDeg: 255, speedMs: 8 };
    const on26 = [{ trackDeg: 254 }, { trackDeg: 253 }];
    expect(runwayInUse({ wind: westerly, layout: MDPC_LAYOUT }).arrival).toBe('26');
    expect(runwayInUse({ recentLiveArrivals: on26, layout: MDPC_LAYOUT }).arrival).toBe('26');
    for (const inputs of [{ wind: westerly }, { recentLiveArrivals: on26 }, { wind: westerly, recentLiveArrivals: on26 }, {}]) {
      expect(runwayInUse({ ...inputs, layout: MDPC_LAYOUT, flightRunway: demoRunway(MDPC_LAYOUT) }))
        .toEqual({ arrival: '08', departure: '08', source: 'flight' });
    }
    const { clock, trajectory } = demo(8, { offBlockAfterMin: 20 });
    expect(trajectory.meta.runwayIdent).toBe('08');
    expect(trajectory.meta.departureRunwayIdent).toBe('08');
    // It rolls out along 08 and takes off along it, on its centreline.
    const rolling = [clock.touchdownAtMs + 3_000, clock.touchdownAtMs + 6_000].map(t => sampleTrajectory(trajectory, t));
    expect(angleBetween(initialBearing([rolling[0].lon, rolling[0].lat], [rolling[1].lon, rolling[1].lat]), END_08.headingTrue)).toBeLessThan(0.5);
    expect(pointToPolylineM([rolling[1].lon, rolling[1].lat], END_08.centerline).distanceM).toBeLessThan(0.5);
    const takeoff = firstLeg(trajectory, 'takeoff');
    const run = [takeoff.t0Ms + 5_000, takeoff.t1Ms - 1_000].map(t => sampleTrajectory(trajectory, t));
    expect(angleBetween(initialBearing([run[0].lon, run[0].lat], [run[1].lon, run[1].lat]), END_08.headingTrue)).toBeLessThan(0.5);
    expect(pointToPolylineM([run[1].lon, run[1].lat], END_08.centerline).distanceM).toBeLessThan(0.5);
    // The layout's preference is the only input: a copy that prefers 26 lands the demo on 26.
    const prefers26 = structuredClone(MDPC_LAYOUT);
    prefers26.operations.preferred = { arrival: '26', departure: '26' };
    const other = fitDemoTrajectory({ demo: clock, imported: true, stand: standOf('A5'), counterpart: MIA, perf: PERF, layout: prefers26 });
    expect(other.meta.runwayIdent).toBe('26');
  });

  it('without a stand the demo taxis to the apron hold and holds there, awaiting a stand and not imported', () => {
    // Not imported yet: the suggested stand is not used; it waits at terminal A's apron hold.
    const clock = clockOf(8, { imported: false });
    const hold = holdOf('ah-a');
    const notImported = fitDemoTrajectory({
      demo: clock, imported: false, stand: standOf('A5'), apronHold: hold, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT,
    });
    expect(notImported.meta.standCode).toBeNull();
    expect(notImported.meta.apronHoldId).toBe('ah-a');
    expect(notImported.meta.statusKey).toBe('awaitingStandNotImported');
    for (const t of [clock.onBlockAtMs, clock.onBlockAtMs + 600_000, clock.scheduledOffBlockAtMs - 1]) {
      const state = sampleTrajectory(notImported, t);
      expect(state.phase).toBe('holding');
      expect(state.statusKey).toBe('awaitingStandNotImported');
      expect(state.gsMs).toBe(0);
      expect(haversineM([state.lon, state.lat], hold.p)).toBeLessThan(0.5);
    }
    // It got there taxiing, at real speed: the time over is spent at the hold, not taxiing slower.
    const arrived = notImported.legs.find(leg => leg.phase === 'holding');
    expect(arrived.t0Ms).toBeLessThan(clock.onBlockAtMs);
    expect(notImported.scaledParts).toEqual([]);
    // Nobody imported it, so it leaves at its scheduled time, from the hold and without a pushback.
    expect(sampleTrajectory(notImported, clock.scheduledOffBlockAtMs + 30_000).phase).toBe('taxiOut');
    expect(notImported.legs.some(leg => leg.phase === 'pushback')).toBe(false);
    // The words on screen.
    const es = createTranslator(kinematicsMessages, 'es');
    expect(es(STATUS_MESSAGES.awaitingStandNotImported)).toBe('Esperando posición · sin importar');
    // Imported without a stand: the same hold, awaiting a stand. Without a hold named, the one its taxi reaches.
    const imported = fitDemoTrajectory({ demo: clockOf(8), imported: true, stand: null, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT });
    const waiting = sampleTrajectory(imported, clockOf(8).onBlockAtMs + 60_000);
    expect(waiting.statusKey).toBe('awaitingStand');
    expect(es(STATUS_MESSAGES[waiting.statusKey])).toBe('Esperando posición');
    expect(MDPC_LAYOUT.apronHolds.map(item => item.id)).toContain(imported.meta.apronHoldId);
    expect(imported.endMs).toBe(Infinity);
  });

  it('given a stand later, the new trajectory starts where the old one is at that instant and reaches the stand', { timeout: 30_000 }, () => {
    const clock = clockOf(8, { imported: false });
    const hold = holdOf('ah-a');
    const old = fitDemoTrajectory({ demo: clock, imported: false, apronHold: hold, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT });
    const stand = standOf('A5');
    const taxiing = firstLeg(old, 'taxiIn', 'move');
    const holding = old.legs.find(leg => leg.phase === 'holding');
    const moments = [
      ['in the air', clock.touchdownAtMs - 60_000],
      ['rolling out', clock.touchdownAtMs + 4_000],
      ['taxiing', (taxiing.t0Ms + holding.t0Ms) / 2],
      ['holding', holding.t0Ms + 20_000],
      ['after on-block', clock.onBlockAtMs + 120_000],
    ];
    for (const [label, atMs] of moments) {
      const later = fitDemoTrajectory({
        demo: clock, imported: true, stand, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT, continueFrom: { trajectory: old, atMs },
      });
      // Up to that instant nothing changes; from there it goes on without a jump.
      for (const t of [old.startMs + 1_000, atMs - 1_000, atMs]) {
        const before = sampleTrajectory(old, t);
        const now = sampleTrajectory(later, t);
        expect(haversineM([before.lon, before.lat], [now.lon, now.lat]), `${label} at ${t - atMs} ms`).toBeLessThan(0.01);
        expect(angleBetween(before.trackDeg, now.trackDeg), label).toBeLessThan(0.5);
        expect(Math.abs(before.gsMs - now.gsMs), label).toBeLessThan(0.01);
      }
      expectContinuous(later, label);
      // It reaches the stand: on time when there was time to, else as soon as it can at its own speed.
      const parked = firstLeg(later, 'parked');
      expect(parked, label).toBeDefined();
      const at = sampleTrajectory(later, parked.t0Ms + 1_000);
      expect(haversineM([at.lon, at.lat], stand.center), label).toBeLessThan(0.5);
      expect(angleBetween(at.trackDeg, stand.headingTrue), label).toBeLessThan(0.5);
      if (atMs < clock.onBlockAtMs - 120_000) expect(Math.abs(parked.t0Ms - clock.onBlockAtMs), label).toBeLessThan(1_000);
      expect(later.meta.standCode).toBe('A5');
      expect(later.meta.statusKey).toBeNull();
    }
  });

  it('an imported demo aircraft waits on its stand while offBlockAt is null and lifts off at takeoffAt once it is known', () => {
    const stand = standOf('B24');
    const waiting = clockOf(8);
    expect(waiting.offBlockAtMs).toBeNull();
    const parked = fitDemoTrajectory({ demo: waiting, imported: true, stand, counterpart: MIA, destination: MIA, perf: PERF, layout: MDPC_LAYOUT });
    expect(parked.endMs).toBe(Infinity);
    expect(parked.legs.some(leg => leg.part === 'taxiOut')).toBe(false);
    for (const later of [0, 3_600_000, 2 * 3_600_000 + 1]) {
      const state = sampleTrajectory(parked, waiting.scheduledOffBlockAtMs + later);
      expect(state.phase).toBe('parked');
      expect(haversineM([state.lon, state.lat], stand.center)).toBeLessThan(0.5);
    }
    // PUSHBACK at 40 min: the server now sends the off-block, take-off and vanish instants.
    const pushed = clockOf(8, { offBlockAfterMin: 40 });
    const leaving = fitDemoTrajectory({ demo: pushed, imported: true, stand, counterpart: MIA, destination: MIA, perf: PERF, layout: MDPC_LAYOUT });
    expect(sampleTrajectory(leaving, pushed.offBlockAtMs - 1_000).phase).toBe('parked');
    expect(sampleTrajectory(leaving, pushed.offBlockAtMs + 1_000).phase).toBe('pushback');
    const climb = firstLeg(leaving, 'climb');
    expect(Math.abs(climb.t0Ms - pushed.takeoffAtMs)).toBeLessThan(1_000);
    expect(sampleTrajectory(leaving, pushed.takeoffAtMs + 30_000).altM).toBeGreaterThan(ftToM(END_08.elevationFt) + 100);
    // Up to the push-back the two trajectories agree.
    const before = sampleTrajectory(parked, pushed.offBlockAtMs - 1);
    const after = sampleTrajectory(leaving, pushed.offBlockAtMs - 1);
    expect([after.lon, after.lat]).toEqual([before.lon, before.lat]);
  });

  it('a cancelled demo fades out from vanishAt and says it was cancelled by the provider', () => {
    const es = createTranslator(kinematicsMessages, 'es');
    const en = createTranslator(kinematicsMessages, 'en');
    const approachClock = clockOf(8, { cancelAtMs: T0 + 120_000 });
    expect(approachClock.state).toBe('Cancelled');
    for (const [label, clock] of [['on approach', approachClock], ['holding', clockOf(8, { imported: false, cancelAtMs: T0 + 900_000 })]]) {
      const trajectory = fitDemoTrajectory({ demo: clock, imported: false, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT });
      const cancelAt = clock.vanishAtMs;
      expect(trajectory.meta.statusKey, label).toBe('cancelledByProvider');
      expect(trajectory.endMs, label).toBe(cancelAt + DEMO_FADE_MS);
      const before = sampleTrajectory(trajectory, cancelAt - 1_000);
      expect(before.opacity, label).toBe(1);
      expect(before.statusKey === 'cancelledByProvider', label).toBe(false);
      const fading = sampleTrajectory(trajectory, cancelAt + 2_000);
      expect(fading.opacity, label).toBeCloseTo(0.75, 6);
      expect(fading.statusKey, label).toBe('cancelledByProvider');
      expect(es(STATUS_MESSAGES[fading.statusKey])).toBe('Cancelado por el proveedor (demo)');
      expect(en(STATUS_MESSAGES[fading.statusKey])).toBe('Cancelled by the provider (demo)');
      expect(sampleTrajectory(trajectory, cancelAt + DEMO_FADE_MS), label).toBeNull();
      expect(sampleTrajectory(trajectory, cancelAt + 3_600_000), label).toBeNull();
    }
    // Cancelled on approach, it keeps flying while it fades; it never lands.
    const trajectory = fitDemoTrajectory({ demo: approachClock, imported: false, counterpart: MIA, perf: PERF, layout: MDPC_LAYOUT });
    const a = sampleTrajectory(trajectory, approachClock.vanishAtMs + 1_000);
    const b = sampleTrajectory(trajectory, approachClock.vanishAtMs + 6_000);
    expect(haversineM([a.lon, a.lat], [b.lon, b.lat])).toBeGreaterThan(200);
    expect(b.onGround).toBe(false);
    // A cancel instant before the flight appeared is not a clock.
    expect(demoClock({ ...demoBlock(8, { cancelAtMs: T0 + 120_000 }), vanishAt: iso(T0 - 1) }, parseInstant)).toBeNull();
  });

  it('cancelled after it left, a demo nobody imported fades out where it is, not back at the apron hold', { timeout: 30_000 }, () => {
    const hold = holdOf('ah-a');
    const fit = (clock, continueFrom = null) => fitDemoTrajectory({
      demo: clock, imported: false, apronHold: hold, counterpart: MIA, destination: MIA, perf: PERF, layout: MDPC_LAYOUT,
      continueFrom,
    });
    // Nobody imported it: it left the hold at its scheduled off-block and took off 5 minutes later.
    const active = clockOf(8, { imported: false });
    const old = fit(active);
    for (const [label, cancelAtMs, phase] of [
      ['taxiing to the runway', active.scheduledOffBlockAtMs + 120_000, 'taxiOut'],
      ['climbing', active.takeoffAtMs + 120_000, 'climb'],
    ]) {
      // OCC dismissed its proposal then: the server's clock has no departure any more and vanishes at that instant.
      const clock = clockOf(8, { imported: false, cancelAtMs });
      expect(clock.state, label).toBe('Cancelled');
      expect([clock.offBlockAtMs, clock.takeoffAtMs, clock.vanishAtMs], label).toEqual([null, null, cancelAtMs]);
      // The map reads it 3 s later and goes on from the trajectory it was drawing.
      const cancelled = fit(clock, { trajectory: old, atMs: cancelAtMs + 3_000 });
      expect(cancelled.meta.statusKey, label).toBe('cancelledByProvider');
      expect(cancelled.meta.fade, label).toEqual({ startMs: cancelAtMs, endMs: cancelAtMs + DEMO_FADE_MS });
      expect(cancelled.endMs, label).toBe(cancelAtMs + DEMO_FADE_MS);
      // No jump: until it is gone it is where the old trajectory has it, at its height, heading and speed.
      for (const t of [old.startMs + 1_000, cancelAtMs - 1_000, cancelAtMs, cancelAtMs + 3_000, cancelAtMs + DEMO_FADE_MS - 1]) {
        const before = sampleTrajectory(old, t);
        const now = sampleTrajectory(cancelled, t);
        const at = `${label} at ${t - cancelAtMs} ms`;
        expect(haversineM([before.lon, before.lat], [now.lon, now.lat]), at).toBeLessThan(0.01);
        expect(Math.abs(before.altM - now.altM), at).toBeLessThan(0.01);
        expect(angleBetween(before.trackDeg, now.trackDeg), at).toBeLessThan(0.01);
        expect(Math.abs(before.gsMs - now.gsMs), at).toBeLessThan(0.01);
        expect(now.phase, at).toBe(before.phase);
      }
      const fading = sampleTrajectory(cancelled, cancelAtMs + 2_000);
      expect(fading.phase, label).toBe(phase);
      expect(fading.opacity, label).toBeCloseTo(0.75, 6);
      expect(fading.statusKey, label).toBe('cancelledByProvider');
      expect(haversineM([fading.lon, fading.lat], hold.p), label).toBeGreaterThan(100);
      expect(sampleTrajectory(cancelled, cancelAtMs + DEMO_FADE_MS), label).toBeNull();
      expectContinuous(cancelled, label);
      // Read again, it stays the same.
      expect(JSON.stringify(fit(clock, { trajectory: cancelled, atMs: cancelAtMs + 6_000 })), label).toBe(JSON.stringify(cancelled));
      // Rebuilt from the cancelled clock alone (a screen opened during the fade), the aircraft could only be at the
      // apron hold: the trajectory the map was drawing is what keeps it where it was.
      const rebuilt = sampleTrajectory(fit(clock), cancelAtMs + 2_000);
      expect(rebuilt.phase, label).toBe('holding');
      expect(haversineM([rebuilt.lon, rebuilt.lat], hold.p), label).toBeLessThan(0.5);
    }
  });

  it('ended where it is when the reads stop listing it: cancelled before its touchdown, plainly after it', { timeout: 30_000 }, () => {
    const hold = holdOf('ah-a');
    const clock = clockOf(8, { imported: false });
    const old = fitDemoTrajectory({ demo: clock, imported: false, apronHold: hold, counterpart: MIA, destination: MIA, perf: PERF, layout: MDPC_LAYOUT });
    const same = (ended, t, at) => {
      const before = sampleTrajectory(old, t);
      const now = sampleTrajectory(ended, t);
      expect(haversineM([before.lon, before.lat], [now.lon, now.lat]), at).toBeLessThan(0.01);
      expect(Math.abs(before.altM - now.altM), at).toBeLessThan(0.01);
      expect(now.phase, at).toBe(before.phase);
    };
    // On approach: only a cancellation ends a demo flight before its touchdown, so it says so while it fades.
    const onApproach = clock.touchdownAtMs - 60_000;
    const cancelled = endDemoTrajectory(old, { atMs: onApproach, statusKey: 'cancelledByProvider' });
    expect(cancelled.meta).toMatchObject({ statusKey: 'cancelledByProvider', fade: { startMs: onApproach, endMs: onApproach + DEMO_FADE_MS } });
    expect(cancelled.meta.anchor).toEqual({ kind: 'demo', endedAtMs: onApproach });
    expect(cancelled.endMs).toBe(onApproach + DEMO_FADE_MS);
    for (const t of [old.startMs + 1_000, onApproach - 1_000, onApproach, onApproach + DEMO_FADE_MS - 1]) same(cancelled, t, `${t - onApproach} ms`);
    expect(sampleTrajectory(cancelled, onApproach + 2_000)).toMatchObject({ opacity: 0.75, statusKey: 'cancelledByProvider', onGround: false });
    expect(sampleTrajectory(cancelled, onApproach + DEMO_FADE_MS)).toBeNull();
    expectContinuous(cancelled, 'cancelled on approach');
    // Waiting at the apron hold, after its touchdown («Terminar demo»): it fades out there, still awaiting a stand.
    const waiting = clock.onBlockAtMs + 60_000;
    const finished = endDemoTrajectory(old, { atMs: waiting });
    expect(finished.meta.statusKey).toBeNull();
    same(finished, waiting + 4_000, 'waiting');
    const fading = sampleTrajectory(finished, waiting + 4_000);
    expect(fading).toMatchObject({ opacity: 0.5, phase: 'holding', statusKey: 'awaitingStandNotImported', gsMs: 0 });
    expect(haversineM([fading.lon, fading.lat], hold.p)).toBeLessThan(0.5);
    // Already fading on its own (the worker dismissed it at vanishAt): that fade goes on as it was.
    const late = endDemoTrajectory(old, { atMs: clock.vanishAtMs + 3_000 });
    expect(late.meta.fade).toEqual(old.meta.fade);
    expect(sampleTrajectory(late, clock.vanishAtMs + 4_000).opacity).toBeCloseTo(sampleTrajectory(old, clock.vanishAtMs + 4_000).opacity, 9);
    // Nothing to end: not a demo trajectory, or one that has not begun.
    expect(endDemoTrajectory(null, { atMs: waiting })).toBeNull();
    expect(endDemoTrajectory({ ...old, kind: 'arrival' }, { atMs: waiting })).toBeNull();
    expect(endDemoTrajectory(old, { atMs: old.startMs - 1 })).toBeNull();
    expect(Object.isFrozen(finished) && Object.isFrozen(finished.meta)).toBe(true);
  });

  it('a continued trajectory rebuilt with its own continuedAtMs keeps its taxi and moves only what follows', { timeout: 30_000 }, () => {
    const hold = holdOf('ah-b');
    const stand = standOf('B21');
    const fit = (clock, imported, continueFrom = null) => fitDemoTrajectory({
      demo: clock, imported, stand: imported ? stand : null, apronHold: hold, counterpart: MIA, destination: MIA, perf: PERF,
      layout: MDPC_LAYOUT, continueFrom,
    });
    // Waiting at terminal B's hold a minute after its on-block, OCC imports it with B21: it taxis there at its own speed.
    const before = clockOf(8, { imported: false });
    const importedAt = before.onBlockAtMs + 60_000;
    const continued = fit(clockOf(8), true, { trajectory: fit(before, false), atMs: importedAt });
    expect(continued.meta.anchor).toEqual({ kind: 'demo', continuedAtMs: importedAt });
    const arrival = firstLeg(continued, 'parked').t0Ms;
    // Half a minute later, mid-taxi, «Terminar demo» brings the off-block to then; later the worker finishes the flight.
    const finishAt = importedAt + 30_000;
    expect(sampleTrajectory(continued, finishAt).gsMs).toBeGreaterThan(1);
    expect(arrival).toBeGreaterThan(finishAt);
    const finishing = clockOf(8, { offBlockAfterMin: (finishAt - before.onBlockAtMs) / 60_000 });
    expect(finishing.offBlockAtMs).toBe(finishAt);
    for (const [label, clock] of [['off-block', finishing], ['finished', { ...finishing, state: 'Finished' }]]) {
      const rebuilt = fit(clock, true, { trajectory: continued, atMs: continued.meta.anchor.continuedAtMs });
      // Its taxi stays as drawn, up to B21.
      for (let t = importedAt - 5_000; t <= arrival; t += 5_000) {
        const was = sampleTrajectory(continued, t);
        const now = sampleTrajectory(rebuilt, t);
        expect(haversineM([was.lon, was.lat], [now.lon, now.lat]), `${label} at ${t - importedAt} ms`).toBeLessThan(0.01);
      }
      expect(rebuilt.meta.anchor).toEqual({ kind: 'demo', continuedAtMs: importedAt });
      // At B21 it leaves at once (its off-block has gone by) and still lifts off at the server's takeoffAt.
      expect(firstLeg(rebuilt, 'parked').t0Ms, label).toBeCloseTo(arrival, 0);
      expect(sampleTrajectory(rebuilt, arrival + 5_000).phase, label).toBe('pushback');
      expect(Math.abs(firstLeg(rebuilt, 'climb').t0Ms - finishing.takeoffAtMs), label).toBeLessThan(1_000);
      expectContinuous(rebuilt, label);
    }
    // Rebuilt from its clock alone it would be parked at B21 since onBlockAt, tens of metres from where it taxis: the
    // jump this avoids.
    const fresh = sampleTrajectory(fit(finishing, true), finishAt - 1_000);
    const drawn = sampleTrajectory(continued, finishAt - 1_000);
    expect([fresh.phase, drawn.phase]).toEqual(['parked', 'taxiIn']);
    expect(haversineM([fresh.lon, fresh.lat], [drawn.lon, drawn.lat])).toBeGreaterThan(50);
  });

  it('the route from the origin airport to the start point is carried as flown estimated', () => {
    const { clock, trajectory } = demo(15);
    const origin = trajectory.meta.originPath;
    const first = sampleTrajectory(trajectory, clock.appearAtMs);
    expect(haversineM(origin[0], MIA)).toBeLessThan(1);
    expect(haversineM(origin[origin.length - 1], [first.lon, first.lat])).toBeLessThan(1);
    expect(measurePolyline(origin).lengthM).toBeCloseTo(trajectory.meta.startAlongM, 0);
    // It is the way the aircraft came: the great circle from MIA towards Punta Cana, within a few km of it.
    const direct = haversineM(MIA, END_08.threshold);
    expect(measurePolyline(origin).lengthM).toBeLessThan(direct);
    expect(measurePolyline(origin).lengthM + haversineM([first.lon, first.lat], END_08.threshold)).toBeLessThan(direct * 1.01);
    expect(Object.isFrozen(origin)).toBe(true);
    // Without an origin airport the route starts on the extended centreline, 40 NM out.
    const unknown = fitDemoTrajectory({ demo: clock, imported: true, stand: standOf('A5'), counterpart: null, perf: PERF, layout: MDPC_LAYOUT });
    expect(haversineM(unknown.meta.originPath[0], END_08.threshold) / nmToM(1)).toBeCloseTo(40, 3);
  });

  it('the same inputs give the same position on two independent builds', { timeout: 30_000 }, () => {
    const block = demoBlock(8, { offBlockAfterMin: 20 });
    const build = () => {
      const layout = structuredClone(MDPC_LAYOUT);
      return fitDemoTrajectory({
        demo: demoClock(structuredClone(block), parseInstant), imported: true, stand: layout.stands.find(stand => stand.code === 'BN9'),
        counterpart: [...MIA], destination: [...MIA], perf: perfFor({ typeIcao: 'A320' }), layout,
      });
    };
    const first = build();
    const second = build();
    const clock = demoClock(block, parseInstant);
    for (let t = clock.appearAtMs; t <= clock.vanishAtMs + DEMO_FADE_MS; t += 7_777) {
      expect(JSON.stringify(sampleTrajectory(second, t)), String(t)).toBe(JSON.stringify(sampleTrajectory(first, t)));
    }
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(Object.isFrozen(first) && Object.isFrozen(first.legs) && Object.isFrozen(first.legs[0])).toBe(true);
  });
});
