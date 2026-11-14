import { createElevantApiClient } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY as APP_AUTH_STORAGE_KEY } from '../src/features/auth/authService';
import { mapOccupancyToRampPositions } from '../src/features/positions-map/positionsMapMappers';
import { RAMP_POSITIONS } from '../src/features/dashboard/positionsData';
import {
  AUTH_STORAGE_KEY, OCC_ACCESS, STATION, createOccApi, occSession, positionsBoard,
} from './visual/occ/fixtures/occApi.mjs';

// The synthetic API of the OCC visual suite (tests/visual/occ) must be answers the app accepts: the shared client
// validates the positions board strictly, so a fixture that drifted from the contract would leave the page in its
// error state instead of drawing the map.

const NOW = Date.UTC(2026, 10, 13, 15, 0);
const DATE = '2026-11-13';

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

  it('the stub answers only the access and the board, and counts the boards it serves', async () => {
    const api = createOccApi();
    const get = path => ({ method: () => 'GET', url: () => `https://api.elevant.test${path}` });
    const answer = path => api.handle(get(path), new URL(`https://api.elevant.test${path}`));
    expect(await answer('/api/v1/governance/me/access')).toEqual({ status: 200, json: OCC_ACCESS });
    const board = await answer(`/api/v1/occ/positions?stationId=${STATION.stationId}&date=${DATE}`);
    expect(board.status).toBe(200);
    expect(board.json).toMatchObject({ stationId: STATION.stationId, operationDate: DATE });
    expect(api.reads).toBe(1);
    expect(await answer('/api/v1/occ/planning')).toBeNull();
    expect(api.handle({ method: () => 'POST' }, new URL('https://api.elevant.test/api/v1/occ/positions'))).toBeNull();
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
