import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM } from '../airport/geo';
import { runwayEnd } from '../airport/runwayInUse';
import { demoClock, fitDemoTrajectory } from '../kinematics/demoProfile';
import { buildArrivalTrajectory, buildDepartureTrajectory, sampleTrajectory } from '../kinematics/estimator';
import { STATUS_MESSAGES, kinematicsMessages } from '../kinematics/kinematicsMessages';
import { perfFor } from '../kinematics/perfProfiles';
import { ktToMs, nmToM } from '../kinematics/units';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX,
  TRAFFIC_NOON, trafficInstant,
} from '../testing/trafficFixtures';
import { FORGET_AFTER_MS, arrivalsOnFinal, createMotionStore, planInputsKey } from './motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';

// The motion store on the synthetic traffic of the lab's noon (testing/trafficFixtures.js) over the signed Punta Cana
// layout, with the real kinematics. Every instant is explicit; nothing reads a clock.
const NOON = Date.parse(TRAFFIC_NOON);
const at = seconds => NOON + seconds * 1_000;
const DISABLED = toPictureModel(createAirPicture({ status: 'Disabled' }));
const LIVE = toPictureModel(createAirPicture());
const point = item => [item.lon, item.lat];
const standOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code);
const holdOf = id => MDPC_LAYOUT.apronHolds.find(hold => hold.id === id);
const JFK = [-73.7781, 40.6413];
const es = createTranslator(kinematicsMessages, 'es');

/** The real trajectory builders, counting their calls (and the anchor each one was asked for). */
function spied() {
  const calls = { demo: 0, arrival: [], departure: [] };
  const build = {
    fitDemoTrajectory: input => {
      calls.demo += 1;
      return fitDemoTrajectory(input);
    },
    buildArrivalTrajectory: input => {
      calls.arrival.push(input.anchor?.kind ?? 'schedule');
      return buildArrivalTrajectory(input);
    },
    buildDepartureTrajectory: input => {
      calls.departure.push(input.anchor?.kind ?? 'schedule');
      return buildDepartureTrajectory(input);
    },
  };
  return { build, calls };
}

const flightsOf = response => toFlightsModel(response);
/** The demo pair alone, on `block`. */
const demoOnly = (block, options) => {
  const response = createDemoFlights(block, options);
  return flightsOf({ ...response, flights: response.flights.filter(row => row.isDemo) });
};
const demoEstimate = (store, tMs, key = KEY.demoArrival) => store.estimatesAt(tMs).find(item => item.flightKey === key);
/** The situation at `nowMs` with the store's estimates, as useMapSituation builds it. */
const situationOf = (store, { picture, flights }, nowMs = NOON) => buildSituation({ picture, flights, nowMs,
  estimates: store.estimatesAt(nowMs), estimatesChangeAt: store.nextChangeAt(nowMs) });

describe('motion store (design F4, contracts 2.3)', () => {
  it('caches a trajectory by its inputs and rebuilds it only when they change', () => {
    const { build, calls } = spied();
    const store = createMotionStore({ build });
    const block = () => createDemoBlock({ appearAt: at(-60) });
    const read = () => ({ picture: DISABLED, flights: flightsOf(createDemoFlights(block())) });
    store.ingest(read());
    // The demo visit, and the real flights F-1 draws: ZZ161 approaching, ZZ300 parked, ZZ500 en route, ZZ700 leaving.
    expect(calls.demo).toBe(1);
    expect(calls.arrival).toEqual(['schedule', 'schedule', 'schedule']);
    expect(calls.departure).toEqual(['schedule']);
    const first = store.trajectoryOf(KEY.demoArrival);
    // The next reads bring the same flights in new objects, or the same objects: nothing is built again.
    store.ingest(read());
    const same = read();
    store.ingest(same);
    store.ingest(same);
    expect([calls.demo, calls.arrival.length, calls.departure.length]).toEqual([1, 3, 1]);
    expect(store.trajectoryOf(KEY.demoArrival)).toBe(first);
    // OCC imports the demo flight with B21: only its visit is built again.
    store.ingest({ picture: DISABLED, flights: flightsOf(createDemoFlights(createDemoBlock({ imported: true, appearAt: at(-60) }),
      { imported: true })) });
    expect([calls.demo, calls.arrival.length, calls.departure.length]).toEqual([2, 3, 1]);
    expect(store.trajectoryOf(KEY.demoArrival)).not.toBe(first);
    expect(store.trajectoryOf(KEY.demoArrival).meta.standCode).toBe('B21');

    // The key: equal rows give equal keys; any time, stand or milestone gives another.
    const [arrival] = createMapFlights().flights;
    expect(planInputsKey(arrival)).toBe(planInputsKey({ ...arrival }));
    expect(planInputsKey({ ...arrival, estimatedAt: trafficInstant(660) })).not.toBe(planInputsKey(arrival));
    expect(planInputsKey({ ...arrival, stand: { ...arrival.stand, code: 'A6' } })).not.toBe(planInputsKey(arrival));
    expect(planInputsKey({ ...arrival, milestones: [{ code: 'BLOCK_ON', actualAt: trafficInstant(5) }] }))
      .not.toBe(planInputsKey(arrival));
    expect(planInputsKey(arrival, { runway: { arrival: '26', departure: '26' } })).not.toBe(planInputsKey(arrival));
    // A demo flight's key is its clock: its server phase and row phase move with the time, its instants stay.
    const demo = flightsOf(createDemoFlights(block())).byKey.get(KEY.demoArrival);
    expect(planInputsKey({ ...demo, phase: 'landed', demo: { ...demo.demo, phase: 'TaxiIn' } })).toBe(planInputsKey(demo));
    expect(planInputsKey({ ...demo, demo: { ...demo.demo, offBlockAt: trafficInstant(900) } })).not.toBe(planInputsKey(demo));
  });

  it('a demo flight follows fitDemoTrajectory with the server instants on runway 08', { timeout: 30_000 }, () => {
    // A live arrival on final for 26 turns the runway of real flights; the demo flight still lands on 08.
    const end26 = runwayEnd(MDPC_LAYOUT, '26');
    const [longitude, latitude] = destinationPoint(end26.threshold, end26.headingTrue + 180, nmToM(6));
    const base = createAirPicture();
    const on26 = { ...base.aircraft[1], latitude, longitude, altitudeFeet: 1_900, groundSpeedKnots: 150,
      trackDegrees: end26.headingTrue, verticalRateFeetPerMinute: -700, onGround: false };
    const picture = toPictureModel({ ...base, aircraft: [on26] });
    expect(arrivalsOnFinal(picture.aircraft, MDPC_LAYOUT)).toEqual([{ trackDeg: end26.headingTrue }]);
    const block = createDemoBlock({ appearAt: at(-60) });
    const store = createMotionStore();
    store.ingest({ picture, flights: flightsOf(createDemoFlights(block)) });
    expect(store.runway()).toEqual({ arrival: '26', departure: '26', source: 'live' });
    // The same trajectory the map would fit by hand: not imported, so to terminal B's apron hold (B21 is suggested).
    const expected = fitDemoTrajectory({
      demo: demoClock(block, parseInstant), imported: false, apronHold: holdOf('ah-b'), counterpart: JFK, destination: JFK,
      perf: perfFor({ typeIcao: 'A320' }), layout: MDPC_LAYOUT,
    });
    for (const seconds of [-60, 0, 150, 220, 300, 420]) {
      const estimate = demoEstimate(store, at(seconds));
      const wanted = sampleTrajectory(expected, at(seconds));
      expect(haversineM(point(estimate), point(wanted)), `${seconds} s`).toBeLessThan(0.01);
      expect(estimate.altM, `${seconds} s`).toBeCloseTo(wanted.altM, 6);
      expect(estimate).toMatchObject({ mode: 'estimate', positionAt: at(seconds) });
    }
    expect(store.trajectoryOf(KEY.demoArrival).meta).toMatchObject({ runwayIdent: '08', departureRunwayIdent: '08' });
    // Wheels on 08 at touchdownAt: 300 m past its threshold.
    const touchdown = demoEstimate(store, parseInstant(block.touchdownAt));
    expect(haversineM(point(touchdown), runwayEnd(MDPC_LAYOUT, '08').threshold)).toBeCloseTo(300, 0);
    // Not before it appears; it moves while it flies.
    expect(demoEstimate(store, at(-61))).toBeUndefined();
    expect(store.isAnimating(at(0))).toBe(true);
  });

  it('an un-imported demo waits at the apron hold awaiting a stand, not imported', () => {
    // Fired ten minutes before noon for 8 minutes: it reached the hold before its on-block, two minutes ago.
    const store = createMotionStore();
    store.ingest({ picture: DISABLED, flights: demoOnly(createDemoBlock({ appearAt: at(-600) })) });
    const waiting = demoEstimate(store, at(0));
    expect(waiting).toMatchObject({ statusKey: 'awaitingStandNotImported', gsMs: 0, onGround: true, opacity: 1 });
    expect(haversineM(point(waiting), holdOf('ah-b').p)).toBeLessThan(0.5);
    expect(es(STATUS_MESSAGES[waiting.statusKey])).toBe('Esperando posición · sin importar');
    expect(store.followTargets(KEY.demoArrival)).toMatchObject({ stand: null, apronHold: holdOf('ah-b').p });
    // Standing still, nothing animates.
    expect(store.isAnimating(at(0))).toBe(false);
  });

  it('importing the demo continues from where it is drawn without a jump', { timeout: 30_000 }, () => {
    // Taxiing to terminal B's hold at noon (touchdown 136 s before), when OCC imports it with B21.
    const store = createMotionStore();
    const appearAt = at(-400);
    store.ingest({ picture: DISABLED, flights: demoOnly(createDemoBlock({ appearAt })) });
    const before = Array.from({ length: 6 }, (_, step) => demoEstimate(store, at(-5 + step)));
    expect(before[5]).toMatchObject({ onGround: true, statusKey: null });
    expect(before[5].gsMs).toBeGreaterThan(0);
    // The flights read at noon brings the import: from noon on it taxis to B21 from where it was.
    store.ingest({ picture: DISABLED, flights: demoOnly(createDemoBlock({ imported: true, appearAt }), { imported: true }) });
    for (let step = 0; step < 6; step += 1) {
      expect(haversineM(point(demoEstimate(store, at(-5 + step))), point(before[step])), `${step - 5} s`).toBeLessThan(0.01);
    }
    let previous = demoEstimate(store, at(0));
    for (let seconds = 1; seconds <= 120; seconds += 1) {
      const next = demoEstimate(store, at(seconds));
      expect(haversineM(point(previous), point(next)), `${seconds} s`).toBeLessThan(ktToMs(26) * 1);
      previous = next;
    }
    // It reaches B21 and parks there, with nothing left to wait for.
    const parked = demoEstimate(store, at(900));
    expect(haversineM(point(parked), standOf('B21').center)).toBeLessThan(0.5);
    expect(parked).toMatchObject({ statusKey: null, gsMs: 0 });
    expect(store.trajectoryOf(KEY.demoArrival).meta.anchor).toMatchObject({ kind: 'demo', continuedAtMs: NOON });
    expect(store.followTargets(KEY.demoArrival)).toMatchObject({ stand: standOf('B21').center, apronHold: null });
  });

  it('a cancelled demo fades out where it is, cancelled by the provider', () => {
    // On approach at noon (touchdown 64 s later); the provider cancels it at noon and the map reads it 3 s later.
    const store = createMotionStore();
    const appearAt = at(-200);
    store.ingest({ picture: DISABLED, flights: demoOnly(createDemoBlock({ appearAt })) });
    const drawn = [1, 2, 4].map(seconds => demoEstimate(store, at(seconds)));
    const cancelled = createDemoFlights(createDemoBlock({ appearAt, cancelAtMs: at(0) }));
    store.ingest({ picture: DISABLED, flights: flightsOf({ ...cancelled, flights: cancelled.flights.filter(row => row.isDemo),
      serverTime: trafficInstant(3) }) });
    [1, 2, 4].forEach((seconds, index) => {
      const fading = demoEstimate(store, at(seconds));
      expect(haversineM(point(fading), point(drawn[index])), `${seconds} s`).toBeLessThan(0.01);
      expect(fading.statusKey).toBe('cancelledByProvider');
      expect(fading.onGround).toBe(false);
    });
    // Fading from the cancel instant: before the read as the server's clock says; after it, from where it was drawn.
    expect(demoEstimate(store, at(2)).opacity).toBeCloseTo(0.75, 6);
    const afterRead = demoEstimate(store, at(4)).opacity;
    expect(afterRead).toBeGreaterThan(0.5);
    expect(afterRead).toBeLessThan(1);
    expect(es(STATUS_MESSAGES.cancelledByProvider)).toBe('Cancelado por el proveedor (demo)');
    // Gone once the fade is over; while it fades, it animates.
    expect(store.isAnimating(at(4))).toBe(true);
    expect(demoEstimate(store, at(8))).toBeUndefined();
    expect(demoEstimate(store, at(600))).toBeUndefined();
  });

  it('an AVIAM flight without a fix is estimated only per Decision F-1', () => {
    const store = createMotionStore();
    store.ingest({ picture: DISABLED, flights: flightsOf(createMapFlights()) });
    // Approaching, parked at its stand, en route, leaving after its push-back, and the demo flight: drawn. The
    // departures waiting for a push-back (ZZ162, ZZ301) and the demo's own departure (its arrival has the aircraft) are not.
    expect(store.estimatesAt(at(0)).map(item => item.flightKey).sort())
      .toEqual([KEY.arrival, KEY.demoArrival, KEY.parkedArrival, KEY.noFix, KEY.departed].sort());
    const parked = store.estimatesAt(at(0)).find(item => item.flightKey === KEY.parkedArrival);
    expect(haversineM(point(parked), standOf('A2').center)).toBeLessThan(0.5);
    // Merely scheduled, cancelled or diverted: not drawn (only a route, when chosen).
    for (const phase of ['scheduled', 'cancelled', 'diverted', 'unknown']) {
      const flights = createMapFlights();
      const changed = { ...flights, flights: flights.flights.map(row => (row.flightKey === KEY.noFix ? { ...row, phase } : row)) };
      const other = createMotionStore();
      other.ingest({ picture: DISABLED, flights: flightsOf(changed) });
      expect(other.estimatesAt(at(0)).map(item => item.flightKey), phase).not.toContain(KEY.noFix);
    }
    // With its live fix ZZ161 is the fix's, never an estimate.
    const live = createMotionStore();
    live.ingest({ picture: LIVE, flights: flightsOf(createMapFlights()) });
    expect(live.estimatesAt(at(0)).map(item => item.flightKey)).not.toContain(KEY.arrival);
    // The situation draws each of them as estimated, with the store's next change as its own.
    const read = { picture: DISABLED, flights: flightsOf(createMapFlights()) };
    const situation = situationOf(store, read);
    expect(situation.aircraft.filter(item => item.quality === 'estimated')).toHaveLength(5);
    expect(situation.changesAt).toBe(store.nextChangeAt(NOON));
  });

  it('an imported departure never leaves its stand by estimate: only PUSHBACK or a live fix', () => {
    const store = createMotionStore();
    store.ingest({ picture: DISABLED, flights: flightsOf(createMapFlights()) });
    // ZZ301 was due at 11:40; at 11:45, without a push-back, ZZ300's aircraft is still parked at A2.
    const late = store.estimatesAt(at(45 * 60));
    expect(late.map(item => item.flightKey)).toContain(KEY.parkedArrival);
    expect(late.map(item => item.flightKey)).not.toContain(KEY.parkedDeparture);
    const parked = late.find(item => item.flightKey === KEY.parkedArrival);
    expect(haversineM(point(parked), standOf('A2').center)).toBeLessThan(0.5);
    expect(parked.gsMs).toBe(0);
    // The tablet records PUSHBACK at 11:41: the departure takes the aircraft at the stand and pushes back.
    const pushbackAt = trafficInstant(41 * 60);
    const base = createMapFlights({ serverTime: trafficInstant(41 * 60 + 5) });
    const pushed = { ...base, flights: base.flights.map(row => (row.visitKey === `t:${'5d000000-0000-4000-8000-000000000300'}`
      ? { ...row, milestones: [...row.milestones, { code: 'PUSHBACK', actualAt: pushbackAt }] } : row)) };
    store.ingest({ picture: DISABLED, flights: flightsOf(pushed) });
    const leaving = store.estimatesAt(at(41 * 60 + 20));
    expect(leaving.map(item => item.flightKey)).toContain(KEY.parkedDeparture);
    expect(leaving.map(item => item.flightKey)).not.toContain(KEY.parkedArrival);
    const departure = leaving.find(item => item.flightKey === KEY.parkedDeparture);
    expect(departure.gsMs).toBeGreaterThan(0);
    expect(haversineM(point(departure), standOf('A2').center)).toBeLessThan(80);
    // A live fix of the departure draws it instead, with no estimate at all for the visit.
    const fixed = createMotionStore();
    const picture = createAirPicture();
    const onStand = { ...picture.aircraft[2], matchedFlightKey: KEY.parkedDeparture, matchedBy: 'Registration' };
    fixed.ingest({ picture: toPictureModel({ ...picture, aircraft: [onStand] }), flights: flightsOf(createMapFlights()) });
    expect(fixed.estimatesAt(at(0)).map(item => item.flightKey)).not.toContain(KEY.parkedArrival);
    expect(fixed.estimatesAt(at(0)).map(item => item.flightKey)).not.toContain(KEY.parkedDeparture);
  });

  it('trajectoryForRoute gives the planned trajectory, else one from the schedule for the route alone', () => {
    const { build, calls } = spied();
    const store = createMotionStore({ build });
    const flights = flightsOf(createMapFlights());
    store.ingest({ picture: DISABLED, flights });
    const rowOf = key => flights.byKey.get(key);
    // A flight the store draws: the very trajectory it plans (ZZ161 approaching, the demo visit).
    expect(store.trajectoryForRoute(rowOf(KEY.arrival))).toBe(store.trajectoryOf(KEY.arrival));
    expect(store.trajectoryForRoute(rowOf(KEY.demoArrival))).toBe(store.trajectoryOf(KEY.demoArrival));
    // ZZ162 waits for its push-back, so F-1 does not draw it: its way out from A5 at its scheduled off-block, built
    // once for the route and never as an estimate.
    const departures = calls.departure.length;
    const zz162 = store.trajectoryForRoute(rowOf(KEY.departure));
    expect(zz162).toMatchObject({ kind: 'departure', startMs: at(75 * 60), meta: { standCode: 'A5', departureRunwayIdent: '08' } });
    expect(haversineM(point(sampleTrajectory(zz162, at(75 * 60))), standOf('A5').center)).toBeLessThan(1);
    expect(store.trajectoryForRoute(rowOf(KEY.departure))).toBe(zz162);
    expect(calls.departure.length).toBe(departures + 1);
    expect(store.estimatesAt(at(0)).map(item => item.flightKey)).not.toContain(KEY.departure);
    // An arrival merely scheduled: from its origin, Miami, to its stand B30, by its schedule (on its stand at 11:48).
    const base = createMapFlights();
    const scheduled = flightsOf({ ...base, flights: base.flights.map(row => (row.flightKey === KEY.noFix
      ? { ...row, phase: 'scheduled', providerStatus: 'Expected' } : row)) });
    const later = createMotionStore();
    later.ingest({ picture: DISABLED, flights: scheduled });
    expect(later.estimatesAt(at(0)).map(item => item.flightKey)).not.toContain(KEY.noFix);
    expect(later.trajectoryOf(KEY.noFix)).toBeNull();
    const zz500 = later.trajectoryForRoute(scheduled.byKey.get(KEY.noFix));
    expect(zz500).toMatchObject({ kind: 'arrival', meta: { standCode: 'B30', runwayIdent: '08' } });
    expect(haversineM(point(sampleTrajectory(zz500, zz500.startMs)), [-80.2906, 25.7932])).toBeLessThan(1);
    expect(haversineM(point(sampleTrajectory(zz500, at(48 * 60))), standOf('B30').center)).toBeLessThan(1);
    // Nothing for a cancelled or diverted flight, nor for a row without a key.
    for (const phase of ['cancelled', 'diverted']) {
      expect(later.trajectoryForRoute({ ...scheduled.byKey.get(KEY.noFix), phase }), phase).toBeNull();
      expect(store.trajectoryForRoute({ ...rowOf(KEY.arrival), phase }), phase).toBeNull();
    }
    expect(store.trajectoryForRoute(null)).toBeNull();
    expect(store.trajectoryForRoute({ flightKey: null })).toBeNull();
  });

  it('a live fix goes live, coast and estimate as it ages and is rebuilt from the fix once', () => {
    const { build, calls } = spied();
    const store = createMotionStore({ build });
    const read = { picture: LIVE, flights: flightsOf(createMapFlights()) };
    store.ingest(read);
    const item = situationOf(store, read).byId.get(`f:${KEY.arrival}`);
    // ZZ161's fix is 4 s old at noon: live by dead reckoning, then coasting on its plan, saying it has no signal.
    const fix = LIVE.aircraft.find(aircraft => aircraft.hex === HEX.arrival);
    const live = store.sampleOne(item.id, at(5), item);
    expect(live).toMatchObject({ mode: 'live', quality: 'live', statusKey: null, timeScale: 1, opacity: 1 });
    expect(haversineM(point(live), destinationPoint(point(fix), fix.trackDeg, fix.gsMs * 9))).toBeLessThan(0.5);
    const coast = store.sampleOne(item.id, at(20), item);
    expect(coast).toMatchObject({ mode: 'coast', quality: 'live', statusKey: 'noSignal' });
    expect(calls.arrival.filter(kind => kind === 'fix')).toEqual([]);
    // Past the coast it is rebuilt from its last fix, once, and drawn as an estimate.
    const estimate = store.sampleOne(item.id, at(70), item);
    expect(estimate).toMatchObject({ mode: 'estimate', quality: 'estimated' });
    expect(calls.arrival.filter(kind => kind === 'fix')).toEqual(['fix']);
    store.sampleOne(item.id, at(80), item);
    store.sample([item], at(90));
    expect(calls.arrival.filter(kind => kind === 'fix')).toEqual(['fix']);
    // The merged aircraft keeps everything the situation knows of it.
    expect(estimate).toMatchObject({ id: item.id, kind: 'aviam', flightKey: KEY.arrival, flightNumber: 'ZZ161', hex: HEX.arrival });
  });

  it('other traffic dead-reckons and is dropped at 120 s', () => {
    const store = createMotionStore();
    const read = { picture: LIVE, flights: flightsOf(createMapFlights()) };
    store.ingest(read);
    const item = situationOf(store, read).byId.get(`h:${HEX.overflight}`);
    const fix = LIVE.aircraft.find(aircraft => aircraft.hex === HEX.overflight);
    // Its fix is 6 s old at noon: 54 s later it has coasted 60 s straight on along its track.
    const coasted = store.sampleOne(item.id, at(54), item);
    expect(coasted).toMatchObject({ mode: 'coast', statusKey: 'noSignal', opacity: 1 });
    expect(haversineM(point(coasted), destinationPoint(point(fix), fix.trackDeg, fix.gsMs * 60))).toBeLessThan(1);
    // Then it fades out, still going straight, and is gone 120 s after its fix.
    const fading = store.sampleOne(item.id, at(84), item);
    expect(fading.mode).toBe('estimate');
    expect(fading.opacity).toBeCloseTo(0.5, 6);
    expect(fading.quality).toBe('live');
    expect(store.sampleOne(item.id, at(114), item)).toBeNull();
    expect(store.sample([item], at(200))).toEqual([null]);
    // An aircraft the store does not know is drawn as the situation gave it.
    const stranger = { ...item, id: 'h:abcdef' };
    expect(store.sample([stranger], at(0))).toEqual([stranger]);
    expect(FORGET_AFTER_MS).toBe(600_000);
  });

  it('one aircraft per visit: the departure takes over at the off-block', { timeout: 30_000 }, () => {
    // Imported on B21, parked since 30 s before noon, its push-back 30 s after noon.
    const block = createDemoBlock({ imported: true, offBlockAfterMin: 1, appearAt: at(-510) });
    const offBlock = parseInstant(block.offBlockAt);
    expect(offBlock).toBe(at(30));
    const store = createMotionStore();
    store.ingest({ picture: DISABLED, flights: demoOnly(block, { imported: true }) });
    const keys = tMs => store.estimatesAt(tMs).map(item => item.flightKey);
    expect(keys(at(29))).toEqual([KEY.demoArrival]);
    expect(keys(at(31))).toEqual([KEY.demoDeparture]);
    const parked = demoEstimate(store, offBlock - 1);
    const leaving = demoEstimate(store, offBlock + 1, KEY.demoDeparture);
    expect(haversineM(point(parked), point(leaving))).toBeLessThan(0.01);
    expect(haversineM(point(parked), standOf('B21').center)).toBeLessThan(0.5);
    // The situation changes then: one of its next instants is the off-block.
    expect(store.nextChangeAt(at(0))).toBe(offBlock);
  });

  it('carries the time scale of the part the aircraft is in', { timeout: 30_000 }, () => {
    // Two minutes to the stand leave 30 s in the air: the air part is compressed, the ground part runs in real time.
    const store = createMotionStore();
    store.ingest({ picture: DISABLED, flights: demoOnly(createDemoBlock({ minutes: 2, appearAt: at(-10) })) });
    const trajectory = store.trajectoryOf(KEY.demoArrival);
    const airScale = trajectory.meta.parts.air.timeScale;
    expect(airScale).toBeGreaterThan(1);
    expect(trajectory.scaledParts).toContain('air');
    expect(demoEstimate(store, at(0)).timeScale).toBe(airScale);
    const taxiing = demoEstimate(store, at(60));
    expect(taxiing.onGround).toBe(true);
    expect(taxiing.timeScale).toBe(trajectory.meta.parts.taxiIn.timeScale);
  });

  it('trackConfigFor widens the limits for a slow feed', () => {
    const slow = toPictureModel(createAirPicture({ refreshAfterSeconds: 30 }));
    const store = createMotionStore();
    const read = { picture: slow, flights: flightsOf(createMapFlights()) };
    store.ingest(read);
    const item = situationOf(store, read).byId.get(`h:${HEX.overflight}`);
    // 40 s after its fix: still live with a 30 s feed (1.5 × 30 = 45 s), coasting with the usual 10 s one.
    expect(store.sampleOne(item.id, at(34), item).mode).toBe('live');
    const usual = createMotionStore();
    usual.ingest({ picture: LIVE, flights: read.flights });
    expect(usual.sampleOne(item.id, at(34), item).mode).toBe('coast');
    // It fades out from 90 s and is gone at 150 s.
    expect(store.sampleOne(item.id, at(114), item).opacity).toBeCloseTo(0.5, 6);
    expect(store.sampleOne(item.id, at(144), item)).toBeNull();
  });

  it('nextChangeAt names the next touchdown, on-block or vanish', { timeout: 30_000 }, () => {
    const block = createDemoBlock({ imported: true, offBlockAfterMin: 20, appearAt: at(-60) });
    const instants = ['touchdownAt', 'onBlockAt', 'offBlockAt', 'vanishAt'].map(key => parseInstant(block[key]));
    const store = createMotionStore();
    store.ingest({ picture: DISABLED, flights: demoOnly(block, { imported: true }) });
    // From noon: the touchdown, then the on-block, the off-block and the start of the fade.
    let from = NOON;
    const seen = [];
    for (let step = 0; step < 4; step += 1) {
      const next = store.nextChangeAt(from);
      seen.push(next);
      from = next;
    }
    expect(seen.map((instant, index) => Math.abs(instant - instants[index]) < 1_000)).toEqual([true, true, true, true]);
    // The take-off is not one: the aircraft is already drawn as the departure. After the fade, it is gone for good.
    const end = store.trajectoryOf(KEY.demoArrival).endMs;
    expect(store.nextChangeAt(instants[3])).toBe(end);
    expect(store.nextChangeAt(end)).toBeNull();
    // An ELEVANT flight's live fix adds the instant it loses its signal (ZZ161's, 4 s old at noon), then its coast.
    const [zz161] = createAirPicture().aircraft;
    const base = createMapFlights();
    const live = createMotionStore();
    live.ingest({ picture: toPictureModel(createAirPicture({ aircraft: [zz161] })),
      flights: flightsOf({ ...base, flights: base.flights.filter(row => row.flightKey === KEY.arrival) }) });
    expect(live.nextChangeAt(NOON)).toBe(at(-4) + 15_000 + 1);
    expect(live.nextChangeAt(at(-4) + 15_000 + 1)).toBe(at(-4) + 60_000 + 1);
    // Other traffic adds none: its frames carry it on and fade it out without a new situation.
    const other = createMotionStore();
    other.ingest({ picture: toPictureModel(createAirPicture({ aircraft: [createAirPicture().aircraft[1]] })),
      flights: flightsOf({ ...base, flights: [] }) });
    expect(other.nextChangeAt(NOON)).toBeNull();
  });
});
