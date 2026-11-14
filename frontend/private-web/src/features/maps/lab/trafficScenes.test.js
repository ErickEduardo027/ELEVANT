import { isOccAircraftTrack, isOccAirPicture, isOccMapFlights } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { ICON_CATEGORIES } from '../aircraft/types';
import { TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON, TRAFFIC_STATION_ID } from '../testing/trafficFixtures';
import { trafficFeatures, trafficOnScreen } from '../traffic/trafficFeatures';
import { sourceChip } from '../ui/MapSourceStatus';
import { SCENES, findScene } from './scenes';
import { TRAFFIC_SCENARIOS, labTraffic } from './trafficScenes';

const NOON = Date.parse(TRAFFIC_NOON);
const drawnOf = id => {
  const { map } = labTraffic(TRAFFIC_SCENARIOS[id], { nowMs: NOON });
  return Object.fromEntries(trafficFeatures(map.aircraft).features.map(feature => [feature.properties.id, feature.properties]));
};

describe('the traffic scenes of the map lab', () => {
  it('are synthetic answers that pass the api-client validators, written at the lab noon', () => {
    expect(Object.keys(TRAFFIC_SCENARIOS)).toEqual(['region-traffic-mixed', 'approach-traffic-demo', 'ramp-traffic-ground',
      'approach-traffic-estimated-stale', 'region-traffic-selected', 'approach-traffic-hex-selected', 'region-layers-menu']);
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
    // Each traffic scene names its scenario; the reference scenes of PR M8, the ones with weather, borrow two of them;
    // no other scene has traffic.
    expect(SCENES.filter(scene => scene.traffic && scene.weather === undefined).map(scene => scene.id))
      .toEqual(Object.keys(TRAFFIC_SCENARIOS));
    expect(SCENES.filter(scene => scene.traffic && scene.weather !== undefined).map(scene => scene.id))
      .toEqual(['region-references', 'approach-references']);
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

  it('approach-traffic-demo: the demo arrival estimated with its plate and ring, the live arrival behind it', () => {
    const drawn = drawnOf('approach-traffic-demo');
    expect(drawn[`f:${KEY.demoArrival}`]).toMatchObject({ demo: true, estimated: true, suffix: 'est.', tag1: 'ZZ9001' });
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ estimated: false, demo: false });
    const { map } = labTraffic(TRAFFIC_SCENARIOS['approach-traffic-demo'], { nowMs: NOON });
    expect(trafficOnScreen(map.aircraft, [[-68.75, 18.4], [-68.38, 18.62]], { trails: map.trails })).toEqual({
      kinds: ['aviamArrival'], tags: ['demo', 'estimated'], trails: ['live', 'estimated'], route: [],
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
    // ZZ161 chosen in the region: its flight and aircraft, what it flew (its track) and the straight line to A5.
    const selected = findScene('region-traffic-selected');
    const flight = labTraffic(selected.traffic, { nowMs: NOON, selection: selected.selection });
    expect(flight.target).toMatchObject({ kind: 'flight', flight: { flightNumber: 'ZZ161' }, aircraft: { hex: HEX.arrival } });
    expect(flight.map.route.features.map(feature => [feature.properties.part, feature.properties.to ?? null]))
      .toEqual([['flown', null], ['next', 'stand']]);
    expect(flight.map.route.features[0].geometry.coordinates.length).toBeGreaterThanOrEqual(30);
    expect(flight.stationAirport).toMatchObject({ iataCode: 'PUJ' });
    // Another airline's aircraft chosen by its address: no flight, and what it flew from the track the scene holds.
    const hexScene = findScene('approach-traffic-hex-selected');
    const other = labTraffic(hexScene.traffic, { nowMs: NOON, selection: hexScene.selection });
    expect(other.target).toMatchObject({ kind: 'aircraft', flight: null, aircraft: { hex: hexScene.selection.id, callsign: 'ZZZ880' } });
    expect(other.map.route.features.map(feature => feature.properties.part)).toEqual(['flown']);
    expect(other.map.route.features[0].geometry.coordinates.length).toBeGreaterThanOrEqual(30);
    expect(isOccAircraftTrack(hexScene.traffic.tracks[hexScene.selection.id], hexScene.selection.id)).toBe(true);
    // No selection, no target and no route; every trail of other traffic only with allTrails.
    const plain = labTraffic(findScene('region-layers-menu').traffic, { nowMs: NOON });
    expect([plain.target, plain.map.route]).toEqual([null, null]);
    const all = labTraffic(findScene('region-layers-menu').traffic, { nowMs: NOON, allTrails: true });
    expect(new Set(all.map.trails.features.map(feature => feature.properties.kind))).toEqual(new Set(['aviam', 'other']));
    expect(findScene('region-layers-menu').layersMenu).toBe(true);
  });

  it('approach-traffic-estimated-stale: every live aircraft dimmed since 10:55, an estimate and the late chip', () => {
    const drawn = drawnOf('approach-traffic-estimated-stale');
    const live = Object.values(drawn).filter(item => !item.estimated);
    expect(live.length).toBeGreaterThan(0);
    // Four minutes late: every position is from 10:55 at Punta Cana.
    expect(live.every(item => item.stale && item.suffix === 'Sin actualizar desde las 10:55')).toBe(true);
    expect(drawn[`f:${KEY.noFix}`]).toMatchObject({ estimated: true, demo: false, suffix: 'est.', tag1: 'ZZ500' });
    const { picture, nowMs } = labTraffic(TRAFFIC_SCENARIOS['approach-traffic-estimated-stale'], { nowMs: NOON });
    expect(sourceChip({ status: 'success', picture, nowMs })).toMatchObject({ kind: 'delayed', ageS: 240 });
  });
});
