import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(), readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn(), getFinancePreinvoices: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
}));

import { getFinancePreinvoices } from './financePreinvoiceService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'finance-token' });
  mocks.createPrivateWebApiClient.mockReturnValue({
    getFinancePreinvoices: mocks.getFinancePreinvoices,
  });
});

it('uses the authenticated station-scoped API client', async () => {
  const query = { stationId: 'station-one', page: 1, limit: 20 };
  const page = { ...query, hasMore: false, preinvoices: [] };
  mocks.getFinancePreinvoices.mockResolvedValueOnce(page);
  await expect(getFinancePreinvoices(query)).resolves.toBe(page);
  expect(mocks.getFinancePreinvoices).toHaveBeenCalledWith(query, { signal: undefined });
  expect(mocks.createPrivateWebApiClient.mock.calls[0][0].getAccessToken())
    .toBe('finance-token');
});

it('expires the local session after API authorization fails', async () => {
  mocks.getFinancePreinvoices.mockRejectedValueOnce({ status: 401 });
  await expect(getFinancePreinvoices({ stationId: 'station-one' }))
    .rejects.toEqual({ status: 401 });
  expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});
