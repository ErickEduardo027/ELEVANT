import { describe, expect, it } from 'vitest';
import { SOURCE_STATES } from '../../admin-occ/live/sourceHealth';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { relatedEntities } from '../core/mapSelection';
import {
  createAirPicture, createEstimates, createMapFlights, createTrack, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX,
  TRAFFIC_NOON, trafficInstant,
} from '../testing/trafficFixtures';
import { buildRoute } from './routeFeatures';
import {
  airTrafficSourceState, buildSituation, ownedStandCodes, selectionTarget, staleAfterSeconds, toFlightsModel,
  toPictureModel, toTrackModel,
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
// Where an aircraft taxiing to a stand leaves the taxilane: the start of the stand's lead-in, outside its box.
const leadInStart = code => MDPC_LAYOUT.stands.find(stand => stand.code === code).leadIn[0];
/** The fields of an API aircraft standing on the ground at the centre of a stand. */
const onGroundIn = code => ({ onGround: true, altitudeFeet: null, longitude: standCenter(code)[0],
  latitude: standCenter(code)[1] });
/** The rows of the synthetic map flights, each changed by `change(row)` (null keeps it), and their model. */
const rowsWith = change => createMapFlights().flights.map(flight => change(flight) ?? flight);
const flightsOf = rows => toFlightsModel(createMapFlights({ flights: rows }));

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

  it('other traffic on the ground is hidden only inside a stand an AVIAM or demo aircraft is on', () => {
    // Only ZZ300's aircraft is on its stand (A2, BLOCK_ON). ZZ161 is still on final for A5, ZZ500 is en route to B30,
    // the demo pair is in Approach and not imported (B21 is only a suggestion), and ZZ700 left A3.
    expect([...ownedStandCodes(flights.flights, { nowMs: NOON })]).toEqual(['A2']);

    const picture = pictureWith(item => {
      if (item.hex === HEX.overflight) return { ...item, ...onGroundIn('A5') };
      if (item.hex === HEX.outsideWindow) return { ...item, ...onGroundIn('B21') };
      if (item.hex === HEX.stale) return { ...item, ...onGroundIn('B30') };
      return null;
    });
    const situation = buildSituation({ picture, flights, nowMs: NOON });
    const hidden = Object.fromEntries(situation.aircraft.map(item => [item.hex, item.hiddenInStand]));
    expect(hidden).toEqual({
      [HEX.arrival]: false,
      [HEX.groundInOwnedStand]: true, // in A2, where the ZZ300 aircraft is
      // Parked where a flight is due: the conflict OCC has to see is never hidden.
      [HEX.overflight]: false, // in A5, while ZZ161 is still on final for it
      [HEX.outsideWindow]: false, // in B21, suggested to the demo flight, which is still in the air
      [HEX.stale]: false, // in B30, ZZ500's stand, 48 minutes out
      [HEX.groundOnFreeStand]: false, // in A3, which ZZ700 left
    });
    // Over A2 but in the air: nothing hides an aircraft in flight.
    const above = pictureWith(item => (item.hex === HEX.outsideWindow
      ? { ...item, ...onGroundIn('A2'), onGround: false, altitudeFeet: 1_500 } : null));
    expect(buildSituation({ picture: above, flights, nowMs: NOON }).byId.get(`h:${HEX.outsideWindow}`).hiddenInStand)
      .toBe(false);

    // Once the ZZ300 visit records its PUSHBACK, A2 is free and the aircraft there is drawn.
    const pushedBack = toFlightsModel(createMapFlights({ flights: createMapFlights().flights.map(flight => (
      flight.flightKey === KEY.parkedDeparture
        ? { ...flight, milestones: [...flight.milestones, { code: 'PUSHBACK', actualAt: trafficInstant(-60) }] }
        : flight)) }));
    expect(ownedStandCodes(pushedBack.flights, { nowMs: NOON }).has('A2')).toBe(false);
    expect(buildSituation({ picture: livePicture, flights: pushedBack, nowMs: NOON })
      .byId.get(`h:${HEX.groundInOwnedStand}`).hiddenInStand).toBe(false);
    // An ELEVANT aircraft is never hidden, even on its own stand.
    const parkedAviam = pictureWith(item => (item.hex === HEX.groundInOwnedStand
      ? { ...item, matchedFlightKey: KEY.parkedArrival, matchedBy: 'Registration' } : null));
    expect(buildSituation({ picture: parkedAviam, flights, nowMs: NOON }).byId.get(`f:${KEY.parkedArrival}`))
      .toMatchObject({ hiddenInStand: false, standCode: 'A2' });
  });

  it('a stand counts from the moment its aircraft is on it, by the first evidence there is, until it leaves', () => {
    const owned = (rows, options = {}) => [...ownedStandCodes(rows, { nowMs: NOON, ...options })].sort();
    const arrivalOnly = change => rowsWith(flight => (flight.flightKey === KEY.arrival
      ? { ...flight, ...change } : null));

    // ZZ161 landed: a runway time says nothing of the stand. Its aircraft decides once the map has it: on the taxilane
    // or in the air over A5 it is on its way; on the ground inside the box it is on its stand.
    const landed = arrivalOnly({ phase: 'landed', actualAt: trafficInstant(-120), actualKind: 'Runway' });
    expect(owned(landed)).toEqual(['A2']);
    const aircraftAt = ([lon, lat], onGround = true) => new Map([[KEY.arrival, { lon, lat, onGround }]]);
    expect(owned(landed, { positions: aircraftAt(leadInStart('A5')) })).toEqual(['A2']);
    expect(owned(landed, { positions: aircraftAt(standCenter('A5'), false) })).toEqual(['A2']);
    expect(owned(landed, { positions: aircraftAt(standCenter('A5')) })).toEqual(['A2', 'A5']);
    // The live aircraft goes through the picture too: on its stand, the transponder beside it is hidden.
    const parkedPicture = pictureWith(item => {
      if (item.hex === HEX.arrival) return { ...item, ...onGroundIn('A5'), groundSpeedKnots: 0 };
      if (item.hex === HEX.overflight) return { ...item, ...onGroundIn('A5') };
      return null;
    });
    const parked = buildSituation({ picture: parkedPicture, flights: flightsOf(landed), nowMs: NOON });
    expect(parked.ownedStandCodes.has('A5')).toBe(true);
    expect([parked.byId.get(`f:${KEY.arrival}`).hiddenInStand, parked.byId.get(`h:${HEX.overflight}`).hiddenInStand])
      .toEqual([false, true]);

    // «Registrar llegada» wrote the on-block time; the aircraft's position, when the map has one, comes first.
    const registered = arrivalOnly({ phase: 'arrived', actualAt: trafficInstant(-60), actualKind: 'OnBlock' });
    expect(owned(registered)).toEqual(['A2', 'A5']);
    expect(owned(registered, { positions: aircraftAt(leadInStart('A5')) })).toEqual(['A2']);

    // The provider still says «Departed» (it took off from its origin) after the aircraft reached the stand: BLOCK_ON
    // decides, and an arrival that reads `departed` does not end its visit (core/mapSelection.js: endsItsVisit).
    const blockOn = [{ code: 'BLOCK_ON', actualAt: trafficInstant(-60) }];
    const stalled = rowsWith(flight => (flight.visitKey === KEY.arrival
      ? { ...flight, milestones: blockOn, ...(flight.direction === 'Arrival' ? { phase: 'departed' } : {}) } : null));
    expect(owned(stalled)).toEqual(['A2', 'A5']);
    // Without it, ZZ500 that reads `departed` is flying in: not on B30 yet, and still the stand's next flight.
    const flyingIn = rowsWith(flight => (flight.flightKey === KEY.noFix ? { ...flight, phase: 'departed' } : null));
    expect(owned(flyingIn)).toEqual(['A2']);
    expect(relatedEntities({ kind: 'stand', id: 'B30' }, { flights: flyingIn }).flightKey).toBe(KEY.noFix);

    // A demo flight follows the server's instants. Imported onto B21, it is not there in Approach, it is from its
    // on-block instant (five minutes after noon), and it left at TaxiOut.
    const demoOn = (phase, stand) => rowsWith(flight => (flight.isDemo
      ? { ...flight, demo: { ...flight.demo, phase },
        ...(stand ? { imported: true, suggestedStandCode: null, stand } : {}) }
      : null));
    const b21 = { id: 'stand-b21', code: 'B21', terminalCode: 'B' };
    expect(owned(demoOn('Approach', b21))).toEqual(['A2']);
    expect(owned(demoOn('Parked', b21), { nowMs: at(300) })).toEqual(['A2', 'B21']);
    expect(owned(demoOn('TaxiOut', b21), { nowMs: at(3_960) })).toEqual(['A2']);
    // Nobody imported it: it waits on the apron (contracts 2.3), so its suggested stand holds nothing, even parked.
    expect(owned(demoOn('Parked'), { nowMs: at(300) })).toEqual(['A2']);

    // A cancelled departure leaves the stand to its arrival; a cancelled arrival ends the visit.
    const parkedVisit = flights.byKey.get(KEY.parkedArrival).visitKey;
    const cancelled = direction => rowsWith(flight => (flight.visitKey === parkedVisit && flight.direction === direction
      ? { ...flight, phase: 'cancelled' } : null));
    expect(owned(cancelled('Departure'))).toEqual(['A2']);
    expect(owned(cancelled('Arrival'))).toEqual([]);
  });

  it('an aircraft named by the old key of a visit linked under 3-N07 is that flight (contracts 1.3)', () => {
    // OCC linked ZZ161's proposal to a planned leg: the row keeps the leg's «l:» key and the proposal id, while the
    // server's matching keys (cached for 20 s) still name the proposal's «p:» key.
    const arrival = flights.byKey.get(KEY.arrival);
    const legKey = `l:${arrival.legId}`;
    const linked = flightsOf(rowsWith(flight => (flight.flightKey === KEY.arrival
      ? { ...flight, flightKey: legKey } : null)));
    const situation = buildSituation({ picture: livePicture, flights: linked, nowMs: NOON });
    expect(situation.byId.get(`f:${legKey}`)).toMatchObject({ hex: HEX.arrival, kind: 'aviam', flightKey: legKey,
      flightNumber: 'ZZ161', standCode: 'A5', matchedBy: 'Registration' });
    expect(situation.byId.has(`f:${KEY.arrival}`)).toBe(false);
    expect(situation.byId.has(`h:${HEX.arrival}`)).toBe(false);
    expect(selectionTarget({ kind: 'aircraft', id: HEX.arrival }, situation).flight).toBe(linked.byKey.get(legKey));

    // One flight, one aircraft, whichever key names it: a newer aircraft named by the leg's key wins.
    const both = pictureWith(item => (item.hex === HEX.overflight
      ? { ...item, matchedFlightKey: legKey, matchedBy: 'Callsign', positionAt: trafficInstant(-1) } : null));
    const twice = buildSituation({ picture: both, flights: linked, nowMs: NOON });
    expect(twice.aircraft.filter(item => item.flightKey === legKey).map(item => item.hex)).toEqual([HEX.overflight]);
    expect(twice.byId.get(`h:${HEX.arrival}`).kind).toBe('other');
    // An estimate given by the old key is the flight's as well.
    const disabled = toPictureModel(createAirPicture({ status: 'Disabled' }));
    const byOldKey = buildSituation({ picture: disabled, flights: linked, nowMs: NOON,
      estimates: [{ flightKey: KEY.arrival, lon: -68.4, lat: 18.5 }] });
    expect(byOldKey.aircraft.map(item => item.id)).toEqual([`f:${legKey}`]);

    // A key that a row of the window holds is always that row, never another row's old key.
    const copy = { ...arrival, flightKey: 'l:5c000000-0000-4000-8000-000000000999', flightNumber: 'ZZ999' };
    const shadowed = flightsOf([...createMapFlights().flights, copy]);
    expect(buildSituation({ picture: livePicture, flights: shadowed, nowMs: NOON }).byId.get(`f:${KEY.arrival}`))
      .toMatchObject({ hex: HEX.arrival, flightNumber: 'ZZ161' });
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
      [null, 'unauthorized', {}, 'forbidden'],
      [null, 'unauthorized', { flightsStatus: 'success' }, 'forbidden'],
      // Refused: the account, when the flights are refused too; a station without live traffic (its 404), once they
      // answer or fail; and nothing judged until then.
      [null, 'forbidden', { flightsStatus: 'forbidden' }, 'forbidden'],
      [null, 'forbidden', { flightsStatus: 'unauthorized' }, 'forbidden'],
      [null, 'forbidden', { flightsStatus: 'success' }, 'unconfigured'],
      [null, 'forbidden', { flightsStatus: 'empty' }, 'unconfigured'],
      [null, 'forbidden', { flightsStatus: 'error' }, 'unconfigured'],
      [null, 'forbidden', { flightsStatus: 'loading' }, 'idle'],
      [null, 'forbidden', {}, 'idle'],
    ];
    for (const [picture, resource, options, expected] of cases) {
      const state = airTrafficSourceState(picture, resource, options);
      expect(state, `${picture} / ${resource} / ${JSON.stringify(options)}`).toBe(expected);
      expect(SOURCE_STATES).toContain(state);
    }
  });

  it('a selection names its flight and the aircraft the map draws for it (contracts 2.1)', () => {
    const situation = buildSituation({ picture: livePicture, flights, nowMs: NOON, estimates: createEstimates() });
    const arrival = flights.byKey.get(KEY.arrival);
    const drawn = situation.byId.get(`f:${KEY.arrival}`);
    // flightId by its key, its visit, its leg, its turnaround or the old p: key of its proposal: ZZ161 and its aircraft.
    for (const id of [KEY.arrival, arrival.visitKey, arrival.legId, arrival.turnaroundId, `p:${arrival.proposalId}`]) {
      const target = selectionTarget({ kind: 'flight', id }, situation);
      expect(target, id).toEqual({ kind: 'flight', flight: arrival, aircraft: drawn });
    }
    // A flight without a live fix has no aircraft yet; the demo flight is drawn where its estimate puts it.
    expect(selectionTarget({ kind: 'flight', id: KEY.noFix }, situation))
      .toEqual({ kind: 'flight', flight: flights.byKey.get(KEY.noFix), aircraft: null });
    expect(selectionTarget({ kind: 'flight', id: KEY.demoArrival }, situation).aircraft)
      .toMatchObject({ quality: 'estimated', isDemo: true });

    // hex: the aircraft by its address (any case) and, when the picture matched it, its flight.
    expect(selectionTarget({ kind: 'aircraft', id: HEX.overflight.toUpperCase() }, situation))
      .toEqual({ kind: 'aircraft', flight: null, aircraft: situation.byId.get(`h:${HEX.overflight}`) });
    expect(selectionTarget({ kind: 'aircraft', id: HEX.arrival }, situation))
      .toEqual({ kind: 'aircraft', flight: arrival, aircraft: drawn });

    // What the map does not know or does not draw names nothing: an unknown flight or address, an aircraft hidden inside
    // a stand, a stand selection and no selection.
    for (const selection of [{ kind: 'flight', id: 'l:nada' }, { kind: 'aircraft', id: 'f0ffff' },
      { kind: 'aircraft', id: HEX.groundInOwnedStand }, { kind: 'stand', id: 'A5' }, { kind: 'flight', id: '  ' }, null]) {
      expect(selectionTarget(selection, situation), JSON.stringify(selection)).toBeNull();
    }
    expect(selectionTarget({ kind: 'flight', id: KEY.arrival }, null)).toBeNull();
  });

  it('a visit or a turnaround names the leg its aircraft flies, so the block, the cyan and the route agree', () => {
    // After the stop-over the picture gives ZZ161's aircraft to its departure (one flight, one aircraft): it took off a
    // minute ago as ZZZ162 and climbs out.
    const picture = pictureWith(item => (item.hex === HEX.arrival
      ? { ...item, callsign: 'ZZZ162', matchedFlightKey: KEY.departure, matchedBy: 'Callsign', altitudeFeet: 3_400,
        verticalRateFeetPerMinute: 1_800 }
      : null));
    const rows = rowsWith(flight => {
      if (flight.flightKey === KEY.arrival) return { ...flight, actualAt: trafficInstant(-3_600), actualKind: 'Runway', phase: 'landed' };
      if (flight.flightKey === KEY.departure) return { ...flight, actualAt: trafficInstant(-60), actualKind: 'Runway', phase: 'departed' };
      return null;
    });
    // The visit as the import creates it (its visitKey is the arrival's key) and as any other turnaround («t:»).
    const turnaroundVisit = rows.map(flight => (flight.turnaroundId === flights.byKey.get(KEY.arrival).turnaroundId
      ? { ...flight, visitKey: `t:${flight.turnaroundId}` } : flight));
    for (const legs of [rows, turnaroundVisit]) {
      const model = flightsOf(legs);
      const situation = buildSituation({ picture, flights: model, nowMs: NOON });
      const departure = model.byKey.get(KEY.departure);
      const arrival = model.byKey.get(KEY.arrival);
      const drawn = situation.byId.get(`f:${KEY.departure}`);
      expect(drawn).toMatchObject({ hex: HEX.arrival, direction: 'Departure', flightNumber: 'ZZ162' });
      expect(situation.byId.has(`f:${KEY.arrival}`)).toBe(false);
      // By its visitKey or its turnaround: the departure, the leg its aircraft flies, never the arrival with the
      // departure's aircraft.
      for (const id of [departure.visitKey, departure.turnaroundId]) {
        const target = selectionTarget({ kind: 'flight', id }, situation);
        expect(target, id).toEqual({ kind: 'flight', flight: departure, aircraft: drawn });
        // Its route goes on to its destination, never back from the departing aircraft to the stand.
        const route = buildRoute({ target, stationAirport: model.stationAirport, nowMs: NOON });
        expect(route.features.filter(feature => feature.properties.part === 'next').map(feature => feature.properties.to), id)
          .toEqual(['destination']);
      }
      // A leg id names its own leg: the arrival, which has no aircraft now.
      expect(selectionTarget({ kind: 'flight', id: arrival.legId }, situation))
        .toEqual({ kind: 'flight', flight: arrival, aircraft: null });
      expect(selectionTarget({ kind: 'aircraft', id: HEX.arrival }, situation))
        .toEqual({ kind: 'aircraft', flight: departure, aircraft: drawn });
    }
  });
});
