import { beforeEach, expect, it, vi } from 'vitest';
import { getFinanceReport } from './financeReportsService';
import { getFinancePreinvoices } from './financePreinvoiceService';

vi.mock('./financePreinvoiceService', () => ({ getFinancePreinvoices: vi.fn() }));
beforeEach(() => vi.mocked(getFinancePreinvoices).mockReset());

it('groups only authorized first-page prefacturas by airline and currency without inventing totals', async () => {
  vi.mocked(getFinancePreinvoices).mockResolvedValue({ page: 1, limit: 50, hasMore: true,
    preinvoices: [
      { id: 'pre-1', airlineId: 'airline-1', airlineName: 'Arajet',
        currencyCode: 'USD', status: 'Invoiced' },
      { id: 'pre-2', airlineId: 'airline-1', airlineName: 'Arajet',
        currencyCode: 'DOP', status: 'Disputed' },
      { id: 'pre-3', airlineId: 'airline-1', airlineName: 'Arajet',
        currencyCode: 'USD', status: 'Draft' },
    ] });
  const result = await getFinanceReport({ stationId: 'station-one' });
  expect(getFinancePreinvoices).toHaveBeenCalledWith(
    { stationId: 'station-one', page: 1, limit: 50 }, { signal: undefined });
  expect(result).toMatchObject({ hasMore: true,
    counts: { drafts: 1, disputed: 1, invoiced: 1 },
    rows: [{ airlineId: 'airline-1', currencyCode: 'DOP', disputed: 1 },
      { airlineId: 'airline-1', currencyCode: 'USD', drafts: 1, invoiced: 1 }],
  });
  expect(result).not.toHaveProperty('audit');
});