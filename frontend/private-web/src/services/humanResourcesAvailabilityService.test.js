import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession, handleUnauthorizedResponse } from '../features/auth/authService';
import { getHumanResourcesAvailabilityRequests,
  recordHumanResourcesAvailabilityRequest,
  resolveHumanResourcesAvailabilityRequest } from './humanResourcesAvailabilityService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

it('reads a bounded HR availability page with the current token and cancellation', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const query = { from: '2026-10-05', to: '2026-10-11', page: 1, limit: 20 };
  const page = { ...query, hasMore: false, requests: [] };
  const get = vi.fn().mockResolvedValue(page);
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesAvailabilityRequests: get });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesAvailabilityRequests(query, { signal })).resolves.toEqual(page);
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
  expect(get).toHaveBeenCalledWith(query, { signal });
});

it('passes stable write intentions and invalidates an expired session', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const id = '50000000-0000-7000-8000-000000000081';
  const record = vi.fn().mockResolvedValue({ id, status: 'Pending' });
  const resolve = vi.fn().mockRejectedValue({ status: 401 });
  createPrivateWebApiClient.mockReturnValue({
    recordHumanResourcesAvailabilityRequest: record,
    resolveHumanResourcesAvailabilityRequest: resolve,
  });
  const input = { rampProfileId: '50000000-0000-7000-8000-000000000001',
    startsOn: '2026-10-05', endsOn: '2026-10-06',
    type: 'DayOff', reason: 'Synthetic leave' };
  await expect(recordHumanResourcesAvailabilityRequest(id, input))
    .resolves.toEqual({ id, status: 'Pending' });
  expect(record).toHaveBeenCalledWith(id, input, {});
  await expect(resolveHumanResourcesAvailabilityRequest(id,
    { decision: 'Approve', note: null })).rejects.toMatchObject({ status: 401 });
  expect(resolve).toHaveBeenCalledWith(id,
    { decision: 'Approve', note: null }, {});
  expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});
