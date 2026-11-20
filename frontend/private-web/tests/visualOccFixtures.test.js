import { createElevantApiClient, isOccAerodromeWeather } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY as APP_AUTH_STORAGE_KEY } from '../src/features/auth/authService';
import { mapOccupancyToRampPositions } from '../src/features/positions-map/positionsMapMappers';
import { RAMP_POSITIONS } from '../src/features/dashboard/positionsData';
import { toWeatherReading } from '../src/services/weatherService';
import { MDPC_LAYOUT } from '../src/features/maps/airport/airportLayout';
import { attachStandGeometry, withStandDisplay } from '../src/features/maps/stands/standModel';
import { buildSituation, toFlightsModel, toPictureModel } from '../src/features/maps/traffic/situationModel';
import { standInputsOf } from '../src/features/maps/traffic/standInputs';
import {
  AUTH_STORAGE_KEY, MAP_HEX, OCC_ACCESS, STATION, aerodromeWeather, aircraftTrack, airPicture, arrivalKeyOf,
  assignmentReadiness, createOccApi, demoClock, mapFlights, occSession, operationDateAt, planningSnapshot, positionsBoard,
} from './visual/occ/fixtures/occApi.mjs';

// The synthetic API of the OCC visual suite (tests/visual/occ) must be answers the app accepts: the shared client
// validates the positions board strictly, so a fixture that drifted from the contract would leave the page in its
// error state instead of drawing the map.

const NOW = Date.UTC(2026, 10, 13, 15, 0);
const DATE = '2026-11-13';
const HOUR = 60 * 60 * 1000;

function clientAnswering(body) {
  return createElevantApiClient({
    baseUrl: 'https://api.elevant.test',
    getAccessToken: () => 'visual-suite-token',
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
}

describe('visual suite OCC fixtures', () => {
  it('the positions board passes the strict validator of the shared client for its station', async () => {
    const board = positionsBoard({ date: DATE, now: NOW });
    await expect(clientAnswering(board).getOccPositions(STATION.stationId, DATE)).resolves.toEqual(board);
    // Another station's board is refused, as the page would refuse it.
    await expect(clientAnswering(board).getOccPositions('0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', DATE)).rejects.toThrow();
  });

  it('asked for them, the board brings the coverage windows the client accepts, BN8\'s ended two hours ago (N26)', async () => {
    const board = positionsBoard({ date: DATE, now: NOW, includeCoverage: true });
    await expect(clientAnswering(board).getOccPositions(STATION.stationId, DATE, { includeCoverage: true }))
      .resolves.toEqual(board);
    // Only a read that asked receives them.
    await expect(clientAnswering(board).getOccPositions(STATION.stationId, DATE)).rejects.toThrow();
    const windowsOf = code => board.positions.find(stand => stand.code === code).coverage;
    expect(windowsOf('BN8')).toEqual([{ agentName: 'Agente de prueba', startsAt: new Date(NOW - 8 * HOUR).toISOString(),
      endsAt: new Date(NOW - 2 * HOUR).toISOString(), isReinforcement: false }]);
    expect(windowsOf('A2')).toMatchObject([{ agentName: 'Agente de prueba', endsAt: new Date(NOW + 6 * HOUR).toISOString() }]);
    expect(windowsOf('B24')).toEqual([]);
    // Read as the positions map reads it: BN8 asks for an agent; A2 keeps the one of the day.
    const stands = withStandDisplay(mapOccupancyToRampPositions(RAMP_POSITIONS, board, new Date(NOW).toISOString()),
      { nowMs: NOW });
    const signalsOf = code => stands.find(stand => stand.id === code).signals;
    expect(signalsOf('BN8')).toEqual([{ kind: 'attention', reason: 'uncovered' }]);
    expect(signalsOf('A2')).toEqual([]);
    // The stub answers them only to a read that asks.
    const api = createOccApi({ startedAt: NOW });
    const read = query => api.handle({ method: () => 'GET' },
      new URL(`https://api.elevant.test/api/v1/occ/positions?stationId=${STATION.stationId}&date=${DATE}${query}`)).json;
    expect(read('&includeCoverage=true').positions.every(stand => Array.isArray(stand.coverage))).toBe(true);
    expect(read('').positions.some(stand => 'coverage' in stand)).toBe(false);
  });

  it('the board draws the stands of the map with every state the page can show', () => {
    const board = positionsBoard({ date: DATE, now: NOW });
    const positions = mapOccupancyToRampPositions(RAMP_POSITIONS, board, new Date(NOW).toISOString());
    const states = new Set(positions.map(position => position.status));
    expect([...states].sort()).toEqual(['available', 'disabled', 'occupied', 'planned', 'unverified']);
    // A10 is free and cancelled by its combined neighbour; BN13 has no row; the rest sit at their reference place.
    expect(positions.find(position => position.id === 'A10')).toMatchObject({ status: 'disabled' });
    expect(positions.find(position => position.id === 'BN13')).toMatchObject({ status: 'unverified' });
    expect(positions.every(position => position.locationSource === 'reference')).toBe(true);
  });

  it('the session is one the app reads, for the OCC administrator of PUJ', () => {
    expect(AUTH_STORAGE_KEY).toBe(APP_AUTH_STORAGE_KEY);
    const session = occSession(NOW);
    expect(session).toMatchObject({ role: 'ADMIN_OCC', stationScopes: [{ stationId: STATION.stationId, stationCode: 'PUJ' }] });
    expect(Date.parse(session.expiresAt) - NOW).toBe(8 * 60 * 60 * 1000);
    expect(OCC_ACCESS.permissions).toContain('operations.positions_map.read');
  });

  it('the stub answers the access, the board, the map reads, the ping and the planning, and counts what it serves', async () => {
    const api = createOccApi({ startedAt: NOW });
    const get = path => ({ method: () => 'GET', url: () => `https://api.elevant.test${path}` });
    const answer = path => api.handle(get(path), new URL(`https://api.elevant.test${path}`));
    expect(await answer('/api/v1/governance/me/access')).toEqual({ status: 200, json: OCC_ACCESS });
    const board = await answer(`/api/v1/occ/positions?stationId=${STATION.stationId}&date=${DATE}`);
    expect(board.status).toBe(200);
    expect(board.json).toMatchObject({ stationId: STATION.stationId, operationDate: DATE });
    expect(api.reads).toBe(1);
    // The aerodrome weather (PR M8) of the station asked for, counted.
    const weather = await answer(`/api/v1/occ/weather?stationId=${STATION.stationId}`);
    expect(weather).toMatchObject({ status: 200, json: { stationId: STATION.stationId, status: 'Live' } });
    expect(api.weatherReads).toBe(1);
    // The map reads (PR M6), each counted.
    for (const path of [`/api/v1/occ/map/air-picture?stationId=${STATION.stationId}&trails=short`,
      `/api/v1/occ/map/flights?stationId=${STATION.stationId}`,
      `/api/v1/occ/map/aircraft/${MAP_HEX.holdingB24.toUpperCase()}/track?stationId=${STATION.stationId}`, '/api/v1/system/ping']) {
      expect((await answer(path))?.status, path).toBe(200);
    }
    expect(api.mapReads).toEqual({ airPicture: 1, flights: 1, track: 1, ping: 1 });
    expect((await answer(`/api/v1/occ/map/aircraft/${MAP_HEX.holdingB24.toUpperCase()}/track`)).json.hex).toBe(MAP_HEX.holdingB24);
    expect((await answer(`/api/v1/occ/planning?stationId=${STATION.stationId}`)).json).toMatchObject({ date: operationDateAt(Date.now()) });
    expect((await answer(`/api/v1/occ/planning/assignment-readiness?stationId=${STATION.stationId}&date=${DATE}`)).json)
      .toEqual({ stationId: STATION.stationId, date: DATE, assignments: [] });
    // Anything else is the isolation's 404; a write it does not know, too.
    expect(await answer('/api/v1/occ/review-queue')).toBeNull();
    expect(api.handle({ method: () => 'POST' }, new URL('https://api.elevant.test/api/v1/occ/positions'))).toBeNull();
  });

  it('the aerodrome weather of the stub passes the strict validator of the shared client: a live METAR of 100° at 13 kt', async () => {
    const weather = aerodromeWeather({ now: NOW });
    expect(isOccAerodromeWeather(weather, STATION.stationId)).toBe(true);
    await expect(clientAnswering(weather).getOccAerodromeWeather({ stationId: STATION.stationId })).resolves.toEqual(weather);
    // Read as the positions map reads it: live, the METAR of ten minutes before, its wind and the credit of NOAA.
    const reading = toWeatherReading(weather, { receivedAt: NOW });
    expect(reading).toMatchObject({ apiStatus: 'Live', source: { name: 'NOAA Aviation Weather Center' } });
    expect(Date.parse(reading.observation.observedAt)).toBe(NOW - 10 * 60 * 1000);
    expect(reading.observation.metar.wind).toMatchObject({ directionDeg: 100, speedKt: 13, variable: false });
    expect(reading.taf.periods).toHaveLength(1);
    // Another station's weather is refused, as the page would refuse it.
    expect(isOccAerodromeWeather(weather, '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e')).toBe(false);
  });

  it('the map reads, the ping and the planning pass the strict validators of the shared client', async () => {
    const demo = demoClock(NOW);
    for (const trails of ['short', 'none']) {
      const picture = airPicture({ now: NOW });
      await expect(clientAnswering(picture).getOccAirPicture({ stationId: STATION.stationId, trails }), trails).resolves.toEqual(picture);
    }
    const flights = mapFlights({ now: NOW, demo });
    await expect(clientAnswering(flights).getOccMapFlights({ stationId: STATION.stationId })).resolves.toEqual(flights);
    // Later in the story as well: the demo aircraft on its stand three minutes on.
    const later = mapFlights({ now: NOW + 4 * 60_000, demo });
    await expect(clientAnswering(later).getOccMapFlights({ stationId: STATION.stationId })).resolves.toEqual(later);
    const track = aircraftTrack({ hex: MAP_HEX.holdingB24, now: NOW });
    await expect(clientAnswering(track).getOccAircraftTrack({ stationId: STATION.stationId, hex: MAP_HEX.holdingB24 }))
      .resolves.toEqual(track);
    const ping = { application: 'ELEVANT', status: 'Healthy', environment: 'Visual', timestampUtc: new Date(NOW).toISOString() };
    await expect(clientAnswering(ping).getSystemPing()).resolves.toEqual(ping);
    const snapshot = planningSnapshot({ date: DATE, now: NOW });
    await expect(clientAnswering(snapshot).getOccPlanningSnapshot({ stationId: STATION.stationId, date: DATE })).resolves.toEqual(snapshot);
    const readiness = assignmentReadiness({ date: DATE });
    await expect(clientAnswering(readiness).getOccAssignmentReadiness({ stationId: STATION.stationId, date: DATE }))
      .resolves.toEqual(readiness);
    // The demo board's visit on A3 is the demo flight: due at its on-block, arrived at its touchdown.
    const a3 = positionsBoard({ date: DATE, now: NOW, demo }).positions.find(stand => stand.code === 'A3');
    expect(a3).toMatchObject({ status: 'occupied', turnarounds: [{ isDemo: true, arrivalScheduledAt: new Date(demo.onBlockAt).toISOString(),
      arrivedAt: new Date(demo.touchdownAt).toISOString() }] });
    await expect(clientAnswering(positionsBoard({ date: DATE, now: NOW, demo })).getOccPositions(STATION.stationId, DATE)).resolves
      .toBeDefined();
  });

  it('the map reads tell the story of the visual specs on the board\'s stands', () => {
    const demo = demoClock(NOW);
    const board = positionsBoard({ date: DATE, now: NOW, demo });
    const situation = buildSituation({ picture: toPictureModel(airPicture({ now: NOW })),
      flights: toFlightsModel(mapFlights({ now: NOW, demo })), nowMs: NOW });
    // The live aircraft are the board's flights: ZZ102 on A6 and ZZ111 holding short of B24.
    expect(situation.aircraft.filter(item => item.kind === 'aviam').map(item => item.flightKey).sort())
      .toEqual([arrivalKeyOf(2), arrivalKeyOf(11)].sort());
    const stands = withStandDisplay(attachStandGeometry(mapOccupancyToRampPositions(RAMP_POSITIONS, board, board.asOf), MDPC_LAYOUT),
      { nowMs: NOW, ...standInputsOf(situation) });
    const read = code => stands.find(stand => stand.id === code).display;
    // The demo flight landed and taxis to A3, which the board already calls occupied: «Llegando», its A320 dashed.
    expect(read('A3')).toMatchObject({ state: 'arriving', isDemo: true, footprint: 'planned' });
    // ZZ111 holds outside B24's box: «Llegando»; ZZ102 stands on A6 with no arrival recorded: «Ocupada» and the notice.
    expect(read('B24')).toMatchObject({ state: 'arriving', footprint: 'planned' });
    expect(read('A6')).toMatchObject({ state: 'occupied', footprint: 'solid', signals: [{ kind: 'notice', reason: 'arrivalNotRecorded' }] });
    // The turnarounds on their stands with their milestones, and the planned ones dashed.
    expect(read('A2')).toMatchObject({ state: 'occupied', footprint: 'solid', milestonesDone: 9, milestonesTotal: 25 });
    expect(read('A7')).toMatchObject({ state: 'releasing', footprint: 'solid', milestonesDone: 18 });
    expect(read('A4')).toMatchObject({ state: 'planned', footprint: 'planned' });
    // Four minutes on, the demo aircraft is on A3.
    const later = NOW + 4 * 60_000;
    const laterSituation = buildSituation({ picture: toPictureModel(airPicture({ now: later })),
      flights: toFlightsModel(mapFlights({ now: later, demo })), nowMs: later });
    const laterBoard = positionsBoard({ date: DATE, now: later, demo });
    const laterStands = withStandDisplay(attachStandGeometry(mapOccupancyToRampPositions(RAMP_POSITIONS, laterBoard, laterBoard.asOf),
      MDPC_LAYOUT), { nowMs: later, ...standInputsOf(laterSituation) });
    expect(laterStands.find(stand => stand.id === 'A3').display).toMatchObject({ state: 'occupied', footprint: 'solid', signals: [] });
  });

  it('«Ubicar en el mapa» keeps the location, answers the board with it as the client expects, and the next read keeps it', async () => {
    const api = createOccApi();
    const standId = positionsBoard({ date: DATE, now: NOW }).positions.find(stand => stand.code === 'B27').standId;
    // 25 m south of B27's reference point: a point the map would send.
    const reference = RAMP_POSITIONS.find(position => position.id === 'B27');
    const body = { latitude: Number((reference.lat - 25 / 111_195).toFixed(6)), longitude: reference.lon, operationDate: DATE };
    const put = { method: () => 'PUT', postData: () => JSON.stringify(body) };
    const url = new URL(`https://api.elevant.test/api/v1/occ/stands/${standId}/location`);
    const placed = api.handle(put, url);
    expect(placed.status).toBe(200);
    expect(api.locates).toEqual([{ standId, ...body }]);
    expect(placed.json.positions.find(stand => stand.standId === standId)).toMatchObject({
      code: 'B27', latitude: body.latitude, longitude: body.longitude,
    });
    // The shared client's command accepts that answer.
    await expect(clientAnswering(placed.json).locateOccStand(standId, body)).resolves.toEqual(placed.json);

    // The next read keeps it: the positions map draws B27 where OCC put it, every other stand at its reference.
    const read = api.handle({ method: () => 'GET' }, new URL(`https://api.elevant.test/api/v1/occ/positions?stationId=${STATION.stationId}&date=${DATE}`));
    const positions = mapOccupancyToRampPositions(RAMP_POSITIONS, read.json, new Date(NOW).toISOString());
    expect(positions.filter(position => position.locationSource === 'occ').map(position => position.id)).toEqual(['B27']);
    expect(positions.find(position => position.id === 'B27')).toMatchObject({ latitude: body.latitude, longitude: body.longitude });

    // A location cleared with nulls is forgotten.
    api.handle({ method: () => 'PUT', postData: () => JSON.stringify({ latitude: null, longitude: null, operationDate: DATE }) }, url);
    expect(api.located.size).toBe(0);
    expect(api.handle({ method: () => 'PUT', postData: () => '{}' }, new URL('https://api.elevant.test/api/v1/occ/stands'))).toBeNull();
  });
});
