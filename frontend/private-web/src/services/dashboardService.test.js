import { describe, expect, it } from 'vitest';
import { getDashboardSnapshot } from './dashboardService';

describe('getDashboardSnapshot', () => {
  it('resolves with all top-level fields of the documented contract', async () => {
    const snapshot = await getDashboardSnapshot();
    expect(snapshot).toEqual(
      expect.objectContaining({
        station: expect.objectContaining({ code: expect.any(String) }),
        kpis: expect.objectContaining({
          flightsToday: expect.any(Number),
          servicesPending: expect.any(Number),
          servicesExecuted: expect.any(Number),
          agentsActive: expect.any(Number),
          approvalsPending: expect.any(Number),
        }),
        flyAware: expect.objectContaining({
          status: 'unavailable',
          lastSyncMinutesAgo: null,
        }),
        flightStatusDistribution: expect.any(Array),
        pendingApprovals: expect.any(Array),
        alerts: expect.any(Array),
      })
    );
  });

  it('reflects the requested station code', async () => {
    const snapshot = await getDashboardSnapshot('MDT');
    expect(snapshot.station.code).toBe('MDT');
  });

  it('defaults to PUJ when no station code is passed', async () => {
    const snapshot = await getDashboardSnapshot();
    expect(snapshot.station.code).toBe('PUJ');
  });

  it('includes all six flight status buckets', async () => {
    const snapshot = await getDashboardSnapshot();
    const statuses = snapshot.flightStatusDistribution.map(entry => entry.status);
    expect(statuses.sort()).toEqual(
      ['cancelled', 'delayed', 'diverted', 'enRoute', 'landed', 'scheduled'].sort()
    );
  });
});
