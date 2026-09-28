import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(), readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn(), getFinancePreinvoices: vi.fn(),
  submitPreinvoice: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
}));

import { getFinancePreinvoices, submitFinancePreinvoice } from './financePreinvoiceService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'finance-token' });
  mocks.createPrivateWebApiClient.mockReturnValue({
    getFinancePreinvoices: mocks.getFinancePreinvoices,
    submitPreinvoice: mocks.submitPreinvoice,
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

it('uses the draft identifier as a stable idempotency key across an uncertain retry', async () => {
  const id = '10000000-0000-7000-8000-000000000001';
  mocks.submitPreinvoice.mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ id, status: 'Submitted', replayed: true });
  await expect(submitFinancePreinvoice(id)).rejects.toThrow('network');
  await expect(submitFinancePreinvoice(id))
    .resolves.toEqual({ id, status: 'Submitted', replayed: true });
  expect(mocks.submitPreinvoice).toHaveBeenCalledTimes(2);
  expect(mocks.submitPreinvoice).toHaveBeenNthCalledWith(1, id, { requestId: id });
  expect(mocks.submitPreinvoice).toHaveBeenNthCalledWith(2, id, { requestId: id });
});

it('expires the local session when submitting returns unauthorized', async () => {
  mocks.submitPreinvoice.mockRejectedValueOnce({ status: 401 });
  await expect(submitFinancePreinvoice('10000000-0000-7000-8000-000000000001'))
    .rejects.toEqual({ status: 401 });
  expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});
