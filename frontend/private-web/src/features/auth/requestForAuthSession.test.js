import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn() }));
vi.mock('../../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.create, setAccessTokenRenewer: vi.fn() }));
import { requestForAuthSession } from './requestForAuthSession';
import { AUTH_EXPIRED_EVENT, AUTH_STORAGE_KEY, clearSession, readSession } from './authService';

const account = (id, token) => ({ accountId: id, token, email: `${id}@example.test`, name: 'Session QA', role: 'ADMIN_OCC', expiresAt: '2099-01-01T00:00:00Z' });
beforeEach(() => {
  clearSession();
  vi.resetAllMocks();
  mocks.create.mockReturnValue({ getOperationalMessages: mocks.read });
});
afterEach(() => clearSession());

it.each(['localStorage', 'sessionStorage'])('keeps actual %s credentials after an older account receives 401', async storageName => {
  const storage = window[storageName];
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account('account-a', 'token-a')));
  let reject;
  mocks.read.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const request = requestForAuthSession(client => client.getOperationalMessages('operation-a'));
  const replacement = account('account-b', 'token-b');
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(replacement));
  reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(JSON.parse(storage.getItem(AUTH_STORAGE_KEY))).toEqual(replacement);
  expect(readSession()).toMatchObject(replacement);
});

it('keeps automatic expiration for the credential that received 401 without a manual confirmation', async () => {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(account('account-a', 'token-a')));
  const expired = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, expired);
  try {
    mocks.read.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
    await expect(requestForAuthSession(client => client.getOperationalMessages('operation-a'))).rejects.toMatchObject({ status: 401 });
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }
});
