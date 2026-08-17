import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getPositionsSnapshot, getPositionById, getPositionStatus, subscribeToPositionUpdates } from './positionsMapService';
import { RAMP_POSITIONS } from '../features/dashboard/positionsData';

describe('getPositionsSnapshot', () => {
  it('resolves with a station and one position per surveyed coordinate — no invented positions', async () => {
    const snapshot = await getPositionsSnapshot();
    expect(snapshot.station).toEqual({ code: 'PUJ', localAbbr: 'AST' });
    expect(snapshot.positions).toHaveLength(RAMP_POSITIONS.length);
    expect(snapshot.positions.map(position => position.id).sort()).toEqual(RAMP_POSITIONS.map(p => p.id).sort());
  });

  it('reflects the requested station code', async () => {
    const snapshot = await getPositionsSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
  });

  it('shapes every position with the documented, backend-ready fields', async () => {
    const snapshot = await getPositionsSnapshot();
    for (const position of snapshot.positions) {
      expect(position).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          terminal: expect.any(String),
          latitude: expect.any(Number),
          longitude: expect.any(Number),
          status: expect.stringMatching(/^(available|occupied|disabled|releasing)$/),
        })
      );
      expect(position).toHaveProperty('flightId');
      expect(position).toHaveProperty('combinedConfiguration');
      expect(position).toHaveProperty('linkedPositionId');
    }
  });

  it('only declares the two explicitly configured combined relations (9-Alfa, 32-Bravo) — none invented', async () => {
    const snapshot = await getPositionsSnapshot();
    const combined = snapshot.positions.filter(position => position.combinedConfiguration);
    expect(combined.map(position => position.id).sort()).toEqual(['A10', 'A9', 'B32', 'B33']);

    const a9 = snapshot.positions.find(position => position.id === 'A9');
    const a10 = snapshot.positions.find(position => position.id === 'A10');
    expect(a9).toEqual(expect.objectContaining({ status: 'occupied', combinedConfiguration: '9-Alfa', linkedPositionId: 'A10' }));
    expect(a10).toEqual(expect.objectContaining({ status: 'disabled', combinedConfiguration: '9-Alfa', linkedPositionId: 'A9' }));

    const b32 = snapshot.positions.find(position => position.id === 'B32');
    const b33 = snapshot.positions.find(position => position.id === 'B33');
    expect(b32).toEqual(expect.objectContaining({ status: 'occupied', combinedConfiguration: '32-Bravo', linkedPositionId: 'B33' }));
    expect(b33).toEqual(expect.objectContaining({ status: 'disabled', combinedConfiguration: '32-Bravo', linkedPositionId: 'B32' }));
  });
});

describe('getPositionById / getPositionStatus', () => {
  it('resolves a single position by id', async () => {
    const position = await getPositionById('A9');
    expect(position.id).toBe('A9');
  });

  it('rejects for an unknown id', async () => {
    await expect(getPositionById('Z99')).rejects.toThrow(/no existe/i);
  });

  it('resolves only the id/status/updatedAt slice', async () => {
    const status = await getPositionStatus('A10');
    expect(status).toEqual({ id: 'A10', status: 'disabled', updatedAt: expect.any(String) });
  });
});

describe('subscribeToPositionUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only emits heartbeats (no id) before the combined-configuration activation tick', () => {
    const onUpdate = vi.fn();
    subscribeToPositionUpdates(onUpdate);

    vi.advanceTimersByTime(6000); // tick 1
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({ heartbeatAt: expect.any(String) }));
    expect(onUpdate.mock.calls[0][0].id).toBeUndefined();
  });

  it('activates a new 29-Bravo combined configuration (B29 occupied, B30 disabled) on tick 2', () => {
    const onUpdate = vi.fn();
    subscribeToPositionUpdates(onUpdate);

    vi.advanceTimersByTime(12000); // tick 2

    const b29 = onUpdate.mock.calls.map(([update]) => update).find(update => update.id === 'B29');
    const b30 = onUpdate.mock.calls.map(([update]) => update).find(update => update.id === 'B30');
    expect(b29).toEqual(expect.objectContaining({ status: 'occupied', combinedConfiguration: '29-Bravo', linkedPositionId: 'B30' }));
    expect(b30).toEqual(expect.objectContaining({ status: 'disabled', combinedConfiguration: '29-Bravo', linkedPositionId: 'B29' }));
  });

  it('activates the configuration only once', () => {
    const onUpdate = vi.fn();
    subscribeToPositionUpdates(onUpdate);

    vi.advanceTimersByTime(12000);
    const firstActivationCount = onUpdate.mock.calls.filter(([update]) => update.id === 'B29').length;
    expect(firstActivationCount).toBe(1);

    vi.advanceTimersByTime(24000);
    const totalActivationCount = onUpdate.mock.calls.filter(([update]) => update.id === 'B29').length;
    expect(totalActivationCount).toBe(1);
  });

  it('stops emitting once unsubscribed', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeToPositionUpdates(onUpdate);
    unsubscribe();

    vi.advanceTimersByTime(24000);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
