import { describe, expect, it } from 'vitest';
import { getFinanceHomeSnapshot } from './financeHomeService';

describe('financeHomeService', () => {
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
