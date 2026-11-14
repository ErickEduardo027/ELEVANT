import { describe, expect, it } from 'vitest';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';
import { TAGS } from '../../occ-ui/statusVocabulary';
import {
  ROUTE_KINDS, ROUTE_SOURCE, TRAFFIC_SCALES, TRAFFIC_SOURCE, TRAILS_SOURCE, featuresById, flightLevelText, isEmptyDiff,
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

  it('estimated, stale and demo are carried by ring, vocabulary words and plate, never by colour alone', () => {
    const drawn = byId(trafficFeatures(aircraftAtNoon()));
    // The demo arrival, estimated from the schedule: the ring and «est.», and its «Demo» plate.
    expect(drawn[`f:${KEY.demoArrival}`]).toMatchObject({ quality: 'estimated', estimated: true, stale: false, demo: true,
      suffix: TAGS.estimated.es, icon: 'ac-narrow-solid' });
    // A position 45 s old (10:59:15 at Punta Cana): dimmed by the layer, and its tag says since when, in the words of
    // the stale tag (contracts 2.4), never its age.
    expect(drawn[`h:${HEX.stale}`]).toMatchObject({ quality: 'stale', stale: true, estimated: false, demo: false,
      suffix: 'Sin actualizar desde las 10:59' });
    expect(drawn[`h:${HEX.stale}`].suffix).toBe(TAGS.stale.es.replace('{time}', '10:59'));
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ quality: 'live', stale: false, estimated: false, demo: false,
      suffix: '' });
    // The tag carries the words alone: no age of its own beside them.
    for (const properties of Object.values(drawn)) expect(properties, properties.id).not.toHaveProperty('age');
    // In English, the English words of the vocabulary.
    const english = byId(trafficFeatures(aircraftAtNoon(), { language: 'en' }));
    expect(english[`h:${HEX.stale}`].suffix).toBe('Not updated since 10:59');
    expect(english[`f:${KEY.demoArrival}`].suffix).toBe(TAGS.estimated.en);
    // Only ELEVANT flights carry the plate: other traffic is never a demo.
    expect(Object.values(drawn).filter(item => item.demo).map(item => item.id)).toEqual([`f:${KEY.demoArrival}`]);
    // The features carry states and words, never a colour: the layers paint them (traffic/trafficLayers.js).
    for (const properties of Object.values(drawn)) {
      expect(Object.values(properties).some(value => typeof value === 'string' && /^#|rgb/i.test(value)), properties.id)
        .toBe(false);
    }
  });

  it('carries the aircraft\'s opacity, in hundredths, whole by default', () => {
    const aircraft = aircraftAtNoon();
    const drawn = byId(trafficFeatures(aircraft));
    // From a fix or an estimate without a fade: whole.
    expect(Object.values(drawn).every(properties => properties.opacity === 1)).toBe(true);
    // A cancelled demo fading out (the motion store sampled it at 0.4237): in hundredths, so a fade writes little.
    const fading = aircraft.map(item => (item.flightKey === KEY.demoArrival ? { ...item, opacity: 0.4237 } : item));
    const faded = byId(trafficFeatures(fading));
    expect(faded[`f:${KEY.demoArrival}`].opacity).toBe(0.42);
    expect(trafficDiff(featuresById(trafficFeatures(aircraft)), trafficFeatures(fading).features).update)
      .toEqual([{ id: `f:${KEY.demoArrival}`, addOrUpdateProperties: [{ key: 'opacity', value: 0.42 }] }]);
    // Out of range or not a number: clamped, or whole.
    const odd = aircraft.map(item => {
      if (item.flightKey === KEY.demoArrival) return { ...item, opacity: 3 };
      if (item.hex === HEX.stale) return { ...item, opacity: -1 };
      if (item.hex === HEX.overflight) return { ...item, opacity: 'x' };
      return item;
    });
    const clamped = byId(trafficFeatures(odd));
    expect([clamped[`f:${KEY.demoArrival}`].opacity, clamped[`h:${HEX.stale}`].opacity, clamped[`f:${KEY.departure}`].opacity])
      .toEqual([1, 0, 1]);
  });

  it('a stale tag names the time of the last position, so it holds still while the aircraft stays stale', () => {
    const aircraftAt = nowMs => buildSituation({ picture: toPictureModel(createAirPicture()), flights, nowMs,
      estimates: createEstimates() }).aircraft;
    const before = featuresById(trafficFeatures(aircraftAt(NOON)));
    // A minute on, without a new read: ZZZ612 was already stale, and its feature does not change at all.
    const later = trafficFeatures(aircraftAt(NOON + 60_000));
    const diff = trafficDiff(before, later.features);
    expect(diff.update.map(change => change.id)).not.toContain(`h:${HEX.stale}`);
    // ZZ161 turned stale in that minute: its tag says the time of its own last position (10:59:56).
    const changed = diff.update.find(change => change.id === `f:${KEY.arrival}`);
    expect(changed.addOrUpdateProperties).toEqual(expect.arrayContaining([
      { key: 'quality', value: 'stale' }, { key: 'stale', value: true },
      { key: 'suffix', value: 'Sin actualizar desde las 10:59' },
    ]));
    expect(byId(later)[`h:${HEX.stale}`].suffix).toBe('Sin actualizar desde las 10:59');
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

    // The chosen flight's route (PR M6): its lines drawn inside the bounds or across them, and its marks inside them,
    // while «Ruta del vuelo elegido» shows; in the order of ROUTE_KINDS.
    expect(ROUTE_KINDS).toEqual(['flownObserved', 'flownEstimated', 'remaining', 'mark']);
    const point = (properties, coordinates) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
    const route = { type: 'FeatureCollection', features: [
      // Still to fly, from south-west of the field to the stand A5.
      line({ part: 'remaining', hex: 'f0a001' }, [[-68.7, 18.4], [-68.3637, 18.5639]]),
      line({ part: 'flownObserved', hex: 'f0a001' }, [[-68.6, 18.5], [-68.55, 18.52]]),
      // From Miami to the first observed point: far to the west, its east end in the region.
      line({ part: 'flownEstimated', hex: 'f0a001', labelKey: 'flownEstimated' }, [[-80.29, 25.79], [-68.6, 18.5]]),
      // The touchdown on 08 and the stand A5.
      point({ part: 'mark', mark: 'touchdown', hex: 'f0a001' }, [-68.38, 18.5707]),
      point({ part: 'mark', mark: 'stand', standCode: 'A5', hex: 'f0a001' }, [-68.3637, 18.5639]),
    ] };
    expect(trafficOnScreen([], null, { route }).route).toEqual(['flownObserved', 'flownEstimated', 'remaining', 'mark']);
    // The box of the final's east end: the line still to fly crosses it with both ends outside, nothing else is there.
    expect(trafficOnScreen([], [[-68.52, 18.5], [-68.45, 18.62]], { route }).route).toEqual(['remaining']);
    // Over the field: the line still to fly and the two marks.
    expect(trafficOnScreen([], [[-68.4, 18.55], [-68.35, 18.6]], { route }).route).toEqual(['remaining', 'mark']);
    expect(trafficOnScreen([], [[-67.5, 17.5], [-67.4, 17.6]], { route }).route).toEqual([]);
    expect(trafficOnScreen([], null, { route, groups: { route: false } }).route).toEqual([]);
    expect(onScreenKey(trafficOnScreen([], null, { route }))).toBe('|||flownObserved,flownEstimated,remaining,mark');
    // The parts of PR M5's straight line, and a mark without its point, are not on screen.
    const old = { features: [line({ part: 'flown' }, [[-68.6, 18.5], [-68.55, 18.52]]),
      line({ part: 'next' }, [[-68.6, 18.5], [-68.36, 18.56]]), point({ part: 'mark' }, [Number.NaN, 18.5])] };
    expect(trafficOnScreen([], null, { route: old }).route).toEqual([]);
  });

  it('an ELEVANT aircraft parked in the stand that shows it carries parkedOnStand and leaves the legend to it', () => {
    const aircraft = aircraftAtNoon();
    // The arrival and the demo flight, given as parked by the stands (stands/standFeatures.js: parkedAircraftIds); other
    // traffic is never the stand's, whatever the list says.
    const parkedIds = new Set([`f:${KEY.arrival}`, `h:${HEX.outsideWindow}`]);
    const drawn = byId(trafficFeatures(aircraft, { parkedIds }));
    expect(drawn[`f:${KEY.arrival}`]).toMatchObject({ kind: 'aviam', parkedOnStand: true });
    expect(drawn[`f:${KEY.demoArrival}`].parkedOnStand).toBe(false);
    expect(drawn[`h:${HEX.outsideWindow}`].parkedOnStand).toBe(false);
    // Without the list nothing is parked; anything that is not a Set is no list.
    expect(Object.values(byId(trafficFeatures(aircraft))).some(properties => properties.parkedOnStand)).toBe(false);
    expect(byId(trafficFeatures(aircraft, { parkedIds: [`f:${KEY.arrival}`] }))[`f:${KEY.arrival}`].parkedOnStand).toBe(false);
    // A flight that parks or leaves is one update of that property.
    const before = featuresById(trafficFeatures(aircraft));
    expect(trafficDiff(before, trafficFeatures(aircraft, { parkedIds }).features).update).toEqual([
      { id: `f:${KEY.arrival}`, addOrUpdateProperties: [{ key: 'parkedOnStand', value: true }] },
    ]);
    // What its stand shows, the stands' legend explains: the arrival brings no traffic entry of its own then.
    const final = [[-68.66, 18.45], [-68.42, 18.62]];
    expect(trafficOnScreen(aircraft, final).kinds).toEqual(['aviamArrival']);
    expect(trafficOnScreen(aircraft, final, { parkedIds: new Set([`f:${KEY.arrival}`]) }).kinds).toEqual(['aviamArrival']);
    expect(trafficOnScreen(aircraft, final, { parkedIds: new Set([`f:${KEY.arrival}`, `f:${KEY.demoArrival}`]) }))
      .toEqual({ kinds: [], tags: [], trails: [], route: [] });
  });
});
