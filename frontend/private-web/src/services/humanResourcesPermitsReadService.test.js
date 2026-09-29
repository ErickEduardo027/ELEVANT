import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';
import { getHumanResourcesPermits } from './humanResourcesPermitsReadService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

it('uses the shared authenticated API client with paging and cancellation', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const read = vi.fn().mockResolvedValue({ page: 1, limit: 20, hasMore: false, permits: [] });
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesPermits: read });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesPermits({ page: 1, limit: 20 }, { signal }))
    .resolves.toMatchObject({ permits: [] });
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
  expect(read).toHaveBeenCalledWith({ page: 1, limit: 20 }, { signal });
});
