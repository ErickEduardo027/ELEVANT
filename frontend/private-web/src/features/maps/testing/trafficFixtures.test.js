import { isOccAircraftTrack, isOccAirPicture, isOccMapFlights, OCC_AIR_PICTURE_STATUSES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createMapFlights, createTrack, createTrafficScenario,
  TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_KEY_OUTSIDE_WINDOW, TRAFFIC_NOON, TRAFFIC_STATION_ID,
} from './trafficFixtures';

describe('synthetic traffic fixtures', () => {
  it('every fixture passes isOccAirPicture, isOccMapFlights and isOccAircraftTrack', () => {
    for (const status of OCC_AIR_PICTURE_STATUSES) {
      const picture = createAirPicture({ status });
      expect(isOccAirPicture(picture, TRAFFIC_STATION_ID, 'short'), status).toBe(true);
      const withoutTrails = { ...picture, aircraft: picture.aircraft.map(item => ({ ...item, trail: [] })) };
      expect(isOccAirPicture(withoutTrails, TRAFFIC_STATION_ID, 'none'), `${status} without trails`).toBe(true);
    }
    expect(isOccMapFlights(createMapFlights(), TRAFFIC_STATION_ID)).toBe(true);
    for (const hex of Object.values(TRAFFIC_HEX)) expect(isOccAircraftTrack(createTrack(hex), hex), hex).toBe(true);
    // The demo pair on any clock, imported or not, cancelled or not.
    const NOON = Date.parse(TRAFFIC_NOON);
    for (const [label, block, options] of [
      ['approach', createDemoBlock({ appearAt: NOON - 60_000 }), {}],
      ['imported taxiing', createDemoBlock({ imported: true, appearAt: NOON - 380_000 }), { imported: true, standCode: 'B21' }],
      ['leaving', createDemoBlock({ imported: true, offBlockAfterMin: 1, appearAt: NOON - 600_000 }), { imported: true }],
      ['cancelled', createDemoBlock({ cancelAtMs: NOON - 2_000, appearAt: NOON - 200_000 }), {}],
    ]) {
      expect(isOccMapFlights(createDemoFlights(block, options), TRAFFIC_STATION_ID), label).toBe(true);
    }

    const scenario = createTrafficScenario();
    expect(isOccAirPicture(scenario.picture, TRAFFIC_STATION_ID)).toBe(true);
    expect(isOccMapFlights(scenario.flights, TRAFFIC_STATION_ID)).toBe(true);
    expect(Object.keys(scenario.tracks).sort()).toEqual(Object.values(TRAFFIC_HEX).sort());
  });

  it('holds what the map rules need, with invented identities only', () => {
    const picture = createAirPicture();
    const flights = createMapFlights().flights;
    const keys = new Set(flights.map(flight => flight.flightKey));
    expect([...keys].sort()).toEqual(Object.values(TRAFFIC_FLIGHT_KEY).sort());
    // One aircraft matched to a flight of the window, one to a key outside it; the rest unmatched.
    expect(picture.aircraft.filter(item => keys.has(item.matchedFlightKey)).map(item => item.hex)).toEqual([TRAFFIC_HEX.arrival]);
    expect(picture.aircraft.find(item => item.hex === TRAFFIC_HEX.outsideWindow).matchedFlightKey).toBe(TRAFFIC_KEY_OUTSIDE_WINDOW);
    expect(keys.has(TRAFFIC_KEY_OUTSIDE_WINDOW)).toBe(false);
    // Invented addresses, registrations and callsigns: the ZZ prefix, never a real operator's.
    for (const item of picture.aircraft) {
      expect(item.hex).toMatch(/^f0a00\d$/);
      if (item.registration) expect(item.registration).toMatch(/^ZZ-/);
      if (item.callsign) expect(item.callsign).toMatch(/^ZZZ/);
    }
    for (const flight of flights) expect(flight.flightNumber).toMatch(/^ZZ\d+$/);
    // The short trail is oldest first and ends before the fix.
    const arrival = picture.aircraft.find(item => item.hex === TRAFFIC_HEX.arrival);
    const times = arrival.trail.map(item => Date.parse(item.at));
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(times.at(-1)).toBeLessThan(Date.parse(arrival.positionAt));
    // A track ends at the aircraft's fix.
    const track = createTrack(TRAFFIC_HEX.arrival);
    expect(track.points.at(-1)).toMatchObject({ at: arrival.positionAt, latitude: arrival.latitude,
      longitude: arrival.longitude });
    expect(() => createTrack('ffffff')).toThrow(RangeError);
  });

  it('builds the demo clock as the server\'s timeline does', () => {
    const NOON = Date.parse(TRAFFIC_NOON);
    const at = value => (value === null ? null : Date.parse(value) - NOON);
    // Fired at noon for 8 minutes: 45 % of 480 s is a 216 s taxi-in; nobody imported it, so it leaves at its time.
    const proposal = createDemoBlock();
    expect([proposal.appearAt, proposal.touchdownAt, proposal.onBlockAt, proposal.scheduledOffBlockAt, proposal.offBlockAt,
      proposal.takeoffAt, proposal.vanishAt].map(at)).toEqual([0, 264_000, 480_000, 4_080_000, 4_080_000, 4_380_000, 4_980_000]);
    expect(proposal).toMatchObject({ state: 'Active', phase: 'Approach' });
    // Imported, it waits for its push-back; the phase follows the clock at noon.
    const waiting = createDemoBlock({ imported: true, appearAt: NOON - 600_000 });
    expect([waiting.offBlockAt, waiting.takeoffAt, waiting.vanishAt]).toEqual([null, null, null]);
    expect(waiting.phase).toBe('Parked');
    expect(createDemoBlock({ imported: true, appearAt: NOON - 300_000 }).phase).toBe('TaxiIn');
    // The taxi-in is never under 90 s: 2 minutes leave 30 s in the air.
    const short = createDemoBlock({ minutes: 2 });
    expect(at(short.onBlockAt) - at(short.touchdownAt)).toBe(90_000);
    // Cancelled: no departure, it vanishes at the cancel instant.
    const cancelled = createDemoBlock({ cancelAtMs: NOON - 2_000, appearAt: NOON - 200_000 });
    expect(cancelled).toMatchObject({ state: 'Cancelled', phase: 'Gone', offBlockAt: null, takeoffAt: null });
    expect(at(cancelled.vanishAt)).toBe(-2_000);
    // The flights carry it on both legs, with the assignment of an imported visit.
    const imported = createDemoFlights(waiting, { imported: true, standCode: 'B21' }).flights
      .filter(row => row.isDemo);
    expect(imported.map(row => [row.direction, row.imported, row.stand?.code, row.suggestedStandCode, row.demo]))
      .toEqual([['Arrival', true, 'B21', null, waiting], ['Departure', true, 'B21', null, waiting]]);
    expect(imported[0]).toMatchObject({ phase: 'arrived', actualKind: 'Runway', actualAt: waiting.touchdownAt });
    const notImported = createDemoFlights(proposal).flights.filter(row => row.isDemo);
    expect(notImported.map(row => [row.imported, row.stand, row.suggestedStandCode])).toEqual([[false, null, 'B21'], [false, null, 'B21']]);
  });
});
