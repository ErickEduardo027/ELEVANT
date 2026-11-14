import { describe, expect, it } from 'vitest';
import { SOURCE_STATES } from '../../admin-occ/live/sourceHealth';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import {
  createAirPicture, createEstimates, createMapFlights, createTrack, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX,
  TRAFFIC_NOON, trafficInstant,
} from '../testing/trafficFixtures';
import {
  airTrafficSourceState, buildSituation, ownedStandCodes, staleAfterSeconds, toFlightsModel, toPictureModel,
  toTrackModel,
} from './situationModel';

const NOON = Date.parse(TRAFFIC_NOON);
const flights = toFlightsModel(createMapFlights());
const livePicture = toPictureModel(createAirPicture());
const at = seconds => NOON + seconds * 1_000;

/** The Live picture with each aircraft changed by `change(aircraft)` (an API aircraft), as a model. */
function pictureWith(change, overrides = {}) {
  const base = createAirPicture(overrides);
  return toPictureModel({ ...base, aircraft: base.aircraft.map(item => change(item) ?? item) });
}

const standCenter = code => MDPC_LAYOUT.stands.find(stand => stand.code === code).center;

describe('the map situation (design E1, contracts 1.3 and 2.4)', () => {
  it('reads the air picture, a track and the flights in the map units', () => {
    const arrival = livePicture.aircraft.find(item => item.hex === HEX.arrival);
    expect(livePicture).toMatchObject({ status: 'Live', reason: null, serverTime: NOON, observedAt: at(-2), ageSeconds: 2,
      refreshAfterSeconds: 10, center: { lon: -68.3634, lat: 18.5674, radiusNm: 250 } });
    expect(livePicture.source.name).toBe('Red ADS-B de prueba');
    expect(arrival).toMatchObject({ callsign: 'ZZZ161', registration: 'ZZ-TST1', typeIcao: 'B38M', category: 'A3',
      onGround: false, trackDeg: 74, squawk: '4521', positionAt: at(-4), matchedFlightKey: KEY.arrival,
      matchedBy: 'Registration' });
    // 2 600 ft, 150 kt and −768 ft/min in metres and metres per second.
    expect(arrival.altM).toBeCloseTo(792.48, 2);
    expect(arrival.gsMs).toBeCloseTo(77.167, 3);
    expect(arrival.vrateMs).toBeCloseTo(-3.901, 3);
    expect(arrival.trail.map(point => point.at)).toEqual([at(-34), at(-24), at(-14)]);

    // .NET instants with seven decimals, a track and the flights indexed by their key.
    const precise = toPictureModel({ ...createAirPicture(), serverTime: '2026-11-13T15:00:00.1234567+00:00' });
    expect(precise.serverTime).toBe(NOON + 123);
    const track = toTrackModel(createTrack(HEX.arrival));
    expect(track).toMatchObject({ hex: HEX.arrival, serverTime: NOON });
    expect(track.points).toHaveLength(30);
    expect(track.points.at(-1)).toMatchObject({ at: at(-4), lon: arrival.lon, lat: arrival.lat, onGround: false });
    expect(flights).toMatchObject({ stationCode: 'PUJ', serverTime: NOON, windowFrom: at(-7_200), windowTo: at(43_200) });
    expect(flights.byKey.get(KEY.demoArrival)).toBe(flights.flights.find(flight => flight.flightNumber === 'ZZ9001'));
    // The rows stay as they come: keys, phase, stand, milestones and the demo clock.
    expect(flights.byKey.get(KEY.parkedArrival)).toMatchObject({ phase: 'arrived', stand: { code: 'A2' },
      milestones: [{ code: 'BLOCK_ON' }], imported: true, isDemo: false });
    expect(flights.byKey.get(KEY.demoArrival).demo).toMatchObject({ state: 'Active', phase: 'Approach' });
  });

  it('an aircraft matched to a flight becomes that flight with its key, direction, stand and demo mark', () => {
    const situation = buildSituation({ picture: livePicture, flights, nowMs: NOON });
    const arrival = situation.byId.get(`f:${KEY.arrival}`);
    expect(arrival).toMatchObject({
      hex: HEX.arrival, kind: 'aviam', flightKey: KEY.arrival, visitKey: KEY.arrival, direction: 'Arrival',
      // The database pads the code («A05»); the map speaks of A5.
      standCode: 'A5', isDemo: false, imported: true, phase: 'approaching', flightNumber: 'ZZ161', callsign: 'ZZZ161',
      registration: 'ZZ-TST1', typeIcao: 'B38M', counterpartIata: 'MIA', matchedBy: 'Registration', quality: 'live',
      hiddenInStand: false,
    });
    expect(arrival.legId).toBe(flights.byKey.get(KEY.arrival).legId);
    expect(arrival.turnaroundId).toBe(flights.byKey.get(KEY.arrival).turnaroundId);
    expect(arrival.proposalId).toBe(flights.byKey.get(KEY.arrival).proposalId);
    expect(situation.byId.has(`h:${HEX.arrival}`)).toBe(false);
    // What the flight knows of its aircraft goes with it, for its silhouette; other traffic knows none of it.
    expect([arrival.model, arrival.sizeCategory]).toEqual(['737 MAX 8', 'Narrowbody']);
    expect(situation.byId.get(`h:${HEX.overflight}`)).toMatchObject({ model: null, sizeCategory: null });

    // An aircraft named after the demo arrival carries the flight's demo mark; a suggested stand is not its stand.
    const named = pictureWith(item => (item.hex === HEX.overflight
      ? { ...item, matchedFlightKey: KEY.demoArrival, matchedBy: 'Callsign' } : null));
    const demo = buildSituation({ picture: named, flights, nowMs: NOON }).byId.get(`f:${KEY.demoArrival}`);
    expect(demo).toMatchObject({ hex: HEX.overflight, kind: 'aviam', direction: 'Arrival', isDemo: true, imported: false,
      standCode: null, flightNumber: 'ZZ9001', matchedBy: 'Callsign', phase: 'approaching' });
  });

  it('an aircraft whose key is outside the window stays other traffic', () => {
    const situation = buildSituation({ picture: livePicture, flights, nowMs: NOON });
    expect(situation.byId.get(`h:${HEX.outsideWindow}`)).toMatchObject({ kind: 'other', flightKey: null, visitKey: null,
      direction: null, phase: null, flightNumber: null, standCode: null, matchedBy: null, isDemo: false,
      callsign: 'ZZZ990' });
    expect(situation.aircraft.filter(item => item.kind === 'aviam').map(item => item.id)).toEqual([`f:${KEY.arrival}`]);
    // Without the flights read every aircraft is other traffic.
    expect(buildSituation({ picture: livePicture, nowMs: NOON }).aircraft.every(item => item.kind === 'other')).toBe(true);
  });

  it('one flight, one aircraft', () => {
    // A second aircraft names ZZ161 with an older position: ZZ161 keeps its own, the other stays other traffic.
    const twice = position => pictureWith(item => (item.hex === HEX.overflight
      ? { ...item, matchedFlightKey: KEY.arrival, matchedBy: 'Callsign', positionAt: trafficInstant(position) } : null));
    let situation = buildSituation({ picture: twice(-6), flights, nowMs: NOON });
    expect(situation.aircraft.filter(item => item.flightKey === KEY.arrival).map(item => item.hex)).toEqual([HEX.arrival]);
    expect(situation.byId.get(`h:${HEX.overflight}`)).toMatchObject({ kind: 'other', flightKey: null, matchedBy: null });
    // With the newer position, the flight is the second aircraft.
    situation = buildSituation({ picture: twice(-1), flights, nowMs: NOON });
    expect(situation.aircraft.filter(item => item.flightKey === KEY.arrival).map(item => item.hex)).toEqual([HEX.overflight]);
    expect(situation.byId.get(`h:${HEX.arrival}`).kind).toBe('other');
    expect(new Set(situation.aircraft.map(item => item.id)).size).toBe(situation.aircraft.length);
  });

  it('quality is live within the derived limit and stale beyond it, with its age from the server clock', () => {
    expect([2, 10, 15, 25, 60].map(staleAfterSeconds)).toEqual([30, 30, 30, 50, 120]);
    expect(staleAfterSeconds(undefined)).toBe(30);

    const quality = (nowMs, picture = livePicture) => Object.fromEntries(buildSituation({ picture, flights, nowMs })
      .aircraft.map(item => [item.hex, [item.quality, item.ageS]]));
    // At noon the aircraft last seen 45 s ago is beyond 30 s.
    expect(quality(NOON)).toMatchObject({ [HEX.arrival]: ['live', 4], [HEX.stale]: ['stale', 45] });
    // The arrival's fix is 30 s old at noon + 26 s, and 31 s old a second later.
    expect(quality(at(26))[HEX.arrival]).toEqual(['live', 30]);
    expect(quality(at(27))[HEX.arrival]).toEqual(['stale', 31]);
    // A slower feed widens the limit: at 30 s a read the limit is 60 s.
    expect(quality(NOON, pictureWith(() => null, { refreshAfterSeconds: 30 }))[HEX.stale]).toEqual(['live', 45]);

    // The next change without a new read: the oldest live fix (8 s) turns stale 22 s after noon.
    expect(buildSituation({ picture: livePicture, flights, nowMs: NOON }).changesAt).toBe(at(22) + 1);
    // A fix newer than the clock is not given a negative age.
    expect(quality(at(-10))[HEX.arrival]).toEqual(['live', 0]);
  });

  it('a Stale picture makes every aircraft stale', () => {
    const stale = toPictureModel(createAirPicture({ status: 'Stale' }));
    const situation = buildSituation({ picture: stale, flights, nowMs: NOON });
    expect(situation).toMatchObject({ status: 'Stale', reason: 'provider_error', changesAt: null });
    expect(situation.aircraft).toHaveLength(6);
    expect(situation.aircraft.every(item => item.quality === 'stale')).toBe(true);
    // Its aircraft are still what they are: ZZ161 stays the flight.
    expect(situation.byId.get(`f:${KEY.arrival}`).kind).toBe('aviam');
  });

  it('Disabled, Unavailable and Warming carry no aircraft and keep status and reason as data', () => {
    for (const [status, reason] of [['Disabled', 'not_configured'], ['Unavailable', 'provider_error'], ['Warming', null]]) {
      const picture = toPictureModel(createAirPicture({ status }));
      expect(picture, status).toMatchObject({ status, reason, observedAt: null, ageSeconds: null });
      const situation = buildSituation({ picture, flights, nowMs: NOON });
      expect(situation, status).toMatchObject({ status, reason, changesAt: null });
      expect(situation.aircraft, status).toEqual([]);
      // The flights stay on the map whatever the traffic does.
      expect(situation.flights).toHaveLength(8);
    }
    expect(buildSituation({ picture: toPictureModel(createAirPicture({ status: 'Disabled' })), flights, nowMs: NOON })
      .source).toBeNull();
    expect(buildSituation({ picture: toPictureModel(createAirPicture({ status: 'Warming' })), flights, nowMs: NOON })
      .source).toMatchObject({ name: 'Red ADS-B de prueba' });
    // No picture yet: no aircraft and no state.
    expect(buildSituation({ flights, nowMs: NOON })).toMatchObject({ aircraft: [], status: null, reason: null, source: null });
  });

  it('an AVIAM flight without a live fix is not drawn; an estimate given by the caller is drawn as estimated', () => {
    const plain = buildSituation({ picture: livePicture, flights, nowMs: NOON });
    // ZZ500 is en route and the demo pair is coming, but no aircraft says where: none is drawn.
    for (const key of [KEY.noFix, KEY.demoArrival, KEY.demoDeparture, KEY.parkedArrival]) {
      expect(plain.byId.has(`f:${key}`), key).toBe(false);
    }

    const [estimate] = createEstimates();
    const estimates = [
      estimate,
      // A flight with a live aircraft keeps it; an unknown key and a position without coordinates are ignored.
      { flightKey: KEY.arrival, lon: -68.4, lat: 18.5 },
      { flightKey: 'p:00000000-0000-4000-8000-0000000000aa', lon: -68.4, lat: 18.5 },
      { flightKey: KEY.noFix, lon: Number.NaN, lat: 18.5 },
    ];
    const situation = buildSituation({ picture: livePicture, flights, nowMs: NOON, estimates });
    expect(situation.byId.get(`f:${KEY.demoArrival}`)).toMatchObject({ hex: null, kind: 'aviam', quality: 'estimated',
      isDemo: true, imported: false, ageS: 0, lon: estimate.lon, lat: estimate.lat, altM: 580, trackDeg: 74,
      flightNumber: 'ZZ9001', registration: 'ZZ-DMO1', typeIcao: 'A320', hiddenInStand: false });
    expect(situation.byId.get(`f:${KEY.arrival}`)).toMatchObject({ hex: HEX.arrival, quality: 'live' });
    expect(situation.byId.has(`f:${KEY.noFix}`)).toBe(false);
    expect(situation.aircraft).toHaveLength(7);
    // With the live picture off, nothing holds ZZ161 either: both estimates are drawn.
    const disabled = toPictureModel(createAirPicture({ status: 'Disabled' }));
    expect(buildSituation({ picture: disabled, flights, nowMs: NOON, estimates }).aircraft
      .map(item => [item.id, item.quality])).toEqual([[`f:${KEY.demoArrival}`, 'estimated'], [`f:${KEY.arrival}`, 'estimated']]);
  });

  it('other traffic on the ground inside a stand owned by an AVIAM or demo visit is hidden, outside it is kept', () => {
    // A5 (ZZ161), the demo's suggested B21, A2 (ZZ300 on the stand) and B30 (ZZ500); not A3, whose visit left.
    expect([...ownedStandCodes(flights.flights)].sort()).toEqual(['A2', 'A5', 'B21', 'B30']);

    const ground = (hex, code, extra = {}) => ({ hex, onGround: true, altitudeFeet: null,
      longitude: standCenter(code)[0], latitude: standCenter(code)[1], ...extra });
    const picture = pictureWith(item => {
      if (item.hex === HEX.overflight) return { ...item, ...ground(item.hex, 'B21') };
      if (item.hex === HEX.outsideWindow) return { ...item, ...ground(item.hex, 'A5'), onGround: false, altitudeFeet: 1_500 };
      return null;
    });
    const situation = buildSituation({ picture, flights, nowMs: NOON });
    const hidden = Object.fromEntries(situation.aircraft.map(item => [item.hex, item.hiddenInStand]));
    expect(hidden).toEqual({
      [HEX.arrival]: false,
      [HEX.overflight]: true, // on the ground in B21, which the demo visit holds
      [HEX.groundInOwnedStand]: true, // on the ground in A2
      [HEX.groundOnFreeStand]: false, // A3: its visit pushed back and departed
      [HEX.outsideWindow]: false, // over A5, but in the air
      [HEX.stale]: false,
    });

    // Once the ZZ300 visit records its PUSHBACK, A2 is free and the aircraft there is drawn.
    const pushedBack = toFlightsModel(createMapFlights({ flights: createMapFlights().flights.map(flight => (
      flight.flightKey === KEY.parkedDeparture
        ? { ...flight, milestones: [...flight.milestones, { code: 'PUSHBACK', actualAt: trafficInstant(-60) }] }
        : flight)) }));
    expect(ownedStandCodes(pushedBack.flights).has('A2')).toBe(false);
    expect(buildSituation({ picture: livePicture, flights: pushedBack, nowMs: NOON })
      .byId.get(`h:${HEX.groundInOwnedStand}`).hiddenInStand).toBe(false);
    // An ELEVANT aircraft is never hidden, even on its own stand.
    const parkedAviam = pictureWith(item => (item.hex === HEX.groundInOwnedStand
      ? { ...item, matchedFlightKey: KEY.parkedArrival, matchedBy: 'Registration' } : null));
    expect(buildSituation({ picture: parkedAviam, flights, nowMs: NOON }).byId.get(`f:${KEY.parkedArrival}`))
      .toMatchObject({ hiddenInStand: false, standCode: 'A2' });
  });

  it('maps each picture status to the shell source state', () => {
    const cases = [
      ['Live', 'success', {}, 'ok'],
      ['Live', 'empty', {}, 'ok'],
      ['Live', 'success', { refreshFailed: true }, 'delayed'],
      ['Stale', 'success', {}, 'delayed'],
      ['Unavailable', 'empty', {}, 'offline'],
      ['Disabled', 'empty', {}, 'unconfigured'],
      ['Warming', 'empty', {}, 'idle'],
      [null, 'loading', {}, 'idle'],
      [null, 'idle', {}, 'idle'],
      [null, 'error', {}, 'offline'],
      ['Live', 'timeout', {}, 'offline'],
      [null, 'forbidden', {}, 'forbidden'],
      [null, 'unauthorized', {}, 'forbidden'],
    ];
    for (const [picture, resource, options, expected] of cases) {
      const state = airTrafficSourceState(picture, resource, options);
      expect(state, `${picture} / ${resource}`).toBe(expected);
      expect(SOURCE_STATES).toContain(state);
    }
  });
});
