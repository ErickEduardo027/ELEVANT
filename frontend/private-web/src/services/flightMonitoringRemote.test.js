import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  getPlanningSnapshot: vi.fn(),
}));

vi.mock('../features/auth/authService', () => ({ readSession: mocks.readSession }));
vi.mock('./planningService', () => ({ getPlanningSnapshot: mocks.getPlanningSnapshot }));

import { getFlightMonitoringSnapshot, subscribeToFlightUpdates } from './flightMonitoringService';

const stationId = '20000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ stationScopes: [{ stationId, stationCode: 'PUJ' }] });
  mocks.getPlanningSnapshot.mockResolvedValue({
    station: { id: stationId, code: 'PUJ', name: 'Punta Cana' },
    turnarounds: [{
      id: '70000000-0000-0000-0000-000000000001',
      airline: { name: 'Aerolinea' },
      aircraft: { model: 'A320', registration: 'TEST-001' },
      stand: { code: 'A5' }, agents: [{ id: 'agent' }],
      services: [{ name: 'Equipaje' }],
      arrival: {
        id: '70000000-0000-0000-0000-000000000002', flightNumber: 'DEV101',
        origin: { iataCode: 'MIA' }, destination: { iataCode: 'PUJ' },
        scheduledAt: '2026-09-24T10:00:00Z', estimatedAt: '2026-09-24T10:15:00Z', actualAt: null,
      },
      departure: null,
    }],
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('canonical flight monitoring', () => {
  it('uses the versioned planning client and never invents telemetry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const snapshot = await getFlightMonitoringSnapshot('PUJ');
      expect(mocks.getPlanningSnapshot).toHaveBeenCalledWith({ stationId });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(snapshot.flights).toEqual([expect.objectContaining({
        id: '70000000-0000-0000-0000-000000000002', flightNumber: 'DEV101',
        status: 'delayed', eta: '2026-09-24T10:15:00Z', etd: null,
        latitude: null, longitude: null, speed: null, heading: null, altitude: null,
      })]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('refuses a station outside the live session scope before requesting data', async () => {
    await expect(getFlightMonitoringSnapshot('MDT')).rejects.toThrow(/no tiene acceso/);
    expect(mocks.getPlanningSnapshot).not.toHaveBeenCalled();
  });

  it('propagates canonical API failure instead of falling back to prototype fixtures', async () => {
    mocks.getPlanningSnapshot.mockRejectedValue(new Error('API no disponible'));
    await expect(getFlightMonitoringSnapshot()).rejects.toThrow('API no disponible');
  });

  it('labels a recorded actual time without claiming aircraft position or movement', async () => {
    const snapshot = await mocks.getPlanningSnapshot();
    snapshot.turnarounds[0].arrival.actualAt = '2026-09-24T10:18:00Z';
    mocks.getPlanningSnapshot.mockResolvedValue(snapshot);

    const result = await getFlightMonitoringSnapshot();

    expect(result.flights[0]).toMatchObject({
      status: 'actualRecorded', actualArrival: '2026-09-24T10:18:00Z',
      latitude: null, longitude: null,
    });
  });

  it('carries the leg\'s three times, the demo mark and the states of the turnaround for the board', async () => {
    const snapshot = await mocks.getPlanningSnapshot();
    Object.assign(snapshot.turnarounds[0], { status: 'InProgress', isDemo: true, operation: { status: 'Returned' } });
    snapshot.station.ianaTimeZone = 'America/Santo_Domingo';
    mocks.getPlanningSnapshot.mockResolvedValue(snapshot);

    const result = await getFlightMonitoringSnapshot();

    expect(result.station).toEqual({ code: 'PUJ', localAbbr: 'AST', ianaTimeZone: 'America/Santo_Domingo' });
    expect(result.flights[0]).toMatchObject({
      direction: 'arrival', scheduledAt: '2026-09-24T10:00:00Z', estimatedAt: '2026-09-24T10:15:00Z', actualAt: null,
      isDemo: true, turnaroundStatus: 'InProgress', operationStatus: 'Returned',
      // What the page always had stays as it was.
      status: 'delayed', eta: '2026-09-24T10:15:00Z', stand: 'A5', agents: 1, services: ['Equipaje'],
      registration: 'TEST-001', aircraft: 'A320',
    });
  });

  it('marks no flight as demo without the server\'s mark and leaves an unknown aircraft empty', async () => {
    const snapshot = await mocks.getPlanningSnapshot();
    Object.assign(snapshot.turnarounds[0], { aircraft: null, isDemo: null });
    mocks.getPlanningSnapshot.mockResolvedValue(snapshot);

    const [flight] = (await getFlightMonitoringSnapshot()).flights;

    expect(flight).toMatchObject({ isDemo: false, turnaroundStatus: null, operationStatus: null, registration: null,
      aircraft: null });
  });

  it('keeps no timer of its own: the screen re-reads on the shell\'s announcements (CN-18/19)', async () => {
    vi.useFakeTimers();
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeToFlightUpdates(() => {}, 'PUJ', { onSnapshot, onError });
    try {
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mocks.getPlanningSnapshot).not.toHaveBeenCalled();
      expect(onSnapshot).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });
});
