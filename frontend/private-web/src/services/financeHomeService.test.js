import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFinanceHomeSnapshot } from './financeHomeService';

describe('financeHomeService', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('does not call the removed prototype endpoint in Development runtime', async () => {
    vi.stubEnv('MODE', 'development');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const snapshot = await getFinanceHomeSnapshot();
    expect(snapshot.kpis.approvedServices).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns the financial summary required by the home page', async () => {
    const snapshot = await getFinanceHomeSnapshot();

    expect(snapshot.kpis.approvedServices).toBeGreaterThan(0);
    expect(snapshot.approvedServices[0]).toMatchObject({ airline: expect.any(String), amount: expect.any(Number) });
    expect(snapshot.pendingActions.some(action => action.kind === 'Pre-factura')).toBe(true);
  });

  it('returns an isolated copy', async () => {
    const first = await getFinanceHomeSnapshot();
    first.kpis.approvedServices = 0;

    const second = await getFinanceHomeSnapshot();
    expect(second.kpis.approvedServices).not.toBe(0);
  });
});
