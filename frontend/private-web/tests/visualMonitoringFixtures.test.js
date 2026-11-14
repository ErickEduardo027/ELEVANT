import { createElevantApiClient } from '@elevant/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFlightBoard } from '../src/features/flight-monitoring/flightBoardModel';
import { flightMonitoringMessages } from '../src/features/flight-monitoring/flightMonitoringMessages';
import { createTranslator } from '../src/i18n/languageStore';
import { getFlightMonitoringSnapshot } from '../src/services/flightMonitoringService';
import { OCC_ACCESS, STATION } from './visual/occ/fixtures/occApi.mjs';
import {
  UNASSIGNED_VISIT, arrivalLegOf, createMonitoringApi, monitoringAirPicture, monitoringMapFlights, monitoringSnapshot,
} from './visual/occ/fixtures/monitoringApi.mjs';

// The synthetic API of Monitoreo's visual spec (tests/visual/occ/flight-monitoring.spec.mjs) must be answers the app
// accepts: the shared client validates every read strictly, so a fixture that drifted from the contract would leave the
// board in its error state instead of drawing the day. The page reads the planning snapshot through
// services/flightMonitoringService.js, which is run here on it.

const mocks = vi.hoisted(() => ({ getPlanningSnapshot: vi.fn(), readSession: vi.fn() }));
vi.mock('../src/services/planningService', () => ({ getPlanningSnapshot: mocks.getPlanningSnapshot }));
vi.mock('../src/features/auth/authService', () => ({ readSession: mocks.readSession }));

const NOW = Date.UTC(2026, 10, 14, 15, 0);
const OTHER_STATION = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const t = createTranslator(flightMonitoringMessages, 'es');

function clientAnswering(body) {
  return createElevantApiClient({
    baseUrl: 'https://api.elevant.test',
    getAccessToken: () => 'visual-suite-token',
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
}

const get = path => ({ method: () => 'GET', url: () => `https://api.elevant.test${path}` });
const answer = (api, path) => api.handle(get(path), new URL(`https://api.elevant.test${path}`));

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  mocks.readSession.mockReturnValue({ stationScopes: [{ stationId: STATION.stationId, stationCode: 'PUJ' }] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('visual suite fixtures of Monitoreo de vuelos', () => {
  it('every read of the screen passes the strict validators of the shared client, the empty day too', async () => {
    for (const empty of [false, true]) {
      const snapshot = monitoringSnapshot({ now: NOW, empty });
      await expect(clientAnswering(snapshot).getOccPlanningSnapshot({ stationId: STATION.stationId }), String(empty))
        .resolves.toEqual(snapshot);
      const flights = monitoringMapFlights({ now: NOW, empty });
      await expect(clientAnswering(flights).getOccMapFlights({ stationId: STATION.stationId }), String(empty))
        .resolves.toEqual(flights);
      await expect(clientAnswering(flights).getOccMapFlights({ stationId: OTHER_STATION })).rejects.toThrow();
      for (const trails of ['short', 'none']) {
        const picture = monitoringAirPicture({ now: NOW, empty });
        await expect(clientAnswering(picture).getOccAirPicture({ stationId: STATION.stationId, trails }))
          .resolves.toEqual(picture);
      }
    }
  });

  it('the board and the map name the same legs: the snapshot is built from the map flights', () => {
    const snapshot = monitoringSnapshot({ now: NOW });
    const mapLegs = new Map(monitoringMapFlights({ now: NOW }).flights.map(leg => [leg.legId, leg]));
    const planningLegs = snapshot.turnarounds.flatMap(item => [item.arrival, item.departure]).filter(Boolean);
    expect(planningLegs.length).toBe(mapLegs.size);
    for (const leg of planningLegs) {
      const mapLeg = mapLegs.get(leg.id);
      expect(mapLeg, leg.flightNumber).toBeDefined();
      expect([leg.flightNumber, leg.scheduledAt, leg.actualAt]).toEqual([mapLeg.flightNumber, mapLeg.scheduledAt,
        mapLeg.actualAt]);
    }
    // Only the demo pair carries the mark, and only when true.
    expect(snapshot.turnarounds.filter(item => item.isDemo === true).map(item => item.arrival.flightNumber)).toEqual(['ZZ9001']);
    expect(snapshot.turnarounds.some(item => item.isDemo === false)).toBe(false);
  });

  it('the day reads as Monitoreo expects through the page\'s service', async () => {
    mocks.getPlanningSnapshot.mockResolvedValue(monitoringSnapshot({ now: NOW }));
    const data = await getFlightMonitoringSnapshot('PUJ');
    expect(mocks.getPlanningSnapshot).toHaveBeenCalledWith({ stationId: STATION.stationId });
    expect(data.station).toEqual({ code: 'PUJ', localAbbr: 'AST', ianaTimeZone: 'America/Santo_Domingo' });

    const board = buildFlightBoard(data.flights, { nowMs: NOW, t, stationCode: 'PUJ' });
    expect(board.counts).toEqual({ arrivals: 13, departures: 13, all: 26 });
    const byNumber = Object.fromEntries(board.all.map(strip => [strip.flightNumber, strip]));
    // The demo flight, tagged, on its stand and in operation since it landed.
    expect(byNumber.ZZ9001).toMatchObject({ id: arrivalLegOf(9001), demo: true, standCode: 'A3', estimated: false,
      status: { key: 'inOperation' } });
    // The visit only this fixture adds: due in 25 minutes without a stand, amber.
    expect(byNumber[UNASSIGNED_VISIT.arrival]).toMatchObject({ id: arrivalLegOf(UNASSIGNED_VISIT.index), standCode: null,
      counterpartIata: 'SDQ', status: { key: 'noStand', signal: 'attention' } });
    // ZZ111 landed three minutes ago with no operation under way yet; ZZ106 comes later, on its estimate; its departure
    // only has its schedule.
    expect(byNumber.ZZ111).toMatchObject({ standCode: 'B24', time: { kind: 'actual' }, status: { key: 'landed' } });
    expect(byNumber.ZZ106).toMatchObject({ standCode: 'A4', time: { kind: 'estimated' }, status: { key: 'scheduled' } });
    expect(byNumber.ZZ206).toMatchObject({ standCode: 'A4', time: { kind: 'scheduled' }, status: { key: 'scheduled' } });
    // The inspector has what to say of a staffed visit: its aircraft, its agent and its services.
    const a2 = data.flights.find(flight => flight.flightNumber === 'ZZ101');
    expect(a2).toMatchObject({ aircraft: 'A320-200', registration: 'HI1001', agents: 1, stand: 'A2' });
    expect(a2.services.length).toBeGreaterThan(0);

    mocks.getPlanningSnapshot.mockResolvedValue(monitoringSnapshot({ now: NOW, empty: true }));
    expect((await getFlightMonitoringSnapshot('PUJ')).flights).toEqual([]);
  });

  it('the stub answers the screen\'s reads and leaves the rest to createOccApi', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const api = createMonitoringApi();
    expect(answer(api, '/api/v1/governance/me/access')).toEqual({ status: 200, json: OCC_ACCESS });
    const planning = answer(api, `/api/v1/occ/planning?stationId=${STATION.stationId}`).json;
    expect(planning.turnarounds).toHaveLength(13);
    expect(api.planningReads).toBe(1);
    expect(answer(api, `/api/v1/occ/map/flights?stationId=${STATION.stationId}`).json.flights).toHaveLength(26);
    expect(api.mapReads.flights).toBe(1);
    expect(answer(api, `/api/v1/occ/map/air-picture?stationId=${STATION.stationId}&trails=short`).json.aircraft
      .some(item => item.matchedFlightKey !== null)).toBe(true);
    expect(answer(api, '/api/v1/system/ping').status).toBe(200);

    const empty = createMonitoringApi({ empty: true });
    expect(answer(empty, `/api/v1/occ/planning?stationId=${STATION.stationId}`).json.turnarounds).toEqual([]);
    expect(answer(empty, `/api/v1/occ/map/flights?stationId=${STATION.stationId}`).json.flights).toEqual([]);
    expect(answer(empty, `/api/v1/occ/map/air-picture?stationId=${STATION.stationId}&trails=short`).json.aircraft
      .every(item => item.matchedFlightKey === null)).toBe(true);
  });
});
