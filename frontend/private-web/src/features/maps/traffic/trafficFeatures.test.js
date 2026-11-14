import { describe, expect, it } from 'vitest';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';
import {
  ROUTE_SOURCE, TRAFFIC_SCALES, TRAFFIC_SOURCE, TRAILS_SOURCE, ageText, featuresById, flightLevelText, isEmptyDiff,
  knotsText, onScreenKey, selectedAircraftId, trafficDiff, trafficFeatures, trafficOnScreen,
} from './trafficFeatures';

const NOON = Date.parse(TRAFFIC_NOON);
const flights = toFlightsModel(createMapFlights());

/**
 * The aircraft of the synthetic picture at noon, with the demo arrival estimated 6 NM out and the overflight named
 * after the departure ZZ162 (so the picture holds an ELEVANT departure). `change(aircraft)` edits API aircraft first.
 */
function aircraftAtNoon(change = () => null) {
  const base = createAirPicture();
  const picture = toPictureModel({ ...base, aircraft: base.aircraft.map(item => {
    const named = item.hex === HEX.overflight ? { ...item, matchedFlightKey: KEY.departure, matchedBy: 'Callsign' } : item;
    return change(named) ?? named;
  }) });
  return buildSituation({ picture, flights, nowMs: NOON, estimates: createEstimates() }).aircraft;
}

const byId = collection => Object.fromEntries(collection.features.map(feature => [feature.properties.id, feature.properties]));

describe('traffic features (design E3, contracts 2.4)', () => {
  it('arrivals are solid and departures hollow; other traffic is small and muted', () => {
    expect([TRAFFIC_SOURCE, TRAILS_SOURCE, ROUTE_SOURCE]).toEqual(['occ-traffic', 'occ-trails', 'occ-route']);
    const data = trafficFeatures(aircraftAtNoon());
    expect(data.type).toBe('FeatureCollection');
    const drawn = byId(data);
    // The ELEVANT arrival: solid, 1.25×, its tag always on.
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ kind: 'aviam', dir: 'arr', icon: 'ac-narrow-solid', scale: 1.25,
      category: 'narrow', flightKey: KEY.arrival, hex: HEX.arrival, trk: 74 });
    // The ELEVANT departure: the same kind of silhouette, hollow.
    expect(drawn[`f:${KEY.departure}`]).toMatchObject({ kind: 'aviam', dir: 'dep', icon: 'ac-narrow-hollow', scale: 1.25 });
    // Other traffic: solid, smaller (0.85×), and smaller still on the ground (0.6×); its silhouette by type or emitter.
    expect(drawn[`h:${HEX.outsideWindow}`]).toMatchObject({ kind: 'other', dir: '', icon: 'ac-narrow-solid', scale: 0.85,
      flightKey: '' });
    expect(drawn[`h:${HEX.stale}`]).toMatchObject({ kind: 'other', icon: 'ac-turboprop-solid', scale: 0.85 });
    expect(drawn[`h:${HEX.groundOnFreeStand}`]).toMatchObject({ kind: 'other', ground: true, scale: 0.6 });
    expect(TRAFFIC_SCALES).toEqual({ aviam: 1.25, other: 0.85, otherGround: 0.6, selected: 1.4 });
    // The point is the aircraft's position, and its id is the source's promoted id.
    const arrival = data.features.find(feature => feature.properties.id === `f:${KEY.arrival}`);
    const model = aircraftAtNoon().find(item => item.id === `f:${KEY.arrival}`);
    expect(arrival.geometry).toEqual({ type: 'Point', coordinates: [model.lon, model.lat] });
    // Larger airframes keep their ring and plate clear: the radius grows with the category and the scale.
    expect(drawn[`f:${KEY.arrival}`].radius).toBeGreaterThan(drawn[`h:${HEX.outsideWindow}`].radius);
    // A heading the aircraft does not report points north.
    const headless = byId(trafficFeatures(aircraftAtNoon(item => (item.hex === HEX.outsideWindow
      ? { ...item, trackDegrees: null } : null))));
    expect(headless[`h:${HEX.outsideWindow}`].trk).toBe(0);
    expect(trafficFeatures(undefined).features).toEqual([]);
  });

  it('AVIAM tags are always on; other traffic only when selected, hovered or with all labels', () => {
    const aircraft = aircraftAtNoon();
    const tags = options => Object.fromEntries(trafficFeatures(aircraft, options).features
      .map(({ properties }) => [properties.id, [properties.forceTag, properties.showTag]]));
    const other = `h:${HEX.outsideWindow}`;
    const plain = tags();
    expect(plain[`f:${KEY.arrival}`]).toEqual([true, true]);
    expect(plain[`f:${KEY.departure}`]).toEqual([true, true]);
    expect(plain[other]).toEqual([false, false]);
    // Under the pointer: its tag is forced on.
    expect(tags({ focusId: other })[other]).toEqual([true, true]);
    // «Etiquetas de todo el tráfico»: on, but placed only where it fits.
    expect(tags({ labelsOn: true })[other]).toEqual([false, true]);
    // Chosen by its address: tagged, drawn at 1.4×, and the only one selected.
    const chosen = byId(trafficFeatures(aircraft, { selection: { kind: 'aircraft', id: HEX.outsideWindow.toUpperCase() } }));
    expect(chosen[other]).toMatchObject({ selected: true, forceTag: true, showTag: true, scale: 1.4 });
    expect(Object.values(chosen).filter(item => item.selected)).toHaveLength(1);

    // A flight is chosen by any of its ids: its key, its leg, its proposal; never another aircraft.
    const arrival = flights.byKey.get(KEY.arrival);
    for (const id of [KEY.arrival, arrival.legId, `p:${arrival.proposalId}`, arrival.turnaroundId]) {
      expect(selectedAircraftId(aircraft, { kind: 'flight', id }), id).toBe(`f:${KEY.arrival}`);
    }
    expect(selectedAircraftId(aircraft, { kind: 'flight', id: KEY.noFix })).toBeNull();
    expect(selectedAircraftId(aircraft, { kind: 'aircraft', id: HEX.arrival })).toBe(`f:${KEY.arrival}`);
    expect(selectedAircraftId(aircraft, { kind: 'stand', id: 'A5' })).toBeNull();
    expect(selectedAircraftId(aircraft, null)).toBeNull();
    // A hidden aircraft cannot be chosen on the map.
    expect(selectedAircraftId(aircraft, { kind: 'aircraft', id: HEX.groundInOwnedStand })).toBeNull();
  });

  it('altitude in hundreds of feet and knots, GND on the ground', () => {
    const drawn = byId(trafficFeatures(aircraftAtNoon()));
    // ZZ161: 2 600 ft and 150 kt, going to A5; the departure leaves its stand, so it names none.
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ tag1: 'ZZ161', tag2: 'B38M 026 150', tagStand: 'A5', suffix: '' });
    expect(drawn[`f:${KEY.departure}`]).toMatchObject({ tag1: 'ZZ162', tag2: 'A20N 340 460', tagStand: '' });
    // Other traffic speaks with its callsign; on the ground, GND instead of the altitude, and no speed while it stands.
    expect(drawn[`h:${HEX.groundOnFreeStand}`]).toMatchObject({ tag1: 'ZZZ415', tag2: 'B738 GND 3' });
    const standing = byId(trafficFeatures(aircraftAtNoon(item => (item.hex === HEX.groundOnFreeStand
      ? { ...item, groundSpeedKnots: 0.2 } : null))));
    expect(standing[`h:${HEX.groundOnFreeStand}`].tag2).toBe('B738 GND');
    expect(drawn[`h:${HEX.outsideWindow}`]).toMatchObject({ tag1: 'ZZZ990', tag2: 'E190 110 280' });
    // Nothing but an address: the address, in capitals; an unknown altitude keeps its place before the speed.
    const anonymous = byId(trafficFeatures(aircraftAtNoon(item => (item.hex === HEX.outsideWindow
      ? { ...item, callsign: null, registration: '  ', typeIcaoCode: null, altitudeFeet: null } : null))));
    expect(anonymous[`h:${HEX.outsideWindow}`]).toMatchObject({ tag1: HEX.outsideWindow.toUpperCase(), tag2: '--- 280' });
    // The demo flight's type comes from its flight (A320); its estimated position has no live altitude source.
    expect(drawn[`f:${KEY.demoArrival}`]).toMatchObject({ tag1: 'ZZ9001', tag2: 'A320 019 140' });

    expect([flightLevelText(792.48), flightLevelText(10_363.2), flightLevelText(-30), flightLevelText(null)])
      .toEqual(['026', '340', '000', null]);
    expect([knotsText(77.1667), knotsText(0), knotsText(Number.NaN)]).toEqual(['150', '0', null]);
  });

  it('estimated, stale and demo are carried by ring, age text and plate, never by colour alone', () => {
    const drawn = byId(trafficFeatures(aircraftAtNoon()));
    // The demo arrival, estimated from the schedule: the ring and «est.», and its «Demo» plate.
    expect(drawn[`f:${KEY.demoArrival}`]).toMatchObject({ quality: 'estimated', estimated: true, stale: false, demo: true,
      suffix: 'est.', age: '', icon: 'ac-narrow-solid' });
    // A position 45 s old: dimmed by the layer, with its age in the tag.
    expect(drawn[`h:${HEX.stale}`]).toMatchObject({ quality: 'stale', stale: true, estimated: false, demo: false,
      suffix: '· 45 s', age: '· 45 s' });
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ quality: 'live', stale: false, estimated: false, demo: false });
    // Only ELEVANT flights carry the plate: other traffic is never a demo.
    expect(Object.values(drawn).filter(item => item.demo).map(item => item.id)).toEqual([`f:${KEY.demoArrival}`]);
    // The features carry states and words, never a colour: the layers paint them (traffic/trafficLayers.js).
    for (const properties of Object.values(drawn)) {
      expect(Object.values(properties).some(value => typeof value === 'string' && /^#|rgb/i.test(value)), properties.id)
        .toBe(false);
    }
    expect([ageText(45), ageText(59.9), ageText(240), ageText(null), ageText(240, 'en')])
      .toEqual(['· 45 s', '· 59 s', '· 4 min', '· 0 s', '· 4 min']);
  });

  it('ground traffic inside an owned stand is not drawn', () => {
    const aircraft = aircraftAtNoon();
    const hidden = aircraft.find(item => item.hex === HEX.groundInOwnedStand);
    expect(hidden.hiddenInStand).toBe(true);
    const ids = trafficFeatures(aircraft).features.map(feature => feature.properties.id);
    expect(ids).not.toContain(`h:${HEX.groundInOwnedStand}`);
    // The aircraft on the free stand A3 stays drawn, and so does an ELEVANT aircraft on its own stand.
    expect(ids).toContain(`h:${HEX.groundOnFreeStand}`);
    const parked = aircraftAtNoon(item => (item.hex === HEX.groundInOwnedStand
      ? { ...item, matchedFlightKey: KEY.parkedArrival, matchedBy: 'Registration' } : null));
    expect(trafficFeatures(parked).features.map(feature => feature.properties.id)).toContain(`f:${KEY.parkedArrival}`);
    // What is not drawn is not on screen either.
    expect(trafficOnScreen([hidden])).toEqual({ kinds: [], tags: [], trails: [], route: [] });
  });

  it('the diff adds, updates and removes by id', () => {
    const before = trafficFeatures(aircraftAtNoon());
    const previous = featuresById(before);
    expect([...previous.keys()]).toEqual(before.features.map(feature => feature.properties.id));
    // The same picture read again changes nothing.
    const same = trafficDiff(previous, trafficFeatures(aircraftAtNoon()).features);
    expect(same).toEqual({ add: [], update: [], remove: [] });
    expect(isEmptyDiff(same)).toBe(true);

    // A new read: the arrival moved and climbed, the overflight left, another aircraft came, and one turned stale.
    const next = trafficFeatures(aircraftAtNoon(item => {
      if (item.hex === HEX.arrival) return { ...item, latitude: item.latitude + 0.01, altitudeFeet: 2_200 };
      if (item.hex === HEX.outsideWindow) return { ...item, hex: 'f0a0ff', callsign: 'ZZZ777', matchedFlightKey: null };
      return null;
    }));
    const diff = trafficDiff(previous, next.features);
    expect(diff.add.map(feature => feature.properties.id)).toEqual(['h:f0a0ff']);
    expect(diff.remove).toEqual([`h:${HEX.outsideWindow}`]);
    const [moved] = diff.update;
    expect(diff.update).toHaveLength(1);
    expect(moved.id).toBe(`f:${KEY.arrival}`);
    expect(moved.newGeometry.coordinates[1]).toBeCloseTo(before.features
      .find(feature => feature.properties.id === `f:${KEY.arrival}`).geometry.coordinates[1] + 0.01, 6);
    // Only what changed: the tag's second line.
    expect(moved.addOrUpdateProperties).toEqual([{ key: 'tag2', value: 'B38M 022 150' }]);
    expect(moved.removeProperties).toBeUndefined();

    // A selection changes properties only; a property that goes away is removed.
    const selected = trafficDiff(previous, trafficFeatures(aircraftAtNoon(), { selection: { kind: 'aircraft', id: HEX.stale } })
      .features);
    expect(selected.update).toEqual([{ id: `h:${HEX.stale}`, addOrUpdateProperties: [
      { key: 'scale', value: 1.4 }, { key: 'radius', value: expect.any(Number) }, { key: 'selected', value: true },
      { key: 'forceTag', value: true }, { key: 'showTag', value: true },
    ] }]);
    const trimmed = new Map([...previous].map(([id, feature]) => [id, { ...feature,
      properties: { ...feature.properties, extra: 1 } }]));
    expect(trafficDiff(trimmed, before.features).update[0].removeProperties).toEqual(['extra']);
    expect(trafficDiff(undefined, before.features).add).toHaveLength(before.features.length);
  });

  it('lists on screen only the kinds, tags and trails drawn inside the bounds and the groups shown', () => {
    const aircraft = aircraftAtNoon();
    const everything = trafficOnScreen(aircraft);
    expect(everything).toEqual({
      kinds: ['aviamArrival', 'aviamDeparture', 'other', 'otherGround'], tags: ['demo', 'estimated', 'stale'], trails: [],
      route: [],
    });
    // The approach box around the final for runway 08: the arrival and the demo, not the overflight 40 NM away.
    const final = [[-68.66, 18.45], [-68.42, 18.62]];
    expect(trafficOnScreen(aircraft, final)).toEqual({ kinds: ['aviamArrival'], tags: ['demo', 'estimated'], trails: [],
      route: [] });
    // Other traffic on the ground is drawn only from the airfield threshold up; a hidden group lists nothing.
    const thresholds = { airfield: 11.2 };
    expect(trafficOnScreen(aircraft, null, { zoom: 9, thresholds }).kinds).not.toContain('otherGround');
    expect(trafficOnScreen(aircraft, null, { zoom: 14, thresholds }).kinds).toContain('otherGround');
    expect(trafficOnScreen(aircraft, null, { groups: { 'traffic.other': false } }))
      .toEqual({ kinds: ['aviamArrival', 'aviamDeparture'], tags: ['demo', 'estimated'], trails: [], route: [] });

    // Trails: an ELEVANT trail is live, an estimated part estimated; other traffic's only while its group shows.
    const line = (properties, coordinates) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });
    const trails = { type: 'FeatureCollection', features: [
      line({ kind: 'aviam', quality: 'live', selected: false }, [[-68.6, 18.5], [-68.55, 18.52]]),
      line({ kind: 'aviam', quality: 'estimated', selected: false }, [[-69.5, 19.5], [-69.4, 19.4]]),
      line({ kind: 'other', quality: 'stale', selected: false }, [[-67.9, 18.6], [-67.95, 18.62]]),
    ] };
    expect(trafficOnScreen([], null, { trails }).trails).toEqual(['live', 'estimated']);
    expect(trafficOnScreen([], final, { trails }).trails).toEqual(['live']);
    // Other traffic's trails count only once «Estelas de todo el tráfico» shows them (off by default, as in the style).
    const otherTrail = { features: [trails.features[2]] };
    expect(trafficOnScreen([], null, { trails: otherTrail }).trails).toEqual([]);
    expect(trafficOnScreen([], null, { trails: otherTrail, groups: { 'traffic.trails': true } }).trails).toEqual(['live']);
    expect(trafficOnScreen([], null, { trails: otherTrail, groups: { 'traffic.trails': true, 'traffic.other': false } })
      .trails).toEqual([]);
    expect(onScreenKey(everything)).toBe('aviamArrival,aviamDeparture,other,otherGround|demo,estimated,stale||');

    // The chosen flight's route: its parts drawn inside the bounds or across them, while «Ruta del vuelo elegido» shows.
    const route = { type: 'FeatureCollection', features: [
      line({ part: 'flown', hex: 'f0a001' }, [[-68.6, 18.5], [-68.55, 18.52]]),
      // From the final to Toronto: both ends outside the box of the final's east end, the line across it.
      line({ part: 'next', hex: 'f0a001', to: 'destination' }, [[-68.7, 18.4], [-68.3, 18.7]]),
    ] };
    expect(trafficOnScreen([], null, { route }).route).toEqual(['flown', 'next']);
    expect(trafficOnScreen([], [[-68.52, 18.5], [-68.45, 18.62]], { route }).route).toEqual(['next']);
    expect(trafficOnScreen([], [[-67.5, 17.5], [-67.4, 17.6]], { route }).route).toEqual([]);
    expect(trafficOnScreen([], null, { route, groups: { route: false } }).route).toEqual([]);
    expect(onScreenKey(trafficOnScreen([], null, { route }))).toBe('|||flown,next');
  });
});
