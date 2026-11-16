import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lease: vi.fn(), client: vi.fn(), read: vi.fn(), put: vi.fn(), start: vi.fn(), close: vi.fn() }));
vi.mock('@elevant/api-client', () => ({ createPresenceLease: mocks.lease }));
vi.mock('../../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.client }));
vi.mock('../auth/authService', () => ({ readSession: mocks.read }));
import { useWebPresence } from './useWebPresence';

const session = { accountId: '10000000-0000-0000-0000-000000000001', role: 'ADMIN_OCC', token: 'synthetic-presence-test-token' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('crypto', { getRandomValues: bytes => { bytes.fill(7); return bytes; } });
  mocks.lease.mockReturnValue({ start: mocks.start, close: mocks.close, flush: vi.fn(), pause: vi.fn(), resume: vi.fn(), activity: vi.fn() });
  mocks.client.mockReturnValue({ putOperationalPresence: mocks.put });
  mocks.read.mockReturnValue(session);
});
afterEach(() => vi.unstubAllGlobals());

it('creates a v4 lease without randomUUID and rejects activity from a superseded account', async () => {
  const { unmount } = renderHook(() => useWebPresence(session, true));
  const options = mocks.lease.mock.calls[0][0];
  expect(options.clientId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(mocks.start).toHaveBeenCalledTimes(1);
  const heartbeat = { clientId: options.clientId, sequence: 1, mode: 'foreground', activityObserved: true };
  await options.write(heartbeat);
  expect(mocks.put).toHaveBeenCalledTimes(1);
  mocks.read.mockReturnValue({ ...session, accountId: '10000000-0000-0000-0000-000000000002', token: 'other-synthetic-token' });
  await expect(options.write({ ...heartbeat, sequence: 2 })).rejects.toMatchObject({ status: 401 });
  expect(mocks.put).toHaveBeenCalledTimes(1);
  await options.write({ ...heartbeat, sequence: 3, mode: 'closed' });
  expect(mocks.put).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'closed' }), { keepalive: true });
  expect(mocks.client.mock.calls[0][0].getAccessToken()).toBe(session.token);
  unmount();
  expect(mocks.close).toHaveBeenCalledTimes(1);
});

it('leaves the application usable when cryptographic randomness is unavailable', () => {
  vi.stubGlobal('crypto', undefined);
  expect(() => renderHook(() => useWebPresence(session, true))).not.toThrow();
  expect(mocks.lease).not.toHaveBeenCalled();
});
