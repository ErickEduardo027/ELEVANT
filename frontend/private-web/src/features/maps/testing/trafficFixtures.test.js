import { isOccAircraftTrack, isOccAirPicture, isOccMapFlights, OCC_AIR_PICTURE_STATUSES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import {
  createAirPicture, createMapFlights, createTrack, createTrafficScenario, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX,
  TRAFFIC_KEY_OUTSIDE_WINDOW, TRAFFIC_STATION_ID,
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
});
