import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), getPlanningSnapshot: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: mocks.readSession }));
vi.mock('./planningService', () => ({ getPlanningSnapshot: mocks.getPlanningSnapshot }));

import { getPositionsSnapshot } from './positionsMapService';

const stationId = '20000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.stubEnv('MODE', 'development');
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
});
