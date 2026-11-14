import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { destinationPoint, haversineM, measurePolyline, pointToPolylineM } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { demoClock, fitDemoTrajectory } from './demoProfile.js';
import { alongAt, buildArrivalTrajectory, buildDepartureTrajectory, sampleTrajectory, trajectoryLine } from './estimator.js';
import { FLIGHT_ROUTE_MARKS, FLIGHT_ROUTE_PARTS, buildFlightRoute } from './flightRoute.js';
import { KINEMATICS_ORIGIN, createKinematicsLayout } from './kinematicsFixtures.js';
import { ROUTE_LABELS, kinematicsMessages } from './kinematicsMessages.js';
import { perfFor } from './perfProfiles.js';

// The route of the chosen flight on the synthetic aerodrome (kinematicsFixtures.js), with trajectories from the real
// estimator and demo profile on an explicit clock.
const T0 = Date.parse('2026-11-14T15:00:00Z');
const iso = ms => (ms === null ? null : new Date(ms).toISOString());
const parseInstant = value => (typeof value === 'string' ? Date.parse(value) : null);
const PERF = perfFor({ typeIcao: 'A320' });
const layout = createKinematicsLayout();
const END_09 = runwayEnd(layout, '09');
const standOf = code => layout.stands.find(stand => stand.code === code);
const nodePoint = id => layout.taxiGraph.nodes.find(node => node.id === id).p;
// The origin airport 400 km west, and a destination 2 000 km north-east.
const ORIGIN = destinationPoint(KINEMATICS_ORIGIN, 270, 400_000);
const DESTINATION = destinationPoint(KINEMATICS_ORIGIN, 45, 2_000_000);
const ARRIVAL = Object.freeze({ flightKey: 'p:11111111-0000-4000-8000-000000000001', direction: 'Arrival', isDemo: false });
const DEPARTURE = Object.freeze({ flightKey: 'p:22222222-0000-4000-8000-000000000002', direction: 'Departure', isDemo: false });
const DEMO = Object.freeze({ flightKey: 'p:33333333-0000-4000-8000-000000000003', direction: 'Arrival', isDemo: true });

/** A scheduled arrival from ORIGIN to `stand` (`null`: to an apron hold, where it waits), on its stand an hour after T0. */
function arrival(stand) {
  return buildArrivalTrajectory({
    times: { scheduledAtMs: T0 + 3_600_000, estimatedAtMs: null, actualAtMs: null, actualKind: null, blockOnAtMs: null, pushbackAtMs: null },
    origin: ORIGIN, layout, runwayEnd: END_09, stand, perf: PERF, imported: true,
  });
}

/** A demo flight triggered at T0 to reach its stand 8 minutes later, as the API's demo block has it. */
function demoVisit({ offBlockAfterMin = null } = {}) {
  const onBlock = T0 + 8 * 60_000;
  const offBlock = offBlockAfterMin === null ? null : onBlock + offBlockAfterMin * 60_000;
  const clock = demoClock({
    demoFlightId: '6b1e2c3d-0000-4000-8000-000000000042', state: 'Active', phase: 'Approach', appearAt: iso(T0),
    touchdownAt: iso(onBlock - 216_000), onBlockAt: iso(onBlock), scheduledOffBlockAt: iso(onBlock + 3_600_000),
    offBlockAt: iso(offBlock), takeoffAt: iso(offBlock === null ? null : offBlock + 300_000),
    vanishAt: iso(offBlock === null ? null : offBlock + 900_000),
  }, parseInstant);
  return fitDemoTrajectory({ demo: clock, imported: true, stand: standOf('S2'), counterpart: ORIGIN, destination: ORIGIN, perf: PERF, layout });
}

const partsOf = (route, part) => route.features.filter(feature => feature.properties.part === part);
const coordsOf = feature => feature.geometry.coordinates;
const first = feature => coordsOf(feature)[0];
const last = feature => coordsOf(feature)[coordsOf(feature).length - 1];
const lengthOf = feature => measurePolyline(coordsOf(feature)).lengthM;
const markOf = (route, mark) => route.features.find(feature => feature.properties.mark === mark) ?? null;
const at = sample => [sample.lon, sample.lat];
const touchdownOf = trajectory => trajectory.legs.find(leg => leg.phase === 'landing').t0Ms;
const lineLength = trajectory => {
  const { cumM } = trajectoryLine(trajectory);
  return cumM[cumM.length - 1];
};

/** Trail points of a trajectory at `seconds` from `tMs`, as traffic/trailStore.js records them. */
const trailOf = (trajectory, tMs, seconds) => seconds.map(offset => {
  const sample = sampleTrajectory(trajectory, tMs + offset * 1000);
  return { at: tMs + offset * 1000, lon: sample.lon, lat: sample.lat, altM: sample.altM, onGround: sample.onGround };
});

describe('route of the chosen flight', () => {
  it('the remaining part ends at the stand centre through the taxi route, or at the apron hold labelled position pending', () => {
    const toStand = arrival(standOf('S3'));
    const tMs = touchdownOf(toStand) - 120_000;
    const route = buildFlightRoute(ARRIVAL, toStand, [], tMs);
    const [remaining] = partsOf(route, 'remaining');
    expect(remaining.properties).toEqual({ id: `${ARRIVAL.flightKey}:remaining:0`, flightKey: ARRIVAL.flightKey, part: 'remaining' });
    expect(haversineM(first(remaining), at(sampleTrajectory(toStand, tMs)))).toBeLessThan(0.5);
    expect(haversineM(last(remaining), standOf('S3').center)).toBeLessThan(0.5);
    // Over the threshold, along the runway to its exit and down the taxi route: taxiway B, the apron lane, the lead-in.
    for (const [label, point, tolerance] of [
      ['threshold 09', END_09.threshold, 1], ['exit x2', nodePoint('x2'), 35], ['junction j2', nodePoint('j2'), 35],
      ['lane at l1', nodePoint('l1'), 35], ['lead-in of S3', nodePoint('ls-S3'), 35],
    ]) {
      expect(pointToPolylineM(point, coordsOf(remaining)).distanceM, label).toBeLessThan(tolerance);
    }
    // Its marks: the touchdown 300 m past the threshold, the runway exit and the stand.
    const touchdown = markOf(route, 'touchdown');
    expect(touchdown.properties).toEqual({ id: `${ARRIVAL.flightKey}:mark:touchdown`, flightKey: ARRIVAL.flightKey, part: 'mark', mark: 'touchdown' });
    expect(touchdown.geometry.type).toBe('Point');
    expect(haversineM(coordsOf(touchdown), END_09.threshold)).toBeCloseTo(300, 0);
    expect(haversineM(coordsOf(markOf(route, 'runwayExit')), nodePoint('x2'))).toBeLessThan(60);
    expect(markOf(route, 'stand').properties).toMatchObject({ part: 'mark', mark: 'stand', standCode: 'S3' });
    expect(haversineM(coordsOf(markOf(route, 'stand')), standOf('S3').center)).toBeLessThan(0.5);
    expect(markOf(route, 'apronHold')).toBeNull();

    // Without a stand it ends at the apron hold where the aircraft waits, marked «Posición por asignar».
    const holding = arrival(null);
    const waiting = buildFlightRoute(ARRIVAL, holding, [], touchdownOf(holding) - 120_000);
    const hold = layout.apronHolds.find(item => item.id === holding.meta.apronHoldId);
    expect(haversineM(last(partsOf(waiting, 'remaining')[0]), hold.p)).toBeLessThan(0.5);
    const pending = markOf(waiting, 'apronHold');
    expect(pending.properties).toMatchObject({ mark: 'apronHold', labelKey: 'positionPending', apronHoldId: hold.id });
    expect(haversineM(coordsOf(pending), hold.p)).toBeLessThan(0.5);
    expect(createTranslator(kinematicsMessages, 'es')(ROUTE_LABELS[pending.properties.labelKey])).toBe('Posición por asignar');
    expect(markOf(waiting, 'stand')).toBeNull();

    // Parked, nothing remains and only the stand is marked: the marks behind the aircraft are gone.
    const parked = buildFlightRoute(ARRIVAL, toStand, [], T0 + 7_200_000);
    expect(partsOf(parked, 'remaining')).toEqual([]);
    expect(partsOf(parked, 'mark').map(feature => feature.properties.mark)).toEqual(['stand']);
  });

  it("a demo flight's flown part from the origin airport is estimated", () => {
    const visit = demoVisit();
    expect(visit.meta.originPath.length).toBeGreaterThan(1);
    const tMs = T0 + 60_000;
    const route = buildFlightRoute(DEMO, visit, [], tMs);
    expect(partsOf(route, 'flownObserved')).toEqual([]);
    const estimated = partsOf(route, 'flownEstimated');
    expect(estimated).toHaveLength(1);
    expect(estimated[0].properties).toEqual({
      id: `${DEMO.flightKey}:flownEstimated:0`, flightKey: DEMO.flightKey, part: 'flownEstimated', labelKey: 'flownEstimated',
    });
    // From the origin airport itself, through where the aircraft appeared, to where it is now.
    expect(haversineM(first(estimated[0]), ORIGIN)).toBeLessThan(0.01);
    expect(pointToPolylineM(at(sampleTrajectory(visit, T0)), coordsOf(estimated[0])).distanceM).toBeLessThan(0.5);
    expect(haversineM(last(estimated[0]), at(sampleTrajectory(visit, tMs)))).toBeLessThan(0.5);
    // As long as the path from the origin plus what the aircraft has flown since it appeared.
    expect(Math.abs(lengthOf(estimated[0]) - (measurePolyline(visit.meta.originPath).lengthM + alongAt(visit, tMs)))).toBeLessThan(5);
    // What is still to fly starts where the estimate ends.
    expect(haversineM(first(partsOf(route, 'remaining')[0]), last(estimated[0]))).toBeLessThan(0.5);
    // The legend's words.
    expect(createTranslator(kinematicsMessages, 'es')(ROUTE_LABELS.flownEstimated)).toBe('Trayecto estimado');
    expect(createTranslator(kinematicsMessages, 'en')(ROUTE_LABELS.flownEstimated)).toBe('Estimated path');
  });

  it('observed parts come from the trail and are never joined across a break', () => {
    const trajectory = arrival(standOf('S1'));
    const tMs = touchdownOf(trajectory) - 60_000;
    // Seen every 10 s from 6 to 2 minutes ago, with a break mark, a hand-off snap (a new trail epoch) and a long gap.
    const trail = trailOf(trajectory, tMs, [-360, -350, -340, -300, -290, -250, -240, -150, -140]).map((point, index) => ({
      ...point, breakBefore: index === 3, trailEpoch: index >= 5 ? 1 : 0,
    }));
    const route = buildFlightRoute(ARRIVAL, trajectory, trail, tMs, { breakMs: 60_000, origin: ORIGIN });
    const observed = partsOf(route, 'flownObserved');
    expect(observed.map(feature => feature.properties.id)).toEqual([0, 1, 2, 3].map(n => `${ARRIVAL.flightKey}:flownObserved:${n}`));
    const coords = trail.map(point => [point.lon, point.lat]);
    expect(observed.map(coordsOf)).toEqual([coords.slice(0, 3), coords.slice(3, 5), coords.slice(5, 7), coords.slice(7)]);
    // No line of the route joins two observed points either side of a break.
    const key = point => point.join(',');
    const across = new Set([[2, 3], [4, 5], [6, 7]].map(([a, b]) => `${key(coords[a])}>${key(coords[b])}`));
    for (const feature of route.features.filter(item => item.geometry.type === 'LineString')) {
      const line = coordsOf(feature);
      for (let index = 1; index < line.length; index += 1) {
        expect(across.has(`${key(line[index - 1])}>${key(line[index])}`), feature.properties.id).toBe(false);
      }
    }
    // Without `breakMs` the gap in time alone does not break it; a lone point after a break draws no line.
    expect(partsOf(buildFlightRoute(ARRIVAL, trajectory, trail, tMs), 'flownObserved')).toHaveLength(3);
    const lone = [...trail.slice(0, 3), { ...trail[3], breakBefore: true }];
    expect(partsOf(buildFlightRoute(ARRIVAL, trajectory, lone, tMs), 'flownObserved').map(coordsOf)).toEqual([coords.slice(0, 3)]);
    // In time order whatever order the points come in.
    expect(partsOf(buildFlightRoute(ARRIVAL, trajectory, [...trail].reverse(), tMs, { breakMs: 60_000 }), 'flownObserved').map(coordsOf))
      .toEqual(observed.map(coordsOf));
    // Estimated: from the origin to the first observed point, and from the last one to where the aircraft is now.
    const estimated = partsOf(route, 'flownEstimated');
    expect(estimated.map(feature => feature.properties.id)).toEqual([0, 1].map(n => `${ARRIVAL.flightKey}:flownEstimated:${n}`));
    expect(haversineM(first(estimated[0]), ORIGIN)).toBeLessThan(0.01);
    expect(last(estimated[0])).toEqual(coords[0]);
    expect(first(estimated[1])).toEqual(coords[8]);
    expect(haversineM(last(estimated[1]), at(sampleTrajectory(trajectory, tMs)))).toBeLessThan(0.5);
    // From the origin even when the trajectory begins at the last fix (rebuilt from it).
    const fix = { ...trail[8], gsMs: 80, trackDeg: END_09.headingTrue, positionAt: trail[8].at };
    const fromFix = buildArrivalTrajectory({ times: null, layout, runwayEnd: END_09, stand: standOf('S1'), perf: PERF, anchor: { kind: 'fix', fix } });
    const rebuilt = partsOf(buildFlightRoute(ARRIVAL, fromFix, trail, tMs, { origin: ORIGIN }), 'flownEstimated');
    expect(haversineM(first(rebuilt[0]), ORIGIN)).toBeLessThan(0.01);
    expect(last(rebuilt[0])).toEqual(coords[0]);
  });

  it('the split follows the aircraft: later the remaining part is shorter', () => {
    const trajectory = arrival(standOf('S4'));
    const touchdown = touchdownOf(trajectory);
    let previous = null;
    for (const tMs of [touchdown - 300_000, touchdown - 120_000, touchdown + 30_000, touchdown + 90_000]) {
      const route = buildFlightRoute(ARRIVAL, trajectory, [], tMs);
      const [estimated] = partsOf(route, 'flownEstimated');
      const [remaining] = partsOf(route, 'remaining');
      const here = at(sampleTrajectory(trajectory, tMs));
      expect(haversineM(first(remaining), here)).toBeLessThan(0.5);
      expect(haversineM(last(estimated), here)).toBeLessThan(0.5);
      // Together they are the whole route.
      expect(Math.abs(lengthOf(estimated) + lengthOf(remaining) - lineLength(trajectory))).toBeLessThan(2);
      if (previous !== null) {
        const flown = alongAt(trajectory, tMs) - alongAt(trajectory, previous.tMs);
        expect(flown).toBeGreaterThan(0);
        expect(Math.abs(previous.remaining - lengthOf(remaining) - flown)).toBeLessThan(2);
        expect(Math.abs(lengthOf(estimated) - previous.estimated - flown)).toBeLessThan(2);
      }
      previous = { tMs, remaining: lengthOf(remaining), estimated: lengthOf(estimated) };
    }
    // Where the map draws the aircraft (a live one 800 m ahead of the plan on final): the remaining part starts there.
    const tMs = touchdown - 120_000;
    const planned = at(sampleTrajectory(trajectory, tMs));
    const drawn = destinationPoint(planned, END_09.headingTrue, 800);
    const onPlan = partsOf(buildFlightRoute(ARRIVAL, trajectory, [], tMs), 'remaining')[0];
    const ahead = partsOf(buildFlightRoute(ARRIVAL, trajectory, [], tMs, { aircraft: drawn }), 'remaining')[0];
    expect(first(ahead)).toEqual(drawn);
    expect(Math.abs(lengthOf(onPlan) - lengthOf(ahead) - 800)).toBeLessThan(2);
  });

  it("a departure's remaining part runs stand, taxi route, runway, climb and the great circle to the destination", () => {
    const stand = standOf('S2');
    const offBlock = T0 + 3_600_000;
    const trajectory = buildDepartureTrajectory({
      times: { offBlockMs: offBlock, takeoffMs: null }, destination: DESTINATION, layout, runwayEnd: END_09, stand, perf: PERF,
    });
    const route = buildFlightRoute(DEPARTURE, trajectory, [], offBlock - 60_000);
    const [remaining] = partsOf(route, 'remaining');
    const coords = coordsOf(remaining);
    expect(haversineM(coords[0], stand.center)).toBeLessThan(0.5);
    expect(coords[coords.length - 1]).toEqual(DESTINATION);
    // In order: the stand, the holding point of taxiway A, the lift-off on the runway, the end of the drawn climb, the
    // great circle to the destination.
    const nearest = point => coords.reduce((best, coord, index) => {
      const distanceM = haversineM(coord, point);
      return distanceM < best.distanceM ? { index, distanceM } : best;
    }, { index: -1, distanceM: Infinity });
    const roll = trajectory.legs.find(leg => leg.phase === 'takeoff');
    const liftoff = roll.path.coords[roll.path.coords.length - 1];
    const line = trajectoryLine(trajectory).coords;
    const climbEnd = line[line.length - 1];
    const hold = nearest(nodePoint('hp-A-09-27'));
    const lift = nearest(liftoff);
    const top = nearest(climbEnd);
    expect(hold.distanceM).toBeLessThan(15);
    expect(lift.distanceM).toBeLessThan(1);
    expect(top.distanceM).toBeLessThan(1);
    expect(0 < hold.index && hold.index < lift.index && lift.index < top.index && top.index < coords.length - 1).toBe(true);
    expect(pointToPolylineM(liftoff, END_09.centerline).distanceM).toBeLessThan(1);
    // As long as the trajectory's line and the great circle from its end to the destination.
    expect(Math.abs(lengthOf(remaining) - (lineLength(trajectory) + haversineM(climbEnd, DESTINATION)))).toBeLessThan(5);
    // The stand is marked while the aircraft is there; once it is taxiing the route starts at the aircraft.
    expect(markOf(route, 'stand').properties).toMatchObject({ mark: 'stand', standCode: 'S2' });
    expect(partsOf(route, 'mark')).toHaveLength(1);
    const taxiing = buildFlightRoute(DEPARTURE, trajectory, [], offBlock + 240_000);
    expect(markOf(taxiing, 'stand')).toBeNull();
    expect(haversineM(first(partsOf(taxiing, 'remaining')[0]), at(sampleTrajectory(trajectory, offBlock + 240_000)))).toBeLessThan(0.5);
    expect(haversineM(first(partsOf(taxiing, 'flownEstimated')[0]), stand.center)).toBeLessThan(0.5);

    // A demo visit's trajectory holds both legs: the arrival row ends at the stand, the departure row starts there.
    const visit = demoVisit({ offBlockAfterMin: 30 });
    const inbound = buildFlightRoute(DEMO, visit, [], T0 + 60_000);
    const outbound = buildFlightRoute({ ...DEMO, direction: 'Departure' }, visit, [], T0 + 60_000);
    expect(haversineM(last(partsOf(inbound, 'remaining')[0]), stand.center)).toBeLessThan(0.5);
    expect(haversineM(first(partsOf(outbound, 'remaining')[0]), stand.center)).toBeLessThan(0.5);
    expect(last(partsOf(outbound, 'remaining')[0])).toEqual(ORIGIN);
    expect(partsOf(outbound, 'flownEstimated')).toEqual([]);
    expect(markOf(outbound, 'stand').properties.standCode).toBe('S2');
    expect(markOf(outbound, 'touchdown')).toBeNull();
  });

  it('feature ids are stable between calls', () => {
    expect(FLIGHT_ROUTE_PARTS).toEqual(['flownObserved', 'flownEstimated', 'remaining', 'mark']);
    expect(FLIGHT_ROUTE_MARKS).toEqual(['touchdown', 'runwayExit', 'stand', 'apronHold']);
    const trajectory = arrival(standOf('S3'));
    const tMs = touchdownOf(trajectory) - 150_000;
    const trail = trailOf(trajectory, tMs, [-50, -40, -30]);
    const one = buildFlightRoute(ARRIVAL, trajectory, trail, tMs, { origin: ORIGIN });
    // The same inputs give the same route, frozen.
    expect(buildFlightRoute(ARRIVAL, trajectory, trail, tMs, { origin: ORIGIN })).toEqual(one);
    expect(Object.isFrozen(one) && Object.isFrozen(one.features[0].properties) && Object.isFrozen(coordsOf(one.features[0])[0])).toBe(true);
    const ids = route => route.features.map(feature => feature.properties.id);
    const key = ARRIVAL.flightKey;
    expect(ids(one)).toEqual([
      `${key}:flownObserved:0`, `${key}:flownEstimated:0`, `${key}:flownEstimated:1`, `${key}:remaining:0`,
      `${key}:mark:touchdown`, `${key}:mark:runwayExit`, `${key}:mark:stand`,
    ]);
    // Thirty seconds later, with one more observed point, every part keeps its id.
    const later = buildFlightRoute(ARRIVAL, trajectory, [...trail, ...trailOf(trajectory, tMs, [-20])], tMs + 30_000, { origin: ORIGIN });
    expect(ids(later)).toEqual(ids(one));
    // Each id names its flight and its part, once.
    for (const { properties } of one.features) {
      expect(properties.id.startsWith(`${properties.flightKey}:${properties.part}:`)).toBe(true);
      expect(FLIGHT_ROUTE_PARTS).toContain(properties.part);
    }
    expect(new Set(ids(one)).size).toBe(one.features.length);
    // Without a trajectory only the trail is drawn; with nothing, nothing.
    expect(ids(buildFlightRoute(ARRIVAL, null, trail, tMs))).toEqual([`${key}:flownObserved:0`]);
    expect(buildFlightRoute(ARRIVAL, null, [], tMs).features).toEqual([]);
    expect(buildFlightRoute(null, null, null, Number.NaN)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
