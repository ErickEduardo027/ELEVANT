import { isOccAircraftTrack, isOccAirPicture, isOccMapFlights } from '@elevant/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAirPicture, createMapFlights, createTrack, createTrafficScenario, TRAFFIC_HEX, TRAFFIC_NOON, TRAFFIC_STATION_ID,
} from '../features/maps/testing/trafficFixtures';
import { createServerClock } from './serverClock';

const api = vi.hoisted(() => ({ getOccAirPicture: vi.fn(), getOccMapFlights: vi.fn(), getOccAircraftTrack: vi.fn(),
  getSystemPing: vi.fn() }));
const auth = vi.hoisted(() => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../features/auth/authService', () => auth);
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const { createRemoteOccMapAdapter, createSimulatedOccMapAdapter, occMapMessage, occMapService, OCC_MAP_MESSAGES } =
  await import('./occMapService');

const NOON = Date.parse(TRAFFIC_NOON);
const SERVER_TITLE = 'One or more validation errors occurred.';
const failure = (status, code) => Object.assign(new Error(SERVER_TITLE), { status, code, title: SERVER_TITLE });

// A clock whose browser time the test moves by hand.
function manualClock(start) {
  let local = start;
  return { clock: createServerClock({ now: () => local }), advance: ms => { local += ms; } };
}

afterEach(() => vi.clearAllMocks());

describe('OCC map service (ADR-0042)', () => {
  it('the remote adapter asks short or none and feeds the clock from serverTime', async () => {
    // The browser runs 2 minutes behind the server; each answer takes 200 ms.
    const { clock, advance } = manualClock(NOON - 120_000);
    const answer = data => async () => { advance(200); return data; };
    api.getOccAirPicture.mockImplementation(answer(createAirPicture()));
    api.getOccMapFlights.mockImplementation(answer(createMapFlights()));
    api.getOccAircraftTrack.mockImplementation(answer(createTrack(TRAFFIC_HEX.arrival)));
    api.getSystemPing.mockResolvedValue({ application: 'ELEVANT', status: 'Healthy', environment: 'Test',
      timestampUtc: TRAFFIC_NOON });
    const adapter = createRemoteOccMapAdapter({ clock });
    const controller = new AbortController();

    await adapter.getAirPicture({ stationId: TRAFFIC_STATION_ID, signal: controller.signal });
    // Sent at −120 s and answered 200 ms later with the server's noon: the server is 119.9 s ahead.
    expect(clock.offsetMs()).toBe(119_900);
    expect(adapter.clock).toBe(clock);
    await adapter.getAirPicture({ stationId: TRAFFIC_STATION_ID, trails: 'none' });
    expect(api.getOccAirPicture.mock.calls).toEqual([
      [{ stationId: TRAFFIC_STATION_ID, trails: 'short' }, { signal: controller.signal, cache: 'no-store' }],
      [{ stationId: TRAFFIC_STATION_ID, trails: 'none' }, { signal: undefined, cache: 'no-store' }],
    ]);

    await expect(adapter.getMapFlights({ stationId: TRAFFIC_STATION_ID })).resolves.toMatchObject({ stationCode: 'PUJ' });
    expect(api.getOccMapFlights).toHaveBeenCalledWith({ stationId: TRAFFIC_STATION_ID },
      { signal: undefined, cache: 'no-store' });
    await adapter.getAircraftTrack({ stationId: TRAFFIC_STATION_ID, hex: TRAFFIC_HEX.arrival });
    expect(api.getOccAircraftTrack).toHaveBeenCalledWith({ stationId: TRAFFIC_STATION_ID, hex: TRAFFIC_HEX.arrival },
      { signal: undefined, cache: 'no-store' });
    // The ping only answers: syncServerClock takes its sample.
    await expect(adapter.ping()).resolves.toMatchObject({ timestampUtc: TRAFFIC_NOON });
    expect(api.getSystemPing).toHaveBeenCalledWith({ signal: undefined, cache: 'no-store' });

    // The private web's adapter feeds the app's clock.
    expect(typeof occMapService.getAirPicture).toBe('function');
  });

  it('a 401 signs out through handleUnauthorizedResponse', async () => {
    const { clock } = manualClock(NOON);
    const adapter = createRemoteOccMapAdapter({ clock });
    api.getOccMapFlights.mockRejectedValue(failure(401, 'unauthorized'));
    await expect(adapter.getMapFlights({ stationId: TRAFFIC_STATION_ID })).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });

    // Any other failure keeps its status and code and does not sign out; the clock learns nothing from it.
    api.getOccAirPicture.mockRejectedValue(failure(400, 'invalid_map_query'));
    await expect(adapter.getAirPicture({ stationId: TRAFFIC_STATION_ID }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_map_query' });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledTimes(1);
    expect(clock.isSynced()).toBe(false);
  });

  it('the simulated adapter answers what the validators accept and records each call', async () => {
    // The simulated server runs 5 minutes after the scenario's noon.
    const serverNow = NOON + 300_000;
    const adapter = createSimulatedOccMapAdapter({ scenario: createTrafficScenario(), now: () => serverNow });

    const short = await adapter.getAirPicture({ stationId: TRAFFIC_STATION_ID });
    expect(isOccAirPicture(short, TRAFFIC_STATION_ID, 'short')).toBe(true);
    // Every instant moved with the scenario: the answer is the picture of the server's now.
    expect(short.serverTime).toBe(new Date(serverNow).toISOString());
    expect(Date.parse(short.aircraft[0].positionAt)).toBe(serverNow - 4_000);
    expect(short.aircraft.some(item => item.trail.length > 0)).toBe(true);
    const none = await adapter.getAirPicture({ stationId: TRAFFIC_STATION_ID, trails: 'none' });
    expect(isOccAirPicture(none, TRAFFIC_STATION_ID, 'none')).toBe(true);
    expect(none.aircraft.every(item => item.trail.length === 0)).toBe(true);

    const flights = await adapter.getMapFlights({ stationId: TRAFFIC_STATION_ID });
    expect(isOccMapFlights(flights, TRAFFIC_STATION_ID)).toBe(true);
    expect(Date.parse(flights.windowFrom)).toBe(serverNow - 7_200_000);
    const track = await adapter.getAircraftTrack({ stationId: TRAFFIC_STATION_ID, hex: TRAFFIC_HEX.arrival.toUpperCase() });
    expect(isOccAircraftTrack(track, TRAFFIC_HEX.arrival)).toBe(true);
    await expect(adapter.getAircraftTrack({ stationId: TRAFFIC_STATION_ID, hex: 'abcdef' }))
      .rejects.toMatchObject({ status: 404, code: 'not_found' });
    const ping = await adapter.ping();
    expect(ping.timestampUtc).toBe(new Date(serverNow).toISOString());

    expect(adapter.calls.map(call => [call.read, call.trails ?? call.hex ?? null])).toEqual([
      ['airPicture', 'short'], ['airPicture', 'none'], ['mapFlights', null], ['aircraftTrack', TRAFFIC_HEX.arrival],
      ['aircraftTrack', 'abcdef'], ['ping', null],
    ]);
    expect(adapter.calls.every(call => call.at === serverNow)).toBe(true);
    // The map reads set its own clock to the simulated server's time (the browser's is the test's).
    expect(Math.abs(adapter.clock.now() - serverNow)).toBeLessThan(1_000);

    // Another station gets the same scenario under its own id; a cancelled read never answers.
    const other = '5a000000-0000-4000-8000-000000000002';
    expect(isOccMapFlights(await adapter.getMapFlights({ stationId: other }), other)).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.getAirPicture({ stationId: TRAFFIC_STATION_ID, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    // A part of the scenario may be written at each read.
    const written = createSimulatedOccMapAdapter({ scenario: { picture: ({ nowMs }) => ({
      ...createAirPicture({ status: 'Warming' }), serverTime: new Date(nowMs).toISOString() }) } });
    await expect(written.getAirPicture({ stationId: TRAFFIC_STATION_ID })).resolves.toMatchObject({ status: 'Warming' });
    await expect(written.getMapFlights({ stationId: TRAFFIC_STATION_ID })).rejects.toMatchObject({ status: 404 });
  });

  it('occMapMessage maps invalid_map_query and never shows the server title', () => {
    expect(occMapMessage(failure(400, 'invalid_map_query'))).toBe(OCC_MAP_MESSAGES.invalid_map_query);
    expect(OCC_MAP_MESSAGES.invalid_map_query).toBe('No se pudo leer el mapa con esos datos. Actualice la página.');
    expect(occMapMessage(failure(403))).toBe('No tiene permiso para ver el mapa del OCC.');
    expect(occMapMessage(failure(401))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    expect(occMapMessage(failure(404, 'not_found'))).toBe('El registro ya no existe.');
    expect(occMapMessage(new TypeError('Failed to fetch'))).toBe('No se pudo leer el mapa. Revise la conexión e intente de nuevo.');
    for (const error of [failure(400, 'invalid_map_query'), failure(403), failure(500), failure(503, 'unexpected')]) {
      expect(occMapMessage(error)).not.toContain(SERVER_TITLE);
    }
  });
});
