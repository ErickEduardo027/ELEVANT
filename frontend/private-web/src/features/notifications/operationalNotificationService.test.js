import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), expired: vi.fn(), create: vi.fn(), load: vi.fn(), read: vi.fn(),
}));
vi.mock('../../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.create }));
vi.mock('../auth/authService', () => ({ readSession: mocks.session, handleUnauthorizedResponse: mocks.expired }));
import { loadOperationalNotifications, setOperationalNotificationRead } from './operationalNotificationService';

let session;
beforeEach(() => {
  vi.resetAllMocks();
  session = { accountId: 'account-a', token: 'token-a' };
  mocks.session.mockImplementation(() => session);
  mocks.create.mockReturnValue({ getOperationalNotifications: mocks.load, setOperationalNotificationRead: mocks.read });
});

it('ignores an old feed 401 after the account has changed', async () => {
  let reject;
  mocks.load.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const signal = new AbortController().signal;
  const request = loadOperationalNotifications({ signal });
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith({ signal });
  session = { accountId: 'account-b', token: 'token-b' };
  reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(mocks.expired).not.toHaveBeenCalled();
  expect(mocks.create.mock.calls[0][0].getAccessToken()).toBe('token-a');
});

it('preserves the notification read contract and only expires its current credential', async () => {
  const signal = new AbortController().signal;
  mocks.read.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
  await expect(setOperationalNotificationRead('notice-a', true, { signal })).rejects.toMatchObject({ status: 401 });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('notice-a', true, { signal });
  expect(mocks.expired).toHaveBeenCalledExactlyOnceWith({ status: 401 });
});
