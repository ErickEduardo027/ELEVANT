import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';
import { getHumanResourcesShifts } from './humanResourcesShiftsReadService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

it('uses the shared authenticated API client for a week with cancellation', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const read = vi.fn().mockResolvedValue({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [] });
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesShifts: read });
  const query = { from: '2026-08-17', to: '2026-08-23', page: 1, limit: 20 };
  const signal = new AbortController().signal;
  await expect(getHumanResourcesShifts(query, { signal }))
    .resolves.toMatchObject({ shifts: [] });
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
  expect(read).toHaveBeenCalledWith(query, { signal });
});
