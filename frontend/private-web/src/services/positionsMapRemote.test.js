import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), getPlanningSnapshot: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: mocks.readSession }));
vi.mock('./planningService', () => ({ getPlanningSnapshot: mocks.getPlanningSnapshot }));

import { getPositionsSnapshot, subscribeToPositionUpdates } from './positionsMapService';

const stationId = '20000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ stationScopes: [{ stationId, stationCode: 'PUJ' }] });
  mocks.getPlanningSnapshot.mockResolvedValue({
    station: { id: stationId, code: 'PUJ' },
    turnarounds: [{ id: 'turnaround', stand: { code: 'A5' },
      arrival: { id: 'flight-leg', flightNumber: 'DEV101' }, departure: null,
      airline: { name: 'Aerolinea' }, aircraft: { model: 'A320', registration: 'TEST-001' },
      agents: [{ displayName: 'Agente' }],
    }],
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('canonical positions map', () => {
  it('marks only planned stands and never labels the others physically free', async () => {
    const snapshot = await getPositionsSnapshot('PUJ');
    expect(mocks.getPlanningSnapshot).toHaveBeenCalledWith({ stationId });
    expect(snapshot.source).toBe('planning');
    expect(snapshot.positions.find(position => position.id === 'A5')).toEqual(
      expect.objectContaining({ status: 'planned', flightId: 'flight-leg', flightNumber: 'DEV101' }));
    expect(snapshot.positions.find(position => position.id === 'A1')).toEqual(
      expect.objectContaining({ status: 'unverified', flightId: null }));
    expect(snapshot.positions.every(position => position.status !== 'available')).toBe(true);
  });

  it('rejects out-of-scope stations without using prototype occupancy', async () => {
    await expect(getPositionsSnapshot('MDT')).rejects.toThrow(/no tiene acceso/);
    expect(mocks.getPlanningSnapshot).not.toHaveBeenCalled();
  });

  it('shows only actual planned stands for another station, without PUJ geometry', async () => {
    const secondId = '20000000-0000-0000-0000-000000000002';
    mocks.readSession.mockReturnValue({ stationScopes: [
      { stationId, stationCode: 'PUJ' }, { stationId: secondId, stationCode: 'SDQ' },
    ] });
    mocks.getPlanningSnapshot.mockResolvedValue({
      station: { id: secondId, code: 'SDQ', name: 'Santo Domingo' },
      turnarounds: [{ operationCode: 'DEV-TAT-0002', stand: {
        code: 'G1', terminal: { code: 'T1' },
      }, arrival: { flightNumber: 'EV311' }, departure: null }],
    });
    const snapshot = await getPositionsSnapshot('SDQ');
    expect(mocks.getPlanningSnapshot).toHaveBeenCalledWith({ stationId: secondId });
    expect(snapshot.source).toBe('planning-no-map');
    expect(snapshot.positions).toEqual([expect.objectContaining({
      id: 'G1', terminal: 'T1', status: 'planned', plannedFlights: ['EV311'],
    })]);
    expect(snapshot.positions.every(position => position.latitude == null &&
      position.longitude == null)).toBe(true);
  });

  it('rejects a planning response for a different station', async () => {
    mocks.getPlanningSnapshot.mockResolvedValue({
      station: { id: '20000000-0000-0000-0000-000000000099', code: 'SDQ' },
      turnarounds: [],
    });
    await expect(getPositionsSnapshot('PUJ')).rejects.toThrow(/estación/);
  });

  it('polls the selected station and reports full replacement and failure', async () => {
    vi.useFakeTimers();
    const secondId = '20000000-0000-0000-0000-000000000002';
    mocks.readSession.mockReturnValue({ stationScopes: [
      { stationId, stationCode: 'PUJ' }, { stationId: secondId, stationCode: 'SDQ' },
    ] });
    mocks.getPlanningSnapshot.mockResolvedValue({
      station: { id: secondId, code: 'SDQ' }, turnarounds: [],
    });
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToPositionUpdates(() => {}, 'SDQ', { onSnapshot, onError });
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mocks.getPlanningSnapshot).toHaveBeenCalledWith({ stationId: secondId });
      expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        station: expect.objectContaining({ code: 'SDQ' }), positions: [],
      }));
      mocks.getPlanningSnapshot.mockRejectedValueOnce(new Error('API unavailable'));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
