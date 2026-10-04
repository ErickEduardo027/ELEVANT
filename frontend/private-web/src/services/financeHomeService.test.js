import { beforeEach, expect, it, vi } from 'vitest';
import { getFinanceHomeSnapshot } from './financeHomeService';
import { getApprovedServices } from './approvedServicesService';
import { getFinancePreinvoices } from './financePreinvoiceService';

vi.mock('./approvedServicesService', () => ({ getApprovedServices: vi.fn() }));
vi.mock('./financePreinvoiceService', () => ({ getFinancePreinvoices: vi.fn() }));

const stationId = '10000000-0000-7000-8000-000000000001';
const query = { stationId, from: '2026-09-01', to: '2026-09-28' };

beforeEach(() => {
  vi.mocked(getApprovedServices).mockReset();
  vi.mocked(getFinancePreinvoices).mockReset();
});

it('derives a bounded financial summary from the two station-authorized API reads', async () => {
  vi.mocked(getApprovedServices).mockResolvedValue({ hasMore: true, services: [
    { id: 'service-1', airlineName: 'Arajet', flightNumber: 'DM 100',
      serviceName: 'GPU', operationDate: '2026-09-27', amount: 250,
      frozenCurrency: 'USD', ready: true, preinvoiceId: null },
    { id: 'service-2', airlineName: 'Arajet', flightNumber: 'DM 101',
      serviceName: 'Escalera', operationDate: '2026-09-26', amount: null,
      frozenCurrency: null, ready: false, preinvoiceId: null },
  ] });
  vi.mocked(getFinancePreinvoices).mockResolvedValue({ hasMore: true, preinvoices: [
    { id: 'pre-1', airlineName: 'Arajet', status: 'Draft', total: 250,
      currencyCode: 'USD' },
    { id: 'pre-2', airlineName: 'Arajet', status: 'Disputed', total: 280,
      currencyCode: 'USD' },
    { id: 'pre-3', airlineName: 'Arajet', status: 'Invoiced', total: 310,
      currencyCode: 'USD' },
  ] });

  const result = await getFinanceHomeSnapshot(query);

  expect(getApprovedServices).toHaveBeenCalledWith(query, { signal: undefined });
  expect(getFinancePreinvoices).toHaveBeenCalledWith(
    { stationId, page: 1, limit: 50 }, { signal: undefined });
  expect(result).toMatchObject({
    kpis: { approvedServices: 2, readyForPreinvoice: 1,
      draftPreinvoices: 1, disputedPreinvoices: 1 },
    bounds: { servicesHaveMore: true, preinvoicesHaveMore: true },
    approvedServices: [{ id: 'service-1', airline: 'Arajet',
      flight: 'DM 100', operationDate: '2026-09-27', amount: 250,
      currency: 'USD' }, { id: 'service-2', amount: null, currency: null }],
  });
  expect(result.pendingActions.map(item => item.id)).toEqual(['pre-1', 'pre-2']);
});

it('fails closed rather than showing stale or invented finance data', async () => {
  vi.mocked(getApprovedServices).mockRejectedValue(new Error('offline'));
  vi.mocked(getFinancePreinvoices).mockResolvedValue({ preinvoices: [], hasMore: false });
  await expect(getFinanceHomeSnapshot(query)).rejects.toThrow('offline');
});