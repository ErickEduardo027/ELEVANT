import { isOccAircraftTrack, isOccAirPicture, isOccMapFlights } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { ICON_CATEGORIES } from '../aircraft/types';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM } from '../airport/geo';
import { runwayEnd } from '../airport/runwayInUse';
import { sampleTrajectory } from '../kinematics/estimator';
import { nmToM } from '../kinematics/units';
import { TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON, TRAFFIC_STATION_ID } from '../testing/trafficFixtures';
import { trafficFeatures, trafficOnScreen } from '../traffic/trafficFeatures';
import { sourceChip } from '../ui/MapSourceStatus';
import { SCENES, findScene } from './scenes';
import { LAB_STALE_LATE_S, TRAFFIC_SCENARIOS, labTraffic } from './trafficScenes';

const NOON = Date.parse(TRAFFIC_NOON);
const drawnOf = id => {
  const { map } = labTraffic(TRAFFIC_SCENARIOS[id], { nowMs: NOON });
  return Object.fromEntries(trafficFeatures(map.aircraft).features.map(feature => [feature.properties.id, feature.properties]));
};

describe('the traffic scenes of the map lab', () => {
  it('are synthetic answers that pass the api-client validators, written at the lab noon', () => {
    expect(Object.keys(TRAFFIC_SCENARIOS)).toEqual(['region-traffic-mixed', 'approach-traffic-demo', 'ramp-traffic-ground',
      'approach-traffic-estimated-stale', 'region-traffic-selected', 'approach-traffic-hex-selected', 'region-layers-menu',
      'approach-demo-final', 'airfield-demo-taxiing', 'ramp-demo-awaiting-stand', 'approach-traffic-live-estimated',
      'airfield-demo-cancelled', 'approach-demo-accelerated', 'approach-demo-route', 'airfield-departure-route',
      'approach-follow-final', 'airfield-follow-taxi']);
    for (const [id, scenario] of Object.entries(TRAFFIC_SCENARIOS)) {
      expect(scenario.at, id).toBe(TRAFFIC_NOON);
      expect(isOccAirPicture(scenario.picture, TRAFFIC_STATION_ID, 'short'), `${id} picture`).toBe(true);
      expect(isOccMapFlights(scenario.flights, TRAFFIC_STATION_ID), `${id} flights`).toBe(true);
      for (const [hex, track] of Object.entries(scenario.tracks)) expect(isOccAircraftTrack(track, hex), `${id} ${hex}`).toBe(true);
      // Invented addresses and registrations only: the f0 block of the fixtures and ZZ- registrations.
      for (const item of scenario.picture.aircraft) {
        expect(item.hex, id).toMatch(/^f0[a-c]0[0-9a-f]{2}$/);
        if (item.registration !== null) expect(item.registration, id).toMatch(/^ZZ-/);
      }
    }
    // Each traffic scene names its scenario; the reference and weather scenes of PR M8, the ones with weather, borrow
    // two of them, and the 3D scenes of PR M7 reuse the demo flight's; no other scene has traffic.
    const reused = { 'ramp-3d-parked': 'airfield-demo-taxiing', 'ramp-3d-selected': 'airfield-demo-taxiing',
      'airfield-3d-final': 'approach-demo-final' };
    expect(SCENES.filter(scene => scene.traffic && scene.weather === undefined && !reused[scene.id]).map(scene => scene.id))
      .toEqual(Object.keys(TRAFFIC_SCENARIOS));
    expect(SCENES.filter(scene => scene.traffic && scene.weather !== undefined).map(scene => scene.id))
      .toEqual(['region-references', 'approach-references', 'region-satellite']);
    for (const [id, from] of Object.entries(reused)) expect(findScene(id).traffic, id).toBe(TRAFFIC_SCENARIOS[from]);
    expect(findScene('ramp-traffic-ground').traffic).toBe(TRAFFIC_SCENARIOS['ramp-traffic-ground']);
  });

  it('region-traffic-mixed: an arrival and a departure of AVIAM, a dozen others of every category, one stale', () => {
    const drawn = drawnOf('region-traffic-mixed');
    const values = Object.values(drawn);
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ dir: 'arr', icon: 'ac-narrow-solid' });
    expect(drawn[`f:${KEY.departed}`]).toMatchObject({ dir: 'dep', icon: 'ac-narrow-hollow', tag1: 'ZZ700' });
    expect(values.filter(item => item.kind === 'other').length).toBeGreaterThanOrEqual(12);
    expect(values.filter(item => item.stale).map(item => item.id)).toEqual([`h:${HEX.stale}`]);
    expect(new Set(values.map(item => item.category))).toEqual(new Set(ICON_CATEGORIES));
    // The arrival and the departure leave a trail; the trails of other traffic stay off.
    const { map } = labTraffic(TRAFFIC_SCENARIOS['region-traffic-mixed'], { nowMs: NOON });
    expect(new Set(map.trails.features.map(feature => feature.properties.kind))).toEqual(new Set(['aviam']));
    expect(map.trails.features.length).toBeGreaterThanOrEqual(2);
  });

  it('approach-traffic-demo: the demo arrival where its trajectory has it, with its plate and ring, the live arrival behind it', () => {
    const drawn = drawnOf('approach-traffic-demo');
    expect(drawn[`f:${KEY.demoArrival}`]).toMatchObject({ demo: true, estimated: true, suffix: 'est.', tag1: 'ZZ9001' });
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ estimated: false, demo: false });
    const { map, situation, motion } = labTraffic(TRAFFIC_SCENARIOS['approach-traffic-demo'], { nowMs: NOON });
    // No position made by hand: the motion store's, from the demo clock of the fixtures (84 s before its touchdown).
    const demo = situation.byId.get(`f:${KEY.demoArrival}`);
    const sample = sampleTrajectory(motion.trajectoryOf(KEY.demoArrival), NOON);
    expect([demo.lon, demo.lat]).toEqual([sample.lon, sample.lat]);
    expect(sample.phase).toBe('final');
    expect(map.motion).toBe(motion);
    expect(trafficOnScreen(map.aircraft, [[-68.75, 18.4], [-68.38, 18.62]], { trails: map.trails })).toEqual({
      kinds: ['aviamArrival'], tags: ['demo', 'estimated'], trails: ['live'], route: [],
    });
  });

  it('ramp-traffic-ground: GND on the ground, the departure hollow on its stand, a transponder hidden in A1', () => {
    const drawn = drawnOf('ramp-traffic-ground');
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ ground: true, tag2: 'B38M GND 15', tagStand: 'A4', icon: 'ac-narrow-solid' });
    const departure = Object.values(drawn).find(item => item.tag1 === 'ZZ702');
    expect(departure).toMatchObject({ dir: 'dep', icon: 'ac-narrow-hollow', ground: true, tag2: 'A320 GND', tagStand: '' });
    expect(drawn[`h:${HEX.groundInOwnedStand}`]).toBeUndefined();
    expect(drawn[`h:${HEX.groundOnFreeStand}`]).toMatchObject({ kind: 'other', ground: true, scale: 0.6, tag1: 'ZZZ415' });
  });

  it('the selected scenes name their aircraft and draw its route; every trail is there when asked', () => {
    // ZZ161 chosen in the region: its flight and aircraft, what it flew (its track), estimated from Miami and still to
    // fly down to A5 (PR M6).
    const selected = findScene('region-traffic-selected');
    const flight = labTraffic(selected.traffic, { nowMs: NOON, selection: selected.selection });
    expect(flight.target).toMatchObject({ kind: 'flight', flight: { flightNumber: 'ZZ161' }, aircraft: { hex: HEX.arrival } });
    expect(flight.map.route.features.map(feature => feature.properties.part))
      .toEqual(['flownObserved', 'flownEstimated', 'remaining', 'mark', 'mark', 'mark']);
    expect(flight.map.route.features[0].geometry.coordinates.length).toBeGreaterThanOrEqual(30);
    expect(flight.map.route.features.at(-1).properties).toMatchObject({ mark: 'stand', standCode: 'A5' });
    expect(flight.stationAirport).toMatchObject({ iataCode: 'PUJ' });
    // The frames' route: the same, with the aircraft where a frame draws it.
    const drawnAt = [flight.target.aircraft.lon + 0.002, flight.target.aircraft.lat];
    expect(flight.map.routeAt(NOON + 1_000, drawnAt).features.find(feature => feature.properties.part === 'remaining')
      .geometry.coordinates[0]).toEqual(drawnAt);
    // Another airline's aircraft chosen by its address: no flight, and what it flew from the track the scene holds.
    const hexScene = findScene('approach-traffic-hex-selected');
    const other = labTraffic(hexScene.traffic, { nowMs: NOON, selection: hexScene.selection });
    expect(other.target).toMatchObject({ kind: 'aircraft', flight: null, aircraft: { hex: hexScene.selection.id, callsign: 'ZZZ880' } });
    expect(other.map.route.features.map(feature => feature.properties.part)).toEqual(['flownObserved']);
    expect(other.map.route.features[0].geometry.coordinates.length).toBeGreaterThanOrEqual(30);
    expect(isOccAircraftTrack(hexScene.traffic.tracks[hexScene.selection.id], hexScene.selection.id)).toBe(true);
    // No selection, no target and no route; every trail of other traffic only with allTrails.
    const plain = labTraffic(findScene('region-layers-menu').traffic, { nowMs: NOON });
    expect([plain.target, plain.map.route, plain.map.routeAt]).toEqual([null, null, undefined]);
    const all = labTraffic(findScene('region-layers-menu').traffic, { nowMs: NOON, allTrails: true });
    expect(new Set(all.map.trails.features.map(feature => feature.properties.kind))).toEqual(new Set(['aviam', 'other']));
    expect(findScene('region-layers-menu').layersMenu).toBe(true);
  });

  it('approach-traffic-estimated-stale: every live aircraft dimmed since 10:58, an estimate and the late chip', () => {
    const drawn = drawnOf('approach-traffic-estimated-stale');
    const live = Object.values(drawn).filter(item => !item.estimated);
    expect(live.length).toBeGreaterThan(0);
    // 75 s late: every position is from 10:58 at Punta Cana.
    expect(LAB_STALE_LATE_S).toBe(75);
    expect(live.every(item => item.stale && item.suffix === 'Sin actualizar desde las 10:58')).toBe(true);
    expect(drawn[`f:${KEY.noFix}`]).toMatchObject({ estimated: true, demo: false, suffix: 'est.', tag1: 'ZZ500' });
    const { picture, nowMs, situation, motion } = labTraffic(TRAFFIC_SCENARIOS['approach-traffic-estimated-stale'], { nowMs: NOON });
    expect(sourceChip({ status: 'success', picture, nowMs })).toMatchObject({ kind: 'delayed', ageS: 75 });
    // ZZ500 is on the approach, from its schedule; the aircraft without a signal for longest fades out where it is drawn.
    const zz500 = situation.byId.get(`f:${KEY.noFix}`);
    expect(haversineM([zz500.lon, zz500.lat], [-68.3634, 18.5674])).toBeLessThan(nmToM(40));
    expect(zz500.onGround).toBe(false);
    const oldest = situation.byId.get(`h:${HEX.stale}`);
    const drawnNow = motion.sampleOne(oldest.id, NOON, oldest);
    expect(drawnNow.opacity).toBeLessThan(1);
    expect(drawnNow.opacity).toBeGreaterThan(0);
  });

  it('the demo scenes find the demo flight where each says, on runway 08, from the server\'s clock', { timeout: 30_000 }, () => {
    const demoAt = id => {
      const scene = findScene(id);
      const traffic = labTraffic(scene.traffic, { nowMs: NOON, selection: scene.selection });
      const item = traffic.situation.byId.get(`f:${KEY.demoArrival}`);
      return { traffic, item, drawn: item ? traffic.motion.sampleOne(item.id, NOON, item) : null,
        trajectory: traffic.motion.trajectoryOf(KEY.demoArrival) };
    };
    const a6 = MDPC_LAYOUT.stands.find(stand => stand.code === 'A6').center;
    const holdB = MDPC_LAYOUT.apronHolds.find(hold => hold.id === 'ah-b').p;
    // On final for 08, imported on A6 (where the lab's board has it arriving), about two minutes before its touchdown.
    const final = demoAt('approach-demo-final');
    expect(final.drawn).toMatchObject({ quality: 'estimated', onGround: false, phase: 'final', isDemo: true, imported: true,
      standCode: 'A6', statusKey: null, timeScale: 1 });
    expect(final.trajectory.meta).toMatchObject({ runwayIdent: '08', standCode: 'A6' });
    expect(final.traffic.target).toMatchObject({ kind: 'flight', flight: { flightKey: KEY.demoArrival } });
    // Taxiing to A6, on the ground and moving, in real time.
    const taxiing = demoAt('airfield-demo-taxiing');
    expect(taxiing.drawn).toMatchObject({ onGround: true, phase: 'taxiIn', statusKey: null, timeScale: 1 });
    expect(taxiing.drawn.gsMs).toBeGreaterThan(0);
    expect(haversineM([taxiing.drawn.lon, taxiing.drawn.lat], a6)).toBeGreaterThan(50);
    // Nobody imported it: at terminal B's apron hold, waiting, still.
    const waiting = demoAt('ramp-demo-awaiting-stand');
    expect(waiting.drawn).toMatchObject({ statusKey: 'awaitingStandNotImported', gsMs: 0, onGround: true, imported: false });
    expect(haversineM([waiting.drawn.lon, waiting.drawn.lat], holdB)).toBeLessThan(0.5);
    // Cancelled 2 s before noon on very short final: fading, a quarter gone, cancelled by the provider.
    const cancelled = demoAt('airfield-demo-cancelled');
    expect(cancelled.drawn).toMatchObject({ statusKey: 'cancelledByProvider', onGround: false });
    expect(cancelled.drawn.opacity).toBeCloseTo(0.75, 6);
    expect(haversineM([cancelled.drawn.lon, cancelled.drawn.lat], runwayEnd(MDPC_LAYOUT, '08').threshold)).toBeLessThan(600);
    // Fired with two minutes: its air part runs faster than real time, and says so.
    const accelerated = demoAt('approach-demo-accelerated');
    expect(accelerated.drawn.timeScale).toBeGreaterThan(1);
    expect(accelerated.drawn.timeScale).toBe(accelerated.trajectory.meta.parts.air.timeScale);
  });

  it('the route scenes draw the demo arrival from New York to A6 and its departure from A6 to New York', { timeout: 30_000 }, () => {
    const JFK = [-73.7781, 40.6413];
    const a6 = MDPC_LAYOUT.stands.find(stand => stand.code === 'A6').center;
    const partsOf = route => route.features.map(feature => feature.properties.part);
    const lineOf = (route, part) => route.features.find(feature => feature.properties.part === part).geometry.coordinates;
    // A minute after it appeared: estimated from New York to where it is, still to fly over 08 to A6, with its marks.
    const arrival = findScene('approach-demo-route');
    const inbound = labTraffic(arrival.traffic, { nowMs: NOON, selection: arrival.selection });
    expect(inbound.target.aircraft).toMatchObject({ isDemo: true, quality: 'estimated', onGround: false });
    expect(partsOf(inbound.map.route)).toEqual(['flownEstimated', 'remaining', 'mark', 'mark', 'mark']);
    expect(haversineM(lineOf(inbound.map.route, 'flownEstimated')[0], JFK)).toBeLessThan(1);
    expect(haversineM(lineOf(inbound.map.route, 'remaining').at(-1), a6)).toBeLessThan(0.5);
    expect(inbound.map.route.features.filter(feature => feature.properties.part === 'mark')
      .map(feature => feature.properties.mark)).toEqual(['touchdown', 'runwayExit', 'stand']);
    // Its departure, taxiing to 08 two minutes after it left A6: what it covered since the stand, and the taxi route,
    // the runway, the climb and the great circle to New York still ahead; the stand behind it is no longer marked.
    const departure = findScene('airfield-departure-route');
    const outbound = labTraffic(departure.traffic, { nowMs: NOON, selection: departure.selection });
    expect(outbound.target).toMatchObject({ kind: 'flight', flight: { flightKey: KEY.demoDeparture },
      aircraft: { id: `f:${KEY.demoDeparture}`, onGround: true } });
    const drawn = outbound.motion.sampleOne(outbound.target.aircraft.id, NOON, outbound.target.aircraft);
    expect(drawn.phase).toBe('taxiOut');
    expect(partsOf(outbound.map.route)).toEqual(['flownEstimated', 'remaining']);
    expect(haversineM(lineOf(outbound.map.route, 'flownEstimated')[0], a6)).toBeLessThan(0.5);
    const ahead = lineOf(outbound.map.route, 'remaining');
    expect(ahead.at(-1)).toEqual(JFK);
    expect(Math.min(...ahead.map(point => haversineM(point, runwayEnd(MDPC_LAYOUT, '08').centerline[1])))).toBeLessThan(3_000);
    // The followed scenes are the final and the taxi of the demo scenes.
    for (const [id, phase] of [['approach-follow-final', 'final'], ['airfield-follow-taxi', 'taxiIn']]) {
      const scene = findScene(id);
      const { target, motion } = labTraffic(scene.traffic, { nowMs: NOON, selection: scene.selection });
      expect(motion.sampleOne(target.aircraft.id, NOON, target.aircraft).phase, id).toBe(phase);
      expect(scene.follow, id).toBe(true);
    }
  });

  it('approach-traffic-live-estimated: live, without a signal for 20 s, and estimated', () => {
    const scene = findScene('approach-traffic-live-estimated');
    const { situation, motion } = labTraffic(scene.traffic, { nowMs: NOON, selection: scene.selection });
    const drawn = key => {
      const item = situation.byId.get(`f:${key}`);
      return motion.sampleOne(item.id, NOON, item);
    };
    expect(drawn(KEY.arrival)).toMatchObject({ quality: 'live', mode: 'live', ageS: 4 });
    expect(drawn(KEY.departed)).toMatchObject({ quality: 'live', mode: 'coast', ageS: 20, statusKey: 'noSignal' });
    expect(drawn(KEY.noFix)).toMatchObject({ quality: 'estimated', mode: 'estimate', hex: null });
  });
});
