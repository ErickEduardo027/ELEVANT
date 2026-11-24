import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM, measurePolyline, pointToPolylineM } from '../airport/geo';
import { runwayEnd } from '../airport/runwayInUse';
import { FLIGHT_ROUTE_PARTS, buildFlightRoute } from '../kinematics/flightRoute';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createMapFlights, createTrack, TRAFFIC_FLIGHT_KEY as KEY,
  TRAFFIC_HEX as HEX, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { createMotionStore } from './motionStore';
import { ROUTE_PARTS, buildRoute, standCentre, trailSegmentsOf, trailsBesideRoute } from './routeFeatures';
import { buildSituation, selectionTarget, toFlightsModel, toPictureModel, toTrackModel } from './situationModel';
import { createTrailStore, trailFeatures } from './trailStore';

// The route of the chosen flight on the signed Punta Cana layout at the lab's noon (testing/trafficFixtures.js): the
// situation and the trajectories of the real motion store (traffic/motionStore.js), the trails of a real trail store.
const NOON = Date.parse(TRAFFIC_NOON);
const MIA = [-80.2906, 25.7932];
const YYZ = [-79.6248, 43.6777];
const JFK = [-73.7781, 40.6413];
const THRESHOLD_08 = runwayEnd(MDPC_LAYOUT, '08').threshold;
const centreOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code).center;
const holdOf = id => MDPC_LAYOUT.apronHolds.find(hold => hold.id === id).p;

/** The noon situation of `flights` with the motion store's estimates, as useMapSituation builds it. */
function noon({ picture = createAirPicture(), flights = createMapFlights() } = {}) {
  const pictureModel = toPictureModel(picture);
  const flightsModel = toFlightsModel(flights);
  const motion = createMotionStore();
  motion.ingest({ picture: pictureModel, flights: flightsModel });
  const situation = buildSituation({ picture: pictureModel, flights: flightsModel, nowMs: NOON,
    estimates: motion.estimatesAt(NOON), estimatesChangeAt: motion.nextChangeAt(NOON) });
  return { picture: pictureModel, flights: flightsModel, motion, situation };
}

/** The route of a selection at noon, as useMapSituation asks for it: the trail of its aircraft and its trajectory. */
function routeOf(world, selection, options = {}) {
  const target = selectionTarget(selection, world.situation);
  const trails = createTrailStore();
  trails.ingestPicture(world.picture);
  const hex = target?.aircraft?.hex ?? null;
  if (hex === HEX.arrival) {
    const track = toTrackModel(createTrack(HEX.arrival));
    trails.ingestTrack(track.hex, track.points);
  }
  const route = buildRoute({
    target, segments: hex ? trails.segmentsOf(hex) : [], trajectory: target?.flight ? world.motion.trajectoryForRoute(target.flight) : null,
    nowMs: NOON, breakMs: trails.getSnapshot().breakMs, ...options,
  });
  return { target, route, trails };
}

const partsOf = (route, part) => route.features.filter(feature => feature.properties.part === part);
const coordsOf = feature => feature.geometry.coordinates;
const first = feature => coordsOf(feature)[0];
const last = feature => coordsOf(feature)[coordsOf(feature).length - 1];
const markOf = (route, mark) => route.features.find(feature => feature.properties.mark === mark) ?? null;

describe('the route of the chosen flight (design E5, PR M6)', () => {
  it('delegates to buildFlightRoute', () => {
    expect(ROUTE_PARTS).toBe(FLIGHT_ROUTE_PARTS);
    const world = noon();
    const { target, route, trails } = routeOf(world, { kind: 'flight', id: KEY.arrival });
    // ZZ161 live on final: its trail with the server's track, the trajectory the store plans for it, where it is.
    const trajectory = world.motion.trajectoryForRoute(target.flight);
    expect(trajectory).toBe(world.motion.trajectoryOf(KEY.arrival));
    const trail = trails.segmentsOf(HEX.arrival).flat();
    const direct = buildFlightRoute(target.flight, trajectory, trail, NOON, {
      origin: MIA, aircraft: [target.aircraft.lon, target.aircraft.lat], breakMs: trails.getSnapshot().breakMs,
      // CN-29: the target's own track, speed and ground flag.
      state: { trackDeg: target.aircraft.trackDeg, gsMs: target.aircraft.gsMs, onGround: target.aircraft.onGround === true },
    });
    // The same lines and points, and the same properties with the aircraft's address.
    expect(route.features.map(feature => feature.geometry)).toEqual(direct.features.map(feature => feature.geometry));
    expect(route.features.map(feature => feature.properties)).toEqual(direct.features.map(feature => ({
      ...feature.properties, hex: HEX.arrival,
    })));
    // What it flew observed (its track, 30 points up to its fix), estimated from Miami, and what is still to fly, from
    // where it is over the threshold of 08 to its stand A5, with the touchdown, the runway exit and the stand marked.
    expect(route.features.map(feature => feature.properties.id)).toEqual([
      `${KEY.arrival}:flownObserved:0`, `${KEY.arrival}:flownEstimated:0`, `${KEY.arrival}:remaining:0`,
      `${KEY.arrival}:mark:touchdown`, `${KEY.arrival}:mark:runwayExit`, `${KEY.arrival}:mark:stand`,
    ]);
    const [observed] = partsOf(route, 'flownObserved');
    expect(coordsOf(observed)).toHaveLength(30);
    expect(last(observed)).toEqual([target.aircraft.lon, target.aircraft.lat]);
    const [estimated] = partsOf(route, 'flownEstimated');
    expect(haversineM(first(estimated), MIA)).toBeLessThan(1);
    expect(last(estimated)).toEqual(first(observed));
    const [remaining] = partsOf(route, 'remaining');
    expect(first(remaining)).toEqual([target.aircraft.lon, target.aircraft.lat]);
    expect(pointToPolylineM(THRESHOLD_08, coordsOf(remaining)).distanceM).toBeLessThan(5);
    expect(haversineM(last(remaining), centreOf('A5'))).toBeLessThan(0.5);
    expect(markOf(route, 'stand').properties).toMatchObject({ standCode: 'A5', hex: HEX.arrival });
    // Where the map draws the aircraft now (`aircraft`, every frame): the split follows it.
    const ahead = buildRoute({ target, segments: trails.segmentsOf(HEX.arrival), trajectory, nowMs: NOON + 4_000,
      breakMs: trails.getSnapshot().breakMs, aircraft: [target.aircraft.lon + 0.004, target.aircraft.lat + 0.001] });
    expect(first(partsOf(ahead, 'remaining')[0])).toEqual([target.aircraft.lon + 0.004, target.aircraft.lat + 0.001]);
    expect(measurePolyline(coordsOf(partsOf(ahead, 'remaining')[0])).lengthM)
      .toBeLessThan(measurePolyline(coordsOf(remaining)).lengthM);
    // From then on, the line from its last fix to where it is drawn is estimated.
    expect(partsOf(ahead, 'flownEstimated').map(feature => feature.properties.id)).toEqual([
      `${KEY.arrival}:flownEstimated:0`, `${KEY.arrival}:flownEstimated:1`,
    ]);
  });

  it('observed parts come from the trail and are never joined across a gap', () => {
    const world = noon();
    const target = selectionTarget({ kind: 'flight', id: KEY.arrival }, world.situation);
    const trajectory = world.motion.trajectoryForRoute(target.flight);
    // Two parts of a trail drawn without their times: two lines, never one joined across the gap.
    const gapped = buildRoute({ target, trajectory, nowMs: NOON,
      segments: [[[-68.6, 18.5], [-68.55, 18.52]], [[-68.5, 18.54], [-68.46, 18.55]]] });
    expect(partsOf(gapped, 'flownObserved').map(coordsOf)).toEqual([[[-68.6, 18.5], [-68.55, 18.52]],
      [[-68.5, 18.54], [-68.46, 18.55]]]);
    // Points with their times: a part also ends where two of them are further apart than the break.
    const at = seconds => NOON + seconds * 1_000;
    const timed = [[{ at: at(-300), lon: -68.7, lat: 18.45 }, { at: at(-290), lon: -68.69, lat: 18.46 },
      { at: at(-120), lon: -68.6, lat: 18.5 }, { at: at(-110), lon: -68.59, lat: 18.51 }]];
    expect(partsOf(buildRoute({ target, trajectory, nowMs: NOON, segments: timed, breakMs: 60_000 }), 'flownObserved'))
      .toHaveLength(2);
    expect(partsOf(buildRoute({ target, trajectory, nowMs: NOON, segments: timed }), 'flownObserved')).toHaveLength(1);
    // Without a trail, the server's track alone.
    const track = toTrackModel(createTrack(HEX.arrival));
    expect(coordsOf(partsOf(buildRoute({ target, track, nowMs: NOON }), 'flownObserved')[0]))
      .toEqual(track.points.map(point => [point.lon, point.lat]));
  });

  it('other traffic draws only what it flew', () => {
    const world = noon();
    const { target, route } = routeOf(world, { kind: 'aircraft', id: HEX.overflight });
    expect(target.flight).toBeNull();
    // Its short trail: one observed line, keyed by the aircraft, with its address.
    expect(route.features.map(feature => feature.properties)).toEqual([{
      id: `h:${HEX.overflight}:flownObserved:0`, flightKey: null, part: 'flownObserved', hex: HEX.overflight,
    }]);
    // No plan of anyone else's, even if one is given: nothing estimated, nothing still to fly, no marks.
    const someone = world.motion.trajectoryOf(KEY.arrival);
    const segments = [[[-68.2, 18.6], [-68.15, 18.6]]];
    expect(buildRoute({ target, segments, trajectory: someone, nowMs: NOON }).features.map(feature => feature.properties.part))
      .toEqual(['flownObserved']);
    // Without a trail there is nothing to draw.
    expect(buildRoute({ target, nowMs: NOON })).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('a departure runs to its destination by the great circle', () => {
    const world = noon();
    // ZZ162 waits for its push-back at A5 (F-1 does not draw it): its planned way out, all still to fly.
    const { target, route } = routeOf(world, { kind: 'flight', id: KEY.departure });
    expect(target).toMatchObject({ flight: { flightNumber: 'ZZ162' }, aircraft: null });
    expect(route.features.map(feature => feature.properties.part)).toEqual(['remaining', 'mark']);
    const [remaining] = partsOf(route, 'remaining');
    expect(haversineM(first(remaining), centreOf('A5'))).toBeLessThan(0.5);
    // Down the runway it departs from and on by the great circle to Miami.
    expect(pointToPolylineM(THRESHOLD_08, coordsOf(remaining)).distanceM).toBeLessThan(60);
    expect(last(remaining)).toEqual(MIA);
    const tail = coordsOf(remaining).slice(-20);
    for (const point of tail) expect(point[0], 'west, towards Miami').toBeLessThan(-68.4);
    expect(markOf(route, 'stand').properties).toMatchObject({ mark: 'stand', standCode: 'A5', hex: '' });
    expect(partsOf(route, 'flownEstimated')).toEqual([]);

    // ZZ700 left A3 eight minutes ago for Toronto, drawn estimated: flown from its stand to where it is, the rest north.
    const gone = routeOf(world, { kind: 'flight', id: KEY.departed });
    expect(gone.target.aircraft).toMatchObject({ quality: 'estimated', onGround: false });
    const here = [gone.target.aircraft.lon, gone.target.aircraft.lat];
    const [flown] = partsOf(gone.route, 'flownEstimated');
    expect(haversineM(first(flown), centreOf('A3'))).toBeLessThan(0.5);
    expect(haversineM(last(flown), here)).toBeLessThan(0.5);
    const [ahead] = partsOf(gone.route, 'remaining');
    expect(haversineM(first(ahead), here)).toBeLessThan(0.5);
    expect(last(ahead)).toEqual(YYZ);
    // Its stand is behind it now: no mark.
    expect(partsOf(gone.route, 'mark')).toEqual([]);
  });

  it('an un-assigned arrival ends at the apron hold labelled Posición por asignar', () => {
    // The demo arrival nobody imported (B21 suggested): estimated from New York, to terminal B's apron hold.
    const world = noon({ flights: createDemoFlights(createDemoBlock({ appearAt: NOON - 60_000 })) });
    const { target, route } = routeOf(world, { kind: 'flight', id: KEY.demoArrival });
    expect(target.aircraft).toMatchObject({ isDemo: true, quality: 'estimated' });
    const [estimated] = partsOf(route, 'flownEstimated');
    expect(haversineM(first(estimated), JFK)).toBeLessThan(1);
    const [remaining] = partsOf(route, 'remaining');
    expect(haversineM(last(remaining), holdOf('ah-b'))).toBeLessThan(0.5);
    const hold = markOf(route, 'apronHold');
    expect(hold.properties).toMatchObject({ part: 'mark', mark: 'apronHold', labelKey: 'positionPending',
      label: 'Posición por asignar', apronHoldId: 'ah-b' });
    expect(haversineM(coordsOf(hold), holdOf('ah-b'))).toBeLessThan(0.5);
    expect(markOf(route, 'stand')).toBeNull();
    // In English, the words of the map's language; only the hold has words.
    const english = routeOf(world, { kind: 'flight', id: KEY.demoArrival }, { language: 'en' }).route;
    expect(markOf(english, 'apronHold').properties.label).toBe('Stand to be assigned');
    expect(english.features.filter(feature => feature.properties.label !== undefined).map(feature => feature.properties.mark))
      .toEqual(['apronHold']);
    // A real arrival without a stand waits at a hold too; with one, it ends at its stand.
    const base = createMapFlights();
    const standless = noon({ flights: { ...base, flights: base.flights.map(row => (row.flightKey === KEY.arrival
      ? { ...row, stand: null } : row)) } });
    const waiting = routeOf(standless, { kind: 'flight', id: KEY.arrival }).route;
    expect(markOf(waiting, 'apronHold').properties.label).toBe('Posición por asignar');
    expect(markOf(waiting, 'stand')).toBeNull();
  });

  it('a flight the map does not draw shows all of its route still to fly, or all flown once it is over', () => {
    const base = createMapFlights();
    // ZZ500 merely scheduled: F-1 draws no aircraft, its route runs from Miami to B30, nothing flown.
    const scheduled = noon({ flights: { ...base, flights: base.flights.map(row => (row.flightKey === KEY.noFix
      ? { ...row, phase: 'scheduled', providerStatus: 'Expected' } : row)) } });
    const ahead = routeOf(scheduled, { kind: 'flight', id: KEY.noFix });
    expect(ahead.target.aircraft).toBeNull();
    expect(ahead.route.features.map(feature => feature.properties.part)).toEqual(['remaining', 'mark', 'mark', 'mark']);
    expect(haversineM(first(partsOf(ahead.route, 'remaining')[0]), MIA)).toBeLessThan(1);
    expect(haversineM(last(partsOf(ahead.route, 'remaining')[0]), centreOf('B30'))).toBeLessThan(0.5);
    // ZZ300 on its stand A2 since 10:38: its whole way in from Toronto flown, estimated, and only its stand marked.
    const parked = routeOf(noon(), { kind: 'flight', id: KEY.parkedArrival });
    expect(parked.route.features.map(feature => feature.properties.part)).toEqual(['flownEstimated', 'mark']);
    expect(haversineM(first(partsOf(parked.route, 'flownEstimated')[0]), YYZ)).toBeLessThan(1);
    expect(markOf(parked.route, 'stand').properties.standCode).toBe('A2');
    // Cancelled or diverted: nothing to fly any more.
    for (const phase of ['cancelled', 'diverted']) {
      const world = noon({ flights: { ...base, flights: base.flights.map(row => (row.flightKey === KEY.noFix ? { ...row, phase } : row)) } });
      expect(routeOf(world, { kind: 'flight', id: KEY.noFix }).route.features, phase).toEqual([]);
    }
  });

  it('nothing to draw, no route; a stand comes from the layout, else from the reference list', () => {
    const empty = { type: 'FeatureCollection', features: [] };
    expect(buildRoute({ target: null })).toEqual(empty);
    expect(buildRoute()).toEqual(empty);
    // A flight without a trajectory, a trail or a position.
    const world = noon();
    const flight = world.flights.byKey.get(KEY.noFix);
    expect(buildRoute({ target: { kind: 'flight', flight, aircraft: null } })).toEqual(empty);
    expect(standCentre('a-05')).toEqual(centreOf('A5'));
    expect(standCentre('A5', null)).toEqual(centreOf('A5'));
    expect([standCentre('B33'), standCentre('Z99'), standCentre('')]).toEqual([null, null, null]);
  });

  it('the chosen aircraft keeps one line: its trail gives way to the observed part of its route', () => {
    const world = noon();
    const store = createTrailStore();
    store.ingestPicture(world.picture);
    const trails = trailFeatures(store.getSnapshot(), { aviamHexes: new Set([HEX.arrival]), includeOther: true, nowMs: NOON });
    const arrival = selectionTarget({ kind: 'flight', id: KEY.arrival }, world.situation);
    const route = buildRoute({ target: arrival, segments: trailSegmentsOf(trails, HEX.arrival), nowMs: NOON,
      trajectory: world.motion.trajectoryForRoute(arrival.flight) });
    const beside = trailsBesideRoute(trails, route);
    expect(beside.features.map(feature => feature.properties.hex)).not.toContain(HEX.arrival);
    expect(beside.features.length).toBe(trails.features.length - 1);
    // A route without an observed part, or no route, leaves the trails as they are.
    expect(trailsBesideRoute(trails, buildRoute({ target: arrival, trajectory: world.motion.trajectoryForRoute(arrival.flight),
      nowMs: NOON }))).toBe(trails);
    expect(trailsBesideRoute(trails, null)).toBe(trails);
    expect(trailsBesideRoute(null, route)).toBeNull();
    expect(trailSegmentsOf(trails, null)).toEqual([]);
  });
});
