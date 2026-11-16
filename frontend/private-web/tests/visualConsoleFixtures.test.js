import { createElevantApiClient } from '@elevant/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoard } from '../src/features/dashboard/noc/boardModel';
import { consoleMessages } from '../src/features/dashboard/noc/consoleMessages';
import { RAMP_POSITIONS } from '../src/features/dashboard/positionsData';
import { mapOccupancyToRampPositions } from '../src/features/positions-map/positionsMapMappers';
import { loadCurrentObservation } from '../src/services/weatherService';
import { createTranslator } from '../src/i18n/languageStore';
import {
  ARRIVAL_ON_FINAL_KEY, CONSOLE_HEX, CONSOLE_PATHS, DEMO_FLIGHT_KEYS, aircraftReference, aircraftTrack, airPicture,
  airportDelays, airportRoutes, assignmentReadiness,
  createConsoleApi, iemCurrents, mapFlights, notices, ping, planningSnapshot, positionsBoard, reviewQueue, stationDay,
} from './visual/occ/fixtures/consoleApi.mjs';
import { OCC_ACCESS, STATION } from './visual/occ/fixtures/occApi.mjs';

// The synthetic API of the console's visual spec (tests/visual/occ/console.spec.mjs) must be answers the app accepts:
// the shared client validates every read strictly, and the console checks the station of each answer, so a fixture
// that drifted from the contract would leave a panel in its error state instead of drawing the day.

const NOW = Date.UTC(2026, 10, 14, 15, 0);
const OTHER_STATION = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

function clientAnswering(body) {
  return createElevantApiClient({
    baseUrl: 'https://api.elevant.test',
    getAccessToken: () => 'visual-suite-token',
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
}

const get = path => ({ method: () => 'GET', url: () => `https://api.elevant.test${path}` });
const answer = (api, path) => api.handle(get(path), new URL(`https://api.elevant.test${path}`));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('visual suite console fixtures', () => {
  it('every read of the console passes the strict validators of the shared client for its station', async () => {
    const day = stationDay(NOW);
    const planning = planningSnapshot({ now: NOW });
    await expect(clientAnswering(planning).getOccPlanningSnapshot({ stationId: STATION.stationId }))
      .resolves.toEqual(planning);
    expect(planning).toMatchObject({ date: day, station: { id: STATION.stationId, code: 'PUJ' } });

    const readiness = assignmentReadiness({ date: day });
    await expect(clientAnswering(readiness).getOccAssignmentReadiness({ stationId: STATION.stationId, date: day }))
      .resolves.toEqual(readiness);

    const board = positionsBoard({ now: NOW, date: day });
    await expect(clientAnswering(board).getOccPositions(STATION.stationId, day)).resolves.toEqual(board);
    await expect(clientAnswering(board).getOccPositions(OTHER_STATION, day)).rejects.toThrow();

    const queue = reviewQueue({ now: NOW });
    await expect(clientAnswering(queue).getOccReviewQueue(STATION.stationId)).resolves.toEqual(queue);

    const list = notices({ now: NOW });
    await expect(clientAnswering(list).getOperationalNotifications()).resolves.toEqual(list);

    for (const demo of [false, true]) {
      const flights = mapFlights({ now: NOW, demo });
      await expect(clientAnswering(flights).getOccMapFlights({ stationId: STATION.stationId })).resolves.toEqual(flights);
      await expect(clientAnswering(flights).getOccMapFlights({ stationId: OTHER_STATION })).rejects.toThrow();
    }

    for (const trails of ['short', 'none']) {
      const picture = airPicture({ now: NOW, trails });
      await expect(clientAnswering(picture).getOccAirPicture({ stationId: STATION.stationId, trails }))
        .resolves.toEqual(picture);
    }
    const track = aircraftTrack({ now: NOW, hex: CONSOLE_HEX.onFinal });
    await expect(clientAnswering(track).getOccAircraftTrack({ stationId: STATION.stationId, hex: CONSOLE_HEX.onFinal }))
      .resolves.toEqual(track);
    expect(track.points.length).toBeGreaterThan(1);

    await expect(clientAnswering(ping({ now: NOW })).getSystemPing()).resolves.toEqual(ping({ now: NOW }));
  });

  it('the day reads as the console expects: the arrival on final, the demo pair after the trigger, the stands', () => {
    const t = createTranslator(consoleMessages, 'es');
    const before = buildBoard({ flights: mapFlights({ now: NOW }).flights, planningTurnarounds: planningSnapshot({ now: NOW })
      .turnarounds, nowMs: NOW, t });
    expect(before.arrivals.map(strip => strip.flightNumber)).toEqual(['ZZ300', 'ZZ161', 'ZZ500', 'ZZ610']);
    expect(before.toImport.arrivals).toEqual([]);
    expect(before.visits.map(visit => visit.operationCode)).toHaveLength(5);

    const after = buildBoard({ flights: mapFlights({ now: NOW, demo: true }).flights, nowMs: NOW, t });
    expect(after.toImport.arrivals.map(strip => [strip.flightKey, strip.demo, strip.status.label]))
      .toEqual([[DEMO_FLIGHT_KEYS.arrival, true, 'Llegada sin posición asignada']]);

    // The picture's aircraft on final is the flight of ZZ161.
    expect(airPicture({ now: NOW }).aircraft.find(item => item.hex === CONSOLE_HEX.onFinal).matchedFlightKey)
      .toBe(ARRIVAL_ON_FINAL_KEY);
    // The stands of the board draw every state the console can show apart from those of a time.
    const stands = mapOccupancyToRampPositions(RAMP_POSITIONS, positionsBoard({ now: NOW }), new Date(NOW).toISOString());
    expect([...new Set(stands.map(stand => stand.status))].sort())
      .toEqual(['available', 'disabled', 'occupied', 'planned', 'unverified']);
    expect(stands.find(stand => stand.id === 'A5')).toMatchObject({ status: 'planned', coveredBy: ['Marta Castillo'] });
    expect(stands.find(stand => stand.id === 'B30')).toMatchObject({ status: 'planned', coveredBy: [] });
  });

  it('the stub answers the reads, keeps «Recibido» and announces the demo flight once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const api = createConsoleApi();
    const day = stationDay(NOW);
    expect(answer(api, CONSOLE_PATHS.access)).toEqual({ status: 200, json: OCC_ACCESS });
    expect(answer(api, `${CONSOLE_PATHS.planning}?stationId=${STATION.stationId}`).json.date).toBe(day);
    expect(answer(api, `${CONSOLE_PATHS.mapFlights}?stationId=${STATION.stationId}`).json.flights
      .some(flight => flight.isDemo)).toBe(false);
    // No change yet: the first page of the feed is empty and names no cursor.
    const empty = answer(api, CONSOLE_PATHS.changes).json;
    expect(empty).toEqual({ changes: [], nextCursor: null, hasMore: false });
    await expect(clientAnswering(empty).getAccountChanges()).resolves.toEqual(empty);

    api.triggerDemo();
    const page = answer(api, CONSOLE_PATHS.changes).json;
    expect(page.changes.map(change => change.resource)).toEqual(['occ_planning']);
    await expect(clientAnswering(page).getAccountChanges()).resolves.toEqual(page);
    const next = answer(api, `${CONSOLE_PATHS.changes}?after=${page.nextCursor}`).json;
    expect(next).toEqual({ changes: [], nextCursor: page.nextCursor, hasMore: false });
    await expect(clientAnswering(next).getAccountChanges({ after: page.nextCursor })).resolves.toEqual(next);
    expect(answer(api, `${CONSOLE_PATHS.mapFlights}?stationId=${STATION.stationId}`).json.flights
      .filter(flight => flight.isDemo).map(flight => flight.flightKey))
      .toEqual([DEMO_FLIGHT_KEYS.arrival, DEMO_FLIGHT_KEYS.departure]);

    // «Recibido»: the PUT answers the notice with its receipt, as the client expects, and the next read keeps it.
    const urgent = notices({ now: NOW }).notifications.find(item => item.kind === 'incident_reported');
    const put = { method: () => 'PUT' };
    const receipt = api.handle(put, new URL(`https://api.elevant.test/api/v1/notifications/${urgent.id}/read`));
    expect(receipt.json).toMatchObject({ id: urgent.id, readAt: new Date(NOW).toISOString() });
    await expect(clientAnswering(receipt.json).setOperationalNotificationRead(urgent.id, true)).resolves.toEqual(receipt.json);
    expect(answer(api, CONSOLE_PATHS.notices).json.notifications.find(item => item.id === urgent.id).readAt).not.toBeNull();
    expect(api.acknowledged).toEqual([urgent.id]);

    // The tracks of the picture's aircraft, and nothing else.
    expect(answer(api, `/api/v1/occ/map/aircraft/${CONSOLE_HEX.onFinal}/track?stationId=${STATION.stationId}`).status)
      .toBe(200);
    expect(answer(api, '/api/v1/occ/traffic/aircraft')).toBeNull();
    expect(api.handle({ method: () => 'POST' }, new URL('https://api.elevant.test/api/v1/occ/planning'))).toBeNull();
    expect(api.reads).toMatchObject({ access: 1, planning: 1, mapFlights: 2, changes: 3, notices: 1, track: 1 });
  });

  it('the AeroDataBox answers (ADR-0028) pass the strict validators of the shared client', async () => {
    const stationId = STATION.stationId;
    await expect(clientAnswering(airportRoutes({ now: NOW, stationId })).getOccAirportRoutes({ stationId })).resolves.toBeTruthy();
    await expect(clientAnswering(airportDelays({ now: NOW, stationId })).getOccAirportDelays({ stationId })).resolves.toBeTruthy();
    await expect(clientAnswering(aircraftReference({ now: NOW, stationId, registration: 'ZZTST1' }))
      .getOccAircraftReference({ stationId, registration: 'ZZ-TST1' })).resolves.toBeTruthy();
  });

  it('the METAR of the weather pill is one the browser service reads', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(iemCurrents({ now: NOW, ageMinutes: 20 })),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const observation = await loadCurrentObservation();
    expect(observation).toMatchObject({ station: 'MDPC', metar: { qnhHpa: 1015, wind: { directionDeg: 100, speedKt: 13 } } });
    expect(Date.parse(observation.observedAt)).toBe(NOW - 20 * 60_000);
  });
});
