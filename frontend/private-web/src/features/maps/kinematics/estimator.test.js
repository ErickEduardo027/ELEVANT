import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout.js';
import { destinationPoint, haversineM, initialBearing } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { createKinematicsLayout } from './kinematicsFixtures.js';
import {
  TRAJECTORY_PHASES,
  AWAITING_STAND_MAX_MS,
  alongAt,
  arrivalAnchors,
  buildArrivalTrajectory,
  buildDepartureTrajectory,
  departureAnchors,
  flightTimesFromRow,
  sampleTrajectory,
  shouldEstimate,
  trajectoryLine,
  trajectoryPath,
} from './estimator.js';
import { perfFor } from './perfProfiles.js';
import { runwayExits } from './taxiRoute.js';
import { ftToM, ktToMs, msToKt, nmToM } from './units.js';

// The map's parser in the tests: ISO instants through Date.parse (the screens inject serverClock's).
const parseInstant = value => (typeof value === 'string' ? Date.parse(value) : null);
const T0 = Date.parse('2026-11-14T15:00:00Z');
const iso = ms => new Date(ms).toISOString();
const MIA = [-80.287, 25.7959];
const PERF = perfFor({ typeIcao: 'A320' });
const END_08 = runwayEnd(MDPC_LAYOUT, '08');
const standOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code);
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const ELEVATION_08 = ftToM(END_08.elevationFt);

/** A map flight row with the keys estimator.js reads (contracts 1.3). */
function row(overrides = {}) {
  return {
    flightKey: 'l:5d0c6b9e-0000-4000-8000-000000000001',
    direction: 'Arrival',
    phase: 'scheduled',
    imported: true,
    isDemo: false,
    scheduledAt: iso(T0 + 3_600_000),
    estimatedAt: null,
    actualAt: null,
    actualKind: null,
    stand: null,
    milestones: [],
    ...overrides,
  };
}

/**
 * The worst position jump beyond the fastest speed of each step times the step, the worst heading step and the phases
 * seen, sampling every `stepMs`. Within a leg the speed is linear in time, so the fastest speed of a step is at one of
 * its ends or where a leg begins inside it.
 */
function sweep(trajectory, { fromMs = trajectory.startMs, toMs, stepMs = 250 }) {
  const legs = trajectory.legs;
  let previous = sampleTrajectory(trajectory, fromMs);
  let worstJumpM = 0;
  let worstTurnDeg = 0;
  let pointer = 0;
  const phases = new Set(previous ? [previous.phase] : []);
  for (let t = fromMs + stepMs; t <= toMs; t += stepMs) {
    const next = sampleTrajectory(trajectory, t);
    if (next && previous) {
      let fastest = Math.max(previous.gsMs, next.gsMs);
      while (pointer < legs.length && legs[pointer].t0Ms <= t - stepMs) pointer += 1;
      for (let at = pointer; at < legs.length && legs[at].t0Ms < t; at += 1) {
        fastest = Math.max(fastest, sampleTrajectory(trajectory, legs[at].t0Ms)?.gsMs ?? 0);
      }
      const moved = haversineM([previous.lon, previous.lat], [next.lon, next.lat]);
      worstJumpM = Math.max(worstJumpM, moved - fastest * (stepMs / 1000));
      worstTurnDeg = Math.max(worstTurnDeg, angleBetween(previous.trackDeg, next.trackDeg));
      phases.add(next.phase);
    }
    previous = next;
  }
  return { worstJumpM, worstTurnDeg, phases };
}

/** A landed arrival from MIA: runway time at T0, on-block `onBlockAfterS` later, at `code`. */
function landed(code, onBlockAfterS, overrides = {}) {
  const flight = row({
    phase: 'landed', actualAt: iso(T0), actualKind: 'Runway', estimatedAt: iso(T0 + onBlockAfterS * 1000), ...overrides,
  });
  return buildArrivalTrajectory({
    times: flightTimesFromRow(flight, parseInstant), origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08,
    stand: code === null ? null : standOf(code), perf: PERF,
  });
}

describe('estimated trajectories', () => {
  it('an arrival sampled at on-block time is at the stand centre, on the stand heading, stopped', () => {
    for (const code of ['A5', 'B24', 'BN11', 'B37']) {
      const stand = standOf(code);
      // From the schedule only: the touchdown is the on-block less the nominal time on the ground.
      const onBlock = T0 + 3_600_000;
      const trajectory = buildArrivalTrajectory({
        times: flightTimesFromRow(row({ phase: 'approaching', scheduledAt: iso(onBlock) }), parseInstant),
        origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF,
      });
      expect(trajectory.meta.anchors).toMatchObject({ touchdownSource: 'derived', onBlockSource: 'scheduled' });
      const parked = sampleTrajectory(trajectory, onBlock);
      expect(haversineM([parked.lon, parked.lat], stand.center), code).toBeLessThan(0.5);
      expect(angleBetween(parked.trackDeg, stand.headingTrue), code).toBeLessThan(0.5);
      expect(parked.gsMs).toBe(0);
      expect(parked.onGround).toBe(true);
      expect(parked.altM).toBeCloseTo(ELEVATION_08, 6);
      // It stays there: a real arrival ends parked without end.
      expect(trajectory.endMs).toBe(Infinity);
      const later = sampleTrajectory(trajectory, onBlock + 6 * 3_600_000);
      expect(later.phase).toBe('parked');
      expect([later.lon, later.lat]).toEqual([parked.lon, parked.lat]);
      // A minute before, it was still taxiing towards it.
      expect(sampleTrajectory(trajectory, onBlock - 60_000).phase).toBe('taxiIn');
    }
    // The same on the synthetic aerodrome, with the time of a recorded BLOCK_ON.
    const layout = createKinematicsLayout();
    const s3 = layout.stands.find(stand => stand.code === 'S3');
    const blockOn = T0 + 900_000;
    const flight = row({ phase: 'arrived', milestones: [{ code: 'BLOCK_ON', actualAt: iso(blockOn) }] });
    const synthetic = buildArrivalTrajectory({
      times: flightTimesFromRow(flight, parseInstant), origin: null, layout, runwayEnd: runwayEnd(layout, '09'), stand: s3, perf: PERF,
    });
    const parked = sampleTrajectory(synthetic, blockOn);
    expect(haversineM([parked.lon, parked.lat], s3.center)).toBeLessThan(0.5);
    expect(angleBetween(parked.trackDeg, 180)).toBeLessThan(0.5);
    expect(synthetic.meta.anchors.onBlockSource).toBe('blockOn');
  });

  it('height never increases on approach and crosses the threshold near 50 ft', () => {
    const trajectory = landed('A5', 420);
    const touchdown = T0;
    let previous = sampleTrajectory(trajectory, trajectory.startMs);
    expect(previous.phase).toBe('enroute');
    let worstRise = 0;
    for (let t = trajectory.startMs + 2_000; t <= touchdown; t += 2_000) {
      const next = sampleTrajectory(trajectory, t);
      worstRise = Math.max(worstRise, next.altM - previous.altM);
      expect(next.vrateMs).toBeLessThanOrEqual(1e-9);
      previous = next;
    }
    expect(worstRise).toBeLessThanOrEqual(1e-6);
    // The phases of the way down come in order.
    const order = [];
    for (let t = trajectory.startMs; t <= touchdown + 5_000; t += 5_000) {
      const { phase } = sampleTrajectory(trajectory, t);
      if (order[order.length - 1] !== phase) order.push(phase);
    }
    expect(order).toEqual(['enroute', 'descent', 'approach', 'final', 'landing']);
    // Over the threshold at 50 ft above its 43 ft, on the 3° path (318 ft per NM) 5 NM out.
    const final = trajectory.legs.find(leg => leg.phase === 'final' && Math.abs(leg.alt1 - (ELEVATION_08 + ftToM(50))) < 1e-6);
    const over = sampleTrajectory(trajectory, final.t1Ms);
    expect(haversineM([over.lon, over.lat], END_08.threshold)).toBeLessThan(1);
    expect((over.altM - ELEVATION_08) / ftToM(1)).toBeCloseTo(50, 1);
    expect(msToKt(over.gsMs)).toBeCloseTo(137, 1);
    const fiveOut = destinationPoint(END_08.threshold, END_08.headingTrue + 180, nmToM(5));
    let nearest = null;
    for (let t = final.t0Ms; t <= final.t1Ms; t += 500) {
      const state = sampleTrajectory(trajectory, t);
      const distance = haversineM([state.lon, state.lat], fiveOut);
      if (nearest === null || distance < nearest.distance) nearest = { distance, state };
    }
    expect(nearest.distance).toBeLessThan(40);
    expect((nearest.state.altM - ELEVATION_08) / ftToM(1)).toBeGreaterThan(50 + 5 * 318 - 20);
    expect((nearest.state.altM - ELEVATION_08) / ftToM(1)).toBeLessThan(50 + 5 * 318 + 20);
    // The wheels touch 300 m beyond the threshold at the touchdown instant, on the ground.
    const wheels = sampleTrajectory(trajectory, touchdown);
    expect(wheels.phase).toBe('landing');
    expect(wheels.onGround).toBe(true);
    expect(wheels.altM).toBeCloseTo(ELEVATION_08, 6);
    expect(haversineM([wheels.lon, wheels.lat], END_08.threshold)).toBeCloseTo(300, 0);
  });

  it('taxi speed stays at 25 kt or less and position never jumps more than speed times the step', () => {
    const limit = ktToMs(25) + 1e-9;
    // Plenty of time, just enough time, and too little: a real flight is never sped up beyond 25 kt, it arrives late.
    for (const [code, afterS] of [['A5', 600], ['A1', 240], ['B37', 150], ['BN13', 160]]) {
      const trajectory = landed(code, afterS);
      const parkedAt = trajectory.legs.find(leg => leg.phase === 'parked').t0Ms;
      let fastest = 0;
      for (let t = T0; t <= parkedAt; t += 1_000) {
        const state = sampleTrajectory(trajectory, t);
        if (state.phase === 'taxiIn') fastest = Math.max(fastest, state.gsMs);
      }
      expect(fastest, `${code} ${afterS} s`).toBeLessThanOrEqual(limit);
      expect(trajectory.legs.filter(leg => leg.part === 'taxiIn').every(leg => leg.timeScale === undefined || leg.timeScale === 1)).toBe(true);
      const { worstJumpM } = sweep(trajectory, { fromMs: T0 - 60_000, toMs: parkedAt + 10_000, stepMs: 1_000 });
      expect(worstJumpM, `${code} ${afterS} s`).toBeLessThanOrEqual(0.01);
      // Too little time: it parks after the estimate rather than taxiing faster.
      if (afterS <= 160) expect(parkedAt).toBeGreaterThan(T0 + afterS * 1000);
      else expect(parkedAt).toBeLessThanOrEqual(T0 + afterS * 1000 + 1);
    }
  });

  it('a real flight that is only scheduled yields no aircraft; an imported flight does not leave its stand without PUSHBACK or a live fix', () => {
    // Decision F-1 for arrivals: only what the provider says is airborne, landed or arrived at a stand.
    const arrival = phase => shouldEstimate(row({ phase }));
    expect(arrival('scheduled')).toEqual({ draw: false, reason: 'scheduled' });
    for (const phase of ['unknown', 'cancelled', 'diverted']) expect(arrival(phase).draw, phase).toBe(false);
    for (const phase of ['departed', 'enroute', 'approaching']) expect(arrival(phase), phase).toEqual({ draw: true, reason: 'airborne' });
    expect(arrival('landed')).toEqual({ draw: true, reason: 'landed' });
    expect(arrival('arrived')).toEqual({ draw: false, reason: 'arrivedWithoutStand' });
    expect(shouldEstimate(row({ phase: 'arrived', stand: { id: 'x', code: 'A5' } }))).toEqual({ draw: true, reason: 'parked' });
    expect(shouldEstimate(row({ phase: 'scheduled', isDemo: true }))).toEqual({ draw: true, reason: 'demo' });
    expect(shouldEstimate(null).draw).toBe(false);

    // An imported departure whose time has long passed, its arrival parked at A5 since BLOCK_ON.
    const stand = standOf('A5');
    const blockOn = T0;
    const departure = row({
      direction: 'Departure', phase: 'scheduled', scheduledAt: iso(T0 + 1_800_000), stand: { id: 'x', code: 'A5' },
      milestones: [{ code: 'BLOCK_ON', actualAt: iso(blockOn) }],
    });
    expect(shouldEstimate(departure)).toEqual({ draw: false, reason: 'awaitingPushback' });
    const waiting = departureAnchors(flightTimesFromRow(departure, parseInstant), { imported: true });
    expect(waiting).toEqual({ offBlockMs: null, takeoffMs: null });
    expect(buildDepartureTrajectory({ times: waiting, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF })).toBeNull();
    const parkedArrival = buildArrivalTrajectory({
      times: flightTimesFromRow(row({ phase: 'arrived', milestones: departure.milestones }), parseInstant),
      origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF,
    });
    for (const later of [1_800_000, 3 * 3_600_000, 12 * 3_600_000]) {
      const state = sampleTrajectory(parkedArrival, blockOn + later);
      expect(state.phase).toBe('parked');
      expect(haversineM([state.lon, state.lat], stand.center)).toBeLessThan(0.5);
    }
    // PUSHBACK recorded: it leaves then, backwards out of A5.
    const pushbackAt = T0 + 2_400_000;
    const pushed = { ...departure, milestones: [...departure.milestones, { code: 'PUSHBACK', actualAt: iso(pushbackAt) }] };
    expect(shouldEstimate(pushed)).toEqual({ draw: true, reason: 'pushback' });
    const times = flightTimesFromRow(pushed, parseInstant);
    expect(times.pushbackAtMs).toBe(pushbackAt);
    const anchors = departureAnchors(times, { imported: true });
    expect(anchors.offBlockMs).toBe(pushbackAt);
    const leaving = buildDepartureTrajectory({ times: anchors, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF, destination: MIA });
    expect(leaving.startMs).toBe(pushbackAt);
    expect(sampleTrajectory(leaving, pushbackAt + 5_000).phase).toBe('pushback');
    // A live fix that shows it moving starts it at the fix instead; the provider's runway time alone does not.
    expect(shouldEstimate(departure, { hasLiveFix: true })).toEqual({ draw: true, reason: 'liveFix' });
    expect(departureAnchors(times, { imported: true, liveFixAtMs: pushbackAt + 99 }).offBlockMs).toBe(pushbackAt);
    expect(departureAnchors(flightTimesFromRow(departure, parseInstant), { imported: true, liveFixAtMs: pushbackAt + 99 }).offBlockMs)
      .toBe(pushbackAt + 99);
    const providerSaysDeparted = { ...departure, phase: 'departed', actualAt: iso(T0 + 2_000_000), actualKind: 'Runway' };
    expect(shouldEstimate(providerSaysDeparted).draw).toBe(false);
    expect(departureAnchors(flightTimesFromRow(providerSaysDeparted, parseInstant), { imported: true }).offBlockMs).toBeNull();
    // A departure nobody imported is drawn once the provider says it took off, from its taxi before that.
    const proposal = { ...providerSaysDeparted, imported: false, stand: null, milestones: [] };
    expect(shouldEstimate(proposal)).toEqual({ draw: true, reason: 'airborne' });
    expect(departureAnchors(flightTimesFromRow(proposal, parseInstant), { imported: false, nominalTaxiOutMs: 300_000 }))
      .toEqual({ offBlockMs: T0 + 1_700_000, takeoffMs: T0 + 2_000_000 });
    expect(shouldEstimate({ ...proposal, phase: 'scheduled', actualAt: null, actualKind: null }).draw).toBe(false);
  });

  it('pushback moves the aircraft backwards while its heading holds', () => {
    for (const code of ['A1', 'B27', 'BN9']) {
      const stand = standOf(code);
      const pushbackAt = T0;
      const trajectory = buildDepartureTrajectory({
        times: { offBlockMs: pushbackAt, takeoffMs: null }, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF,
      });
      const legs = trajectory.legs.filter(leg => leg.phase === 'pushback' && leg.kind === 'move');
      const end = legs[legs.length - 1].t1Ms;
      // It starts at the stand's centre, nose on the stand heading, and stops when the pushback ends.
      const first = sampleTrajectory(trajectory, pushbackAt);
      expect(haversineM([first.lon, first.lat], stand.center), code).toBeLessThan(0.01);
      expect(angleBetween(first.trackDeg, stand.headingTrue), code).toBeLessThan(1);
      expect(sampleTrajectory(trajectory, end).gsMs).toBeLessThan(1e-6);
      // Moving tail first: the motion points opposite the nose; while the lead-in runs straight the nose holds.
      const leadInLength = haversineM(stand.leadIn[0], stand.leadIn[1]);
      let backwards = 0;
      for (let t = pushbackAt + 2_000; t < end - 2_000; t += 2_000) {
        const a = sampleTrajectory(trajectory, t);
        const b = sampleTrajectory(trajectory, t + 1_000);
        if (haversineM([a.lon, a.lat], [b.lon, b.lat]) < 0.2) continue;
        const motion = initialBearing([a.lon, a.lat], [b.lon, b.lat]);
        expect(angleBetween(motion, a.trackDeg), `${code} at ${t - pushbackAt} ms`).toBeGreaterThan(150);
        if (alongAt(trajectory, t) < leadInLength - 35) expect(angleBetween(a.trackDeg, stand.headingTrue)).toBeLessThan(1);
        expect(a.gsMs).toBeLessThanOrEqual(PERF.pushback.maxSpeedMs + 1e-9);
        backwards += 1;
      }
      expect(backwards, code).toBeGreaterThan(5);
      // Then the engines start and it taxis forward, nose first.
      const taxiing = trajectory.legs.find(leg => leg.phase === 'taxiOut' && leg.kind === 'move' && leg.lengthM > 20);
      const a = sampleTrajectory(trajectory, taxiing.t0Ms + taxiing.durationMs * 0.4);
      const b = sampleTrajectory(trajectory, taxiing.t0Ms + taxiing.durationMs * 0.6);
      expect(angleBetween(initialBearing([a.lon, a.lat], [b.lon, b.lat]), a.trackDeg)).toBeLessThan(20);
    }
  });

  it('a landed flight with a runway time and an estimated on-block fits its taxi between them', () => {
    // 8 minutes from the runway to A5: more than it needs, so it taxis at its own speeds and waits before the lead-in.
    const trajectory = landed('A5', 480);
    expect(trajectory.meta.anchors).toMatchObject({ touchdownMs: T0, onBlockMs: T0 + 480_000, touchdownSource: 'runway', onBlockSource: 'estimated' });
    expect(sampleTrajectory(trajectory, T0).phase).toBe('landing');
    expect(msToKt(sampleTrajectory(trajectory, T0).gsMs)).toBeCloseTo(137, 3);
    const parked = trajectory.legs.find(leg => leg.phase === 'parked');
    expect(Math.abs(parked.t0Ms - (T0 + 480_000))).toBeLessThan(1);
    const hold = trajectory.legs.find(leg => leg.kind === 'wait' && leg.phase === 'taxiIn');
    expect(hold.durationMs).toBeGreaterThan(10_000);
    // 4 minutes is tighter: no wait, the taxi speeds up, and it still parks on time at 25 kt or less.
    const tight = landed('A5', 240);
    expect(tight.legs.some(leg => leg.kind === 'wait' && leg.phase === 'taxiIn')).toBe(false);
    expect(Math.abs(tight.legs.find(leg => leg.phase === 'parked').t0Ms - (T0 + 240_000))).toBeLessThan(1);
    const taxi = tight.legs.filter(leg => leg.phase === 'taxiIn' && leg.kind === 'move');
    expect(Math.max(...taxi.map(leg => Math.max(leg.v0, leg.v1)))).toBeGreaterThan(PERF.taxi.straightMs);
    expect(Math.max(...taxi.map(leg => Math.max(leg.v0, leg.v1)))).toBeLessThanOrEqual(PERF.taxi.maxMs + 1e-9);
    // Without a stand it taxis to the apron hold of the route and waits there for one.
    const holding = landed(null, 480);
    const waiting = sampleTrajectory(holding, T0 + 600_000);
    expect(waiting.phase).toBe('holding');
    expect(waiting.statusKey).toBe('awaitingStand');
    expect(MDPC_LAYOUT.apronHolds.map(item => item.id)).toContain(holding.meta.apronHoldId);
    // For AWAITING_STAND_MAX_MS at most: then nothing places it, so it is not left piled up on the hold.
    const held = holding.legs[holding.legs.length - 1];
    expect(held.phase).toBe('holding');
    expect(held.durationMs).toBe(AWAITING_STAND_MAX_MS);
    expect(holding.endMs).toBe(held.t0Ms + AWAITING_STAND_MAX_MS);
    expect(sampleTrajectory(holding, holding.endMs + 1)).toBeNull();
    // With a stand it stays parked there without end.
    expect(landed('A5', 480).endMs).toBe(Infinity);
    // The anchors on their own: BLOCK_ON first, then an on-block actual time, the estimate and the schedule.
    expect(arrivalAnchors({ blockOnAtMs: 5, actualKind: 'OnBlock', actualAtMs: 6, estimatedAtMs: 7, scheduledAtMs: 8 }).onBlockMs).toBe(5);
    expect(arrivalAnchors({ actualKind: 'OnBlock', actualAtMs: 6, estimatedAtMs: 7, scheduledAtMs: 8 }).onBlockMs).toBe(6);
    expect(arrivalAnchors({ scheduledAtMs: 8_000 }, { nominalGroundMs: 3_000 })).toMatchObject({ touchdownMs: 5_000, touchdownSource: 'derived' });
    expect(arrivalAnchors({})).toMatchObject({ touchdownMs: null, onBlockMs: null });
  });

  it('a trajectory rebuilt from a fix starts at the fix position, altitude and speed', () => {
    const stand = standOf('A5');
    const fixes = [
      // 20 NM north-west at 6 000 ft and 220 kt, on its way in.
      { label: 'airborne', lon: -68.62, lat: 18.78, altM: ftToM(6_000), gsMs: ktToMs(220), trackDeg: 130, onGround: false },
      // 8 NM out on the 08 final at 2 600 ft and 160 kt.
      { label: 'final', ...lonLat(destinationPoint(END_08.threshold, END_08.headingTrue + 180, nmToM(8))), altM: ftToM(2_600), gsMs: ktToMs(160), trackDeg: END_08.headingTrue, onGround: false },
      // On the ground at the A taxiway near the apron, at 12 kt.
      { label: 'ground', ...lonLat(standOf('A1').leadIn[0]), altM: null, gsMs: ktToMs(12), trackDeg: 260, onGround: true },
    ];
    for (const { label, ...fix } of fixes) {
      const positionAt = T0 + 1_000;
      const trajectory = buildArrivalTrajectory({
        times: null, origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF,
        anchor: { kind: 'fix', fix: { ...fix, positionAt } },
      });
      expect(trajectory.startMs, label).toBe(positionAt);
      expect(trajectory.meta.anchor.kind).toBe('fix');
      const start = sampleTrajectory(trajectory, positionAt);
      expect(haversineM([start.lon, start.lat], [fix.lon, fix.lat]), label).toBeLessThan(1);
      expect(start.gsMs, label).toBeCloseTo(fix.gsMs, 6);
      if (fix.altM !== null) expect(start.altM, label).toBeCloseTo(fix.altM, 6);
      expect(start.onGround, label).toBe(fix.onGround);
      expect(sampleTrajectory(trajectory, positionAt - 1), label).toBeNull();
      // From there it goes on to the stand.
      const parked = trajectory.legs.find(leg => leg.phase === 'parked');
      const end = sampleTrajectory(trajectory, parked.t0Ms + 1_000);
      expect(haversineM([end.lon, end.lat], stand.center), label).toBeLessThan(0.5);
      expect(sweep(trajectory, { toMs: parked.t0Ms, stepMs: 1_000 }).worstJumpM, label).toBeLessThanOrEqual(0.01);
    }
    // A departure seen climbing out goes on from its fix towards its destination.
    const climbing = { lon: -68.30, lat: 18.60, altM: ftToM(4_000), gsMs: ktToMs(200), trackDeg: 74, onGround: false, positionAt: T0 };
    const departure = buildDepartureTrajectory({
      times: null, destination: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, perf: PERF, anchor: { kind: 'fix', fix: climbing },
    });
    const first = sampleTrajectory(departure, T0);
    expect(haversineM([first.lon, first.lat], [climbing.lon, climbing.lat])).toBeLessThan(1);
    expect(first.altM).toBeCloseTo(climbing.altM, 6);
    expect(first.gsMs).toBeCloseTo(climbing.gsMs, 6);
    expect(sampleTrajectory(departure, T0 + 60_000).altM).toBeGreaterThan(climbing.altM);
  });

  it('a fix stopped on the ground starts nothing: parked or waiting where it is, or leaving with its record', () => {
    // Decision F-1: a departure leaves only with a recorded off-block or a live fix that shows it moving.
    const stand = standOf('A5');
    const F = T0;
    const still = { ...lonLat(stand.center), altM: null, gsMs: 0, trackDeg: null, onGround: true, positionAt: F };
    const noRecord = { offBlockMs: null, takeoffMs: null };
    const depart = (fix, times = noRecord, extra = {}) => buildDepartureTrajectory({
      times, destination: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF, anchor: { kind: 'fix', fix }, ...extra,
    });
    // Imported without PUSHBACK, or nobody imported it and the provider says nothing of a take-off: it waits where the
    // fix has it, parked in its stand, without end, nose north as the map draws a fix without a track.
    const waiting = depart(still);
    expect(waiting).toMatchObject({ kind: 'departure', startMs: F, endMs: Infinity, meta: { standCode: 'A5', departureRunwayIdent: '08' } });
    expect(waiting.meta.anchor).toMatchObject({ kind: 'fix' });
    expect(waiting.legs.every(leg => leg.kind === 'wait')).toBe(true);
    for (const later of [0, 30_000, 300_000, 3 * 3_600_000]) {
      const state = sampleTrajectory(waiting, F + later);
      expect(haversineM([state.lon, state.lat], stand.center), `${later} ms`).toBeLessThan(0.01);
      expect(state, `${later} ms`).toMatchObject({ gsMs: 0, onGround: true, phase: 'parked', trackDeg: 0 });
      expect(state.altM).toBeCloseTo(ELEVATION_08, 6);
    }
    // Under 2 kt is stopped too, on its own track; so is a fix without a speed. Outside its stand it holds there.
    const creeping = depart({ ...still, gsMs: ktToMs(1.5), trackDeg: 175 });
    expect(sampleTrajectory(creeping, F + 600_000)).toMatchObject({ gsMs: 0, phase: 'parked', trackDeg: 175 });
    expect(depart({ ...still, gsMs: null }).legs.every(leg => leg.kind === 'wait')).toBe(true);
    const onTaxiway = { ...still, ...lonLat(standOf('A1').leadIn[0]), trackDeg: 260 };
    const holding = sampleTrajectory(depart(onTaxiway), F + 600_000);
    expect(holding).toMatchObject({ gsMs: 0, phase: 'holding', trackDeg: 260 });
    expect(haversineM([holding.lon, holding.lat], standOf('A1').leadIn[0])).toBeLessThan(0.01);
    // With its PUSHBACK it leaves its stand then, backwards, never before the fix that had it still in the stand.
    const pushback = F + 240_000;
    const pushed = depart(still, { offBlockMs: pushback, takeoffMs: null });
    expect(pushed.startMs).toBe(pushback);
    expect(sampleTrajectory(pushed, pushback + 5_000).phase).toBe('pushback');
    expect(depart(still, { offBlockMs: F - 60_000, takeoffMs: null }).startMs).toBe(F);
    // Stopped somewhere else after its PUSHBACK (short of the runway, waiting), it taxis on from the fix.
    const goingOn = depart(onTaxiway, { offBlockMs: F - 300_000, takeoffMs: null });
    expect(goingOn.startMs).toBe(F);
    const first = sampleTrajectory(goingOn, F);
    expect(haversineM([first.lon, first.lat], standOf('A1').leadIn[0])).toBeLessThan(1);
    expect(goingOn.legs.some(leg => leg.phase === 'takeoff')).toBe(true);
    // A fix that shows it moving starts the taxi from the fix, record or not.
    const moving = depart({ ...onTaxiway, gsMs: ktToMs(12) });
    expect(moving.legs.some(leg => leg.phase === 'takeoff')).toBe(true);
    expect(sampleTrajectory(moving, F + 1_000).gsMs).toBeGreaterThan(0);

    // An arrival stopped in its stand is parked there, where the fix is; stopped short of it, it taxis on and parks.
    const arrive = fix => buildArrivalTrajectory({
      times: null, origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF, anchor: { kind: 'fix', fix },
    });
    const parked = arrive({ ...still, trackDeg: 174 });
    expect(parked).toMatchObject({ kind: 'arrival', startMs: F, endMs: Infinity, meta: { standCode: 'A5', statusKey: null } });
    for (const later of [30_000, 1_200_000]) {
      const state = sampleTrajectory(parked, F + later);
      expect(haversineM([state.lon, state.lat], stand.center)).toBeLessThan(0.01);
      expect(state).toMatchObject({ gsMs: 0, phase: 'parked', trackDeg: 174 });
    }
    // Once its operation records the PUSHBACK the aircraft has left: the arrival's stopped fix places it nowhere.
    expect(buildArrivalTrajectory({
      times: { pushbackAtMs: F + 60_000 }, origin: MIA, layout: MDPC_LAYOUT, runwayEnd: END_08, stand, perf: PERF,
      anchor: { kind: 'fix', fix: still },
    })).toBeNull();
    const taxiingOn = arrive(onTaxiway);
    const end = taxiingOn.legs.find(leg => leg.phase === 'parked');
    expect(taxiingOn.legs.some(leg => leg.kind === 'move')).toBe(true);
    const atStand = sampleTrajectory(taxiingOn, end.t0Ms + 1_000);
    expect(haversineM([atStand.lon, atStand.lat], stand.center)).toBeLessThan(0.5);
  });

  it('every phase samples continuously with no jump at leg boundaries', () => {
    const stand = standOf('B27');
    const arrival = landed('B27', 420);
    const departure = buildDepartureTrajectory({
      times: { offBlockMs: T0 + 3_600_000, takeoffMs: T0 + 3_600_000 + 420_000 }, destination: MIA, layout: MDPC_LAYOUT,
      runwayEnd: END_08, stand, perf: PERF,
    });
    const noStand = landed(null, 420);
    const seen = new Set();
    for (const trajectory of [arrival, departure, noStand]) {
      // Across every leg boundary: no jump in position, height or heading.
      trajectory.legs.forEach((leg, at) => {
        if (at === 0 || !Number.isFinite(leg.t0Ms)) return;
        const before = sampleTrajectory(trajectory, leg.t0Ms - 1);
        const after = sampleTrajectory(trajectory, leg.t0Ms + 1);
        const label = `${trajectory.kind} leg ${at} (${trajectory.legs[at - 1].phase} → ${leg.phase})`;
        const moved = haversineM([before.lon, before.lat], [after.lon, after.lat]);
        expect(moved, label).toBeLessThanOrEqual(Math.max(before.gsMs, after.gsMs) * 0.002 + 0.01);
        expect(Math.abs(after.altM - before.altM), label).toBeLessThan(0.05);
        expect(angleBetween(before.trackDeg, after.trackDeg), label).toBeLessThan(2);
        expect(Math.abs(after.gsMs - before.gsMs), label).toBeLessThan(0.5);
      });
      const end = Number.isFinite(trajectory.endMs) ? trajectory.endMs : trajectory.legs[trajectory.legs.length - 1].t0Ms + 60_000;
      const from = Math.max(trajectory.startMs, T0 - 1_200_000);
      const { worstJumpM, worstTurnDeg, phases } = sweep(trajectory, { fromMs: from, toMs: end, stepMs: 250 });
      expect(worstJumpM, trajectory.kind).toBeLessThanOrEqual(0.01);
      expect(worstTurnDeg, trajectory.kind).toBeLessThan(15);
      phases.forEach(phase => seen.add(phase));
      // The line it follows and the distance along it agree with where it is.
      const line = trajectoryLine(trajectory);
      const middle = (from + Math.min(end, from + 1_800_000)) / 2;
      expect(alongAt(trajectory, middle)).toBeGreaterThan(0);
      expect(alongAt(trajectory, middle)).toBeLessThanOrEqual(line.cumM[line.cumM.length - 1] + 1e-6);
      expect(trajectoryPath(trajectory, { fromMs: from, toMs: from + 60_000, stepS: 10 })).toHaveLength(7);
    }
    // The en-route part of the arrival too (it starts at MIA).
    const enroute = sweep(arrival, { toMs: T0 - 1_200_000, stepMs: 5_000 });
    expect(enroute.worstJumpM).toBeLessThanOrEqual(0.05);
    enroute.phases.forEach(phase => seen.add(phase));
    expect([...seen].sort()).toEqual([...TRAJECTORY_PHASES].sort());
    expect(Object.isFrozen(arrival) && Object.isFrozen(arrival.legs[3]) && Object.isFrozen(arrival.meta)).toBe(true);
  });

  it('an estimated arrival leaves any runway end by an exit that turns 90° at most, from the schedule or a live fix', () => {
    // Live arrivals can put real traffic on 09, whose first exit past 1 500 m (n7592254321) is the rapid exit of 27,
    // turning 155° back: the estimate leaves by n7592254365, 2 088 m along, instead.
    const stand = standOf('A5');
    for (const [ident, exitNodeId] of [['08', 'n7592262104'], ['26', 'n7592209929'], ['09', 'n7592254365'], ['27', 'n7592254321']]) {
      const end = runwayEnd(MDPC_LAYOUT, ident);
      const scheduled = buildArrivalTrajectory({
        times: flightTimesFromRow(row({ phase: 'approaching', scheduledAt: iso(T0 + 3_600_000) }), parseInstant),
        origin: MIA, layout: MDPC_LAYOUT, runwayEnd: end, stand, perf: PERF,
      });
      // 8 NM out on the final of that end, at 2 600 ft and 160 kt.
      const fix = {
        ...lonLat(destinationPoint(end.threshold, end.headingTrue + 180, nmToM(8))), altM: ftToM(2_600), gsMs: ktToMs(160),
        trackDeg: end.headingTrue, onGround: false, positionAt: T0,
      };
      const live = buildArrivalTrajectory({
        times: null, origin: MIA, layout: MDPC_LAYOUT, runwayEnd: end, stand, perf: PERF, anchor: { kind: 'fix', fix },
      });
      for (const [label, trajectory] of [['schedule', scheduled], ['fix', live]]) {
        expect(trajectory.meta.exitNodeId, `${ident} ${label}`).toBe(exitNodeId);
        const exit = runwayExits(MDPC_LAYOUT, end).find(candidate => candidate.nodeId === exitNodeId);
        expect(exit.turnDeg, `${ident} ${label}`).toBeLessThanOrEqual(90);
      }
    }
  });
});

function lonLat([lon, lat]) {
  return { lon, lat };
}
