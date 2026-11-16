import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(),
  readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn(),
  getManagedContracts: vi.fn(),
}));

vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
}));

import { getManagedContracts } from './commercialGovernanceApi';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'contracts-token' });
  mocks.createPrivateWebApiClient.mockReturnValue({ getManagedContracts: mocks.getManagedContracts });
});

it('uses the shared authenticated contract for a bounded page', async () => {
  const page = { page: 2, limit: 20, hasMore: false, contracts: [] };
  mocks.getManagedContracts.mockResolvedValueOnce(page);
  await expect(getManagedContracts(2)).resolves.toBe(page);
  expect(mocks.getManagedContracts).toHaveBeenCalledWith({ page: 2, limit: 20 });
  expect(mocks.createPrivateWebApiClient.mock.calls[0][0].getAccessToken())
    .toBe('contracts-token');
});

it('expires the local session when the API rejects its token', async () => {
  mocks.getManagedContracts.mockRejectedValueOnce({ status: 401 });
  await expect(getManagedContracts()).rejects.toEqual({ status: 401 });
  expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});