import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), getPlanningSnapshot: vi.fn(), loadOccPositions: vi.fn() }));
vi.mock('./occPositionsService', () => ({ loadOccPositions: mocks.loadOccPositions }));
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
  it('shows PUJ real occupancy and labels free only stands registered in the station', async () => {
    const turnaround = { turnaroundId: 't-1', operationCode: 'DEV-TAT-0001', airlineName: 'Aerolinea',
      aircraftRegistration: 'HI1055', arrivalFlightNumber: 'DEV101', departureFlightNumber: null,
      arrivalScheduledAt: '2026-08-18T16:00:00Z', arrivedAt: '2026-08-18T16:05:00Z', departureScheduledAt: null,
      assignedFrom: '2026-08-18T15:00:00Z', status: 'InProgress' };
    mocks.loadOccPositions.mockResolvedValue({ stationId, stationCode: 'PUJ', operationDate: '2026-08-18',
      asOf: '2026-08-18T16:06:00Z', canAssign: true, unassigned: [], positions: [
        { standId: 's-5', code: 'A05', terminalCode: 'A', standType: null, status: 'occupied', turnarounds: [turnaround] },
        { standId: 's-2', code: 'A02', terminalCode: 'A', standType: null, status: 'available', turnarounds: [] }] });
    const snapshot = await getPositionsSnapshot('PUJ');
    expect(mocks.loadOccPositions).toHaveBeenCalledWith(stationId, expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/));
    expect(mocks.getPlanningSnapshot).not.toHaveBeenCalled();
    expect(snapshot).toEqual(expect.objectContaining({ source: 'occupancy', canAssign: true }));
    expect(snapshot.positions.find(position => position.id === 'A5')).toEqual(
      expect.objectContaining({ status: 'occupied', standId: 's-5', flightNumber: 'DEV101', aircraftRegistration: 'HI1055' }));
    expect(snapshot.positions.find(position => position.id === 'A2').status).toBe('available');
    expect(snapshot.positions.find(position => position.id === 'A1')).toEqual(
      expect.objectContaining({ status: 'unverified', standId: null }));
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
    mocks.readSession.mockReturnValue({ stationScopes: [{ stationId: '20000000-0000-0000-0000-000000000002', stationCode: 'SDQ' }] });
    mocks.getPlanningSnapshot.mockResolvedValue({
      station: { id: '20000000-0000-0000-0000-000000000099', code: 'SDQ' },
      turnarounds: [],
    });
    await expect(getPositionsSnapshot('SDQ')).rejects.toThrow(/estación/);
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
