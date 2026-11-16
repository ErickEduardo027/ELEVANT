import { afterEach, expect, it, vi } from 'vitest';
import { getHumanResourcesScheduleWarnings } from './humanResourcesScheduleWarningsService';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

it('uses a request-scoped token and rejects a late former-session response', async () => {
  let resolveRequest;
  let token = 'former-session';
  readSession.mockImplementation(() => ({ token }));
  createPrivateWebApiClient.mockImplementation(({ getAccessToken }) => {
    expect(getAccessToken()).toBe('former-session');
    return { getHumanResourcesScheduleWarnings: () =>
      new Promise(resolve => { resolveRequest = resolve; }) };
  });
  const request = getHumanResourcesScheduleWarnings({ stationId: 'id', from: '2026-08-17',
    to: '2026-08-23', page: 1, limit: 20 });
  token = 'new-session';
  resolveRequest({ warnings: ['private'] });
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(handleUnauthorizedResponse).not.toHaveBeenCalled();
});

it('does not expire a newer session for the former session 401', async () => {
  let rejectRequest;
  let token = 'former-session';
  readSession.mockImplementation(() => ({ token }));
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesScheduleWarnings: () =>
    new Promise((_, reject) => { rejectRequest = reject; }) });
  const request = getHumanResourcesScheduleWarnings({ stationId: 'id', from: '2026-08-17',
    to: '2026-08-23', page: 1, limit: 20 });
  token = 'new-session';
  rejectRequest({ status: 401 });
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(handleUnauthorizedResponse).not.toHaveBeenCalled();
});
