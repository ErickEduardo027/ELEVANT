import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import {
  createAirPicture, createEstimates, createMapFlights, createTrack, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX,
  TRAFFIC_NOON, trafficInstant,
} from '../testing/trafficFixtures';
import { ROUTE_PARTS, buildRoute, standCentre, trailSegmentsOf, trailsBesideRoute } from './routeFeatures';
import { buildSituation, selectionTarget, toFlightsModel, toPictureModel, toTrackModel } from './situationModel';
import { trafficOverlay } from './trafficLayers';
import { createTrailStore, trailFeatures } from './trailStore';

const NOON = Date.parse(TRAFFIC_NOON);
const centreOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code).center;
const PUJ = [-68.3634, 18.5674];

/** The fixtures' flights with each row changed by `change(row)` (an API row), as a model. */
function flightsWith(change = () => null) {
  const raw = createMapFlights();
  return toFlightsModel({ ...raw, flights: raw.flights.map(row => change(row) ?? row) });
}

/** The noon situation with each aircraft of the picture changed by `change(aircraft)`. */
function situationWith({ aircraft = () => null, flights = flightsWith() } = {}) {
  const base = createAirPicture();
  const picture = toPictureModel({ ...base, aircraft: base.aircraft.map(item => aircraft(item) ?? item) });
  return { picture, flights, situation: buildSituation({ picture, flights, nowMs: NOON, estimates: createEstimates() }) };
}

const target = (situation, selection) => selectionTarget(selection, situation);
const parts = (route, part) => route.features.filter(feature => feature.properties.part === part);

describe('the route of the chosen flight (design E5 in PR M5)', () => {
  it('the flown part is the observed track, solid', () => {
    const { picture, flights, situation } = situationWith();
    const chosen = target(situation, { kind: 'flight', id: KEY.arrival });
    // The trail the map gathered, with the server's track of the aircraft once read.
    const store = createTrailStore();
    store.ingestPicture(picture);
    const track = toTrackModel(createTrack(HEX.arrival));
    store.ingestTrack(track.hex, track.points);
    const trails = trailFeatures(store.getSnapshot(), { aviamHexes: new Set([HEX.arrival]), selectedHex: HEX.arrival,
      nowMs: NOON });
    const segments = trailSegmentsOf(trails, HEX.arrival.toUpperCase());
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(30);

    const route = buildRoute({ target: chosen, segments, track, stationAirport: flights.stationAirport, nowMs: NOON });
    const [flown] = parts(route, 'flown');
    expect(parts(route, 'flown')).toHaveLength(1);
    expect(flown.properties).toEqual({ id: `f:${KEY.arrival}:flown:0`, part: 'flown', hex: HEX.arrival });
    expect(flown.geometry.coordinates).toEqual(segments[0]);
    // It ends where the aircraft is.
    expect(flown.geometry.coordinates.at(-1)).toEqual([chosen.aircraft.lon, chosen.aircraft.lat]);
    // Without a trail, the server's track alone; a gap in the trail gives two lines, never one joined across it.
    expect(parts(buildRoute({ target: chosen, track }), 'flown')[0].geometry.coordinates)
      .toEqual(track.points.map(point => [point.lon, point.lat]));
    const gapped = buildRoute({ target: chosen, segments: [[[-68.6, 18.5], [-68.55, 18.52]], [[-68.5, 18.54], [-68.46, 18.55]]] });
    expect(parts(gapped, 'flown').map(feature => feature.geometry.coordinates.length)).toEqual([2, 2]);

    // Drawn in the routes slot, in the selection's cyan: the flown part solid and the next one dashed.
    expect(ROUTE_PARTS).toEqual(['flown', 'next']);
    const layers = Object.fromEntries(trafficOverlay().layers.map(layer => [layer.id, layer]));
    expect(layers['occ-route-flown']).toMatchObject({ slot: 'routes', filter: ['==', ['get', 'part'], 'flown'],
      paint: { 'line-color': occColor('accent'), 'line-width': 2.5 }, metadata: { 'occ:group': 'route' } });
    expect(layers['occ-route-flown'].paint['line-dasharray']).toBeUndefined();
    expect(layers['occ-route-next']).toMatchObject({ slot: 'routes', filter: ['==', ['get', 'part'], 'next'],
      paint: { 'line-color': occColor('accent'), 'line-dasharray': [2, 2] }, metadata: { 'occ:group': 'route' } });
  });

  it("an arrival's next point is its stand, or the station airport without one", () => {
    const { flights, situation } = situationWith();
    const arrival = target(situation, { kind: 'flight', id: KEY.arrival });
    const here = [arrival.aircraft.lon, arrival.aircraft.lat];
    // ZZ161 goes to A05, the stand A5 of the airport layout.
    const [next] = parts(buildRoute({ target: arrival, stationAirport: flights.stationAirport, nowMs: NOON }), 'next');
    expect(next.properties).toEqual({ id: `f:${KEY.arrival}:next`, part: 'next', hex: HEX.arrival, to: 'stand' });
    expect(next.geometry.coordinates).toEqual([here, centreOf('A5')]);
    // The demo arrival not yet imported goes to the stand suggested for it, from where its estimate puts it.
    const demo = target(situation, { kind: 'flight', id: KEY.demoArrival });
    expect(parts(buildRoute({ target: demo, nowMs: NOON }), 'next')[0]).toMatchObject({
      properties: { part: 'next', hex: '', to: 'stand' }, geometry: { coordinates: [[demo.aircraft.lon, demo.aircraft.lat], centreOf('B21')] },
    });

    // Without a stand, or with one the map cannot place, it goes to the station's airport.
    for (const stand of [null, { id: 'stand-z99', code: 'Z99', terminalCode: null }]) {
      const unplaced = situationWith({ flights: flightsWith(row => (row.flightKey === KEY.arrival ? { ...row, stand } : null)) });
      const route = buildRoute({ target: target(unplaced.situation, { kind: 'flight', id: KEY.arrival }),
        stationAirport: unplaced.flights.stationAirport, nowMs: NOON });
      expect(parts(route, 'next').map(feature => [feature.properties.to, feature.geometry.coordinates[1]]), JSON.stringify(stand))
        .toEqual([['airport', PUJ]]);
      // Without the airport's coordinates there is nowhere to draw to.
      expect(parts(buildRoute({ target: target(unplaced.situation, { kind: 'flight', id: KEY.arrival }) }), 'next')).toEqual([]);
    }

    // An arrival already on its stand (OCC recorded the on-block, or the BLOCK_ON milestone) has no next point.
    for (const change of [{ actualKind: 'OnBlock', actualAt: trafficInstant(-60) },
      { milestones: [{ code: 'BLOCK_ON', actualAt: trafficInstant(-30) }] }]) {
      const parked = situationWith({ flights: flightsWith(row => (row.flightKey === KEY.arrival ? { ...row, ...change } : null)) });
      const route = buildRoute({ target: target(parked.situation, { kind: 'flight', id: KEY.arrival }), nowMs: NOON });
      expect(parts(route, 'next'), JSON.stringify(change)).toEqual([]);
    }
    // A stand comes from the layout, else from the reference list; a retired or unknown one has no centre.
    expect(standCentre('a-05')).toEqual(centreOf('A5'));
    expect(standCentre('A5', null)).toEqual(centreOf('A5'));
    expect([standCentre('B33'), standCentre('Z99'), standCentre('')]).toEqual([null, null, null]);
  });

  it('a departure goes to its destination airport; other traffic has no next point', () => {
    // The overflight's aircraft as ZZ700, the departure for Toronto that left A3.
    const { situation } = situationWith({ aircraft: item => (item.hex === HEX.overflight
      ? { ...item, matchedFlightKey: KEY.departed, matchedBy: 'Registration' } : null) });
    const departure = target(situation, { kind: 'flight', id: KEY.departed });
    expect(departure.flight.direction).toBe('Departure');
    const [next] = parts(buildRoute({ target: departure, nowMs: NOON }), 'next');
    expect(next.properties).toMatchObject({ part: 'next', to: 'destination' });
    expect(next.geometry.coordinates).toEqual([[departure.aircraft.lon, departure.aircraft.lat], [-79.6248, 43.6777]]);
    // A departure whose destination has no coordinates, or one the provider cancelled, draws no line.
    const nowhere = situationWith({
      aircraft: item => (item.hex === HEX.overflight ? { ...item, matchedFlightKey: KEY.departed, matchedBy: 'Registration' } : null),
      flights: flightsWith(row => (row.flightKey === KEY.departed ? { ...row, counterpart: { ...row.counterpart, latitude: null } } : null)),
    });
    expect(parts(buildRoute({ target: target(nowhere.situation, { kind: 'flight', id: KEY.departed }) }), 'next')).toEqual([]);
    const cancelled = { ...departure, flight: { ...departure.flight, phase: 'cancelled' } };
    expect(parts(buildRoute({ target: cancelled }), 'next')).toEqual([]);

    // Other traffic: what it flew, and no next point.
    const other = target(situation, { kind: 'aircraft', id: HEX.stale });
    expect(other.flight).toBeNull();
    const route = buildRoute({ target: other, segments: [[[-68.2, 18.6], [-68.15, 18.6]]], nowMs: NOON });
    expect(route.features.map(feature => feature.properties.part)).toEqual(['flown']);
  });

  it('a flight without a position has no route', () => {
    const { situation } = situationWith();
    const noFix = target(situation, { kind: 'flight', id: KEY.noFix });
    expect(noFix.aircraft).toBeNull();
    const empty = { type: 'FeatureCollection', features: [] };
    expect(buildRoute({ target: noFix, segments: [[[-68.2, 18.6], [-68.15, 18.6]]], nowMs: NOON })).toEqual(empty);
    expect(buildRoute({ target: null })).toEqual(empty);
    expect(buildRoute()).toEqual(empty);
    expect(buildRoute({ target: { kind: 'flight', flight: noFix.flight, aircraft: { id: 'f:x', lon: null, lat: 18.5 } } }))
      .toEqual(empty);
  });

  it('the chosen aircraft keeps one line: its trail gives way to the flown part of its route', () => {
    const { picture, situation } = situationWith();
    const store = createTrailStore();
    store.ingestPicture(picture);
    const trails = trailFeatures(store.getSnapshot(), { aviamHexes: new Set([HEX.arrival]), includeOther: true, nowMs: NOON });
    const arrival = target(situation, { kind: 'flight', id: KEY.arrival });
    const route = buildRoute({ target: arrival, segments: trailSegmentsOf(trails, HEX.arrival), nowMs: NOON });
    const beside = trailsBesideRoute(trails, route);
    expect(beside.features.map(feature => feature.properties.hex)).not.toContain(HEX.arrival);
    expect(beside.features.length).toBe(trails.features.length - 1);
    // A route without a flown part, or no route, leaves the trails as they are.
    expect(trailsBesideRoute(trails, buildRoute({ target: arrival }))).toBe(trails);
    expect(trailsBesideRoute(trails, null)).toBe(trails);
    expect(trailsBesideRoute(null, route)).toBeNull();
    expect(trailSegmentsOf(trails, null)).toEqual([]);
  });
});
