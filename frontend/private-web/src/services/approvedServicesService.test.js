import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(),
  getFinanceApprovedServices: vi.fn(),
  createPreinvoiceDraft: vi.fn(),
  getPreinvoiceDraft: vi.fn(),
  readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn(),
}));

vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
}));

import { getApprovedServices, createPreinvoiceDraft, getPreinvoiceDraft } from './approvedServicesService';

const query = {
  stationId: '20000000-0000-7000-8000-000000000003',
  from: '2026-08-19', to: '2026-08-19',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'finance-token' });
  mocks.createPrivateWebApiClient.mockReturnValue({
    getFinanceApprovedServices: mocks.getFinanceApprovedServices,
    createPreinvoiceDraft: mocks.createPreinvoiceDraft,
    getPreinvoiceDraft: mocks.getPreinvoiceDraft,
  });
  mocks.getFinanceApprovedServices.mockResolvedValue({ services: [], hasMore: false });
});

describe('approvedServicesService', () => {
  it('uses the shared authenticated API and forwards the request abort signal', async () => {
    const controller = new AbortController();
    await expect(getApprovedServices(query, { signal: controller.signal }))
      .resolves.toEqual({ services: [], hasMore: false });
    expect(mocks.getFinanceApprovedServices).toHaveBeenCalledWith(query,
      { signal: controller.signal });
    expect(mocks.createPrivateWebApiClient.mock.calls[0][0].getAccessToken())
      .toBe('finance-token');
  });

  it('clears a rejected session instead of showing stale finance evidence', async () => {
    mocks.getFinanceApprovedServices.mockRejectedValueOnce({ status: 401 });
    await expect(getApprovedServices(query)).rejects.toEqual({ status: 401 });
    expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
  });

  it('uses the canonical client for draft creation and scoped detail', async () => {
    const request = { ...query, requestId: crypto.randomUUID(), serviceIds: [crypto.randomUUID()] };
    const id = crypto.randomUUID();
    mocks.createPreinvoiceDraft.mockResolvedValueOnce({ id, replayed: false });
    mocks.getPreinvoiceDraft.mockResolvedValueOnce({ id, stationId: query.stationId });
    await expect(createPreinvoiceDraft(request)).resolves.toEqual({ id, replayed: false });
    await expect(getPreinvoiceDraft(id, query.stationId)).resolves.toEqual({ id, stationId: query.stationId });
    expect(mocks.createPreinvoiceDraft).toHaveBeenCalledWith(request);
    expect(mocks.getPreinvoiceDraft).toHaveBeenCalledWith(id, query.stationId);
  });
});
