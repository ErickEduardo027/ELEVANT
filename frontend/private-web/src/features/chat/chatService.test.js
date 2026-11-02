import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(), expired: vi.fn(), create: vi.fn(),
  conversations: vi.fn(), messages: vi.fn(), send: vi.fn(),
}));
vi.mock('../../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.create }));
vi.mock('../auth/authService', () => ({ readSession: mocks.readSession, handleUnauthorizedResponse: mocks.expired }));
import { readConversations, readMessages, sendMessage } from './chatService';

let session;
beforeEach(() => {
  vi.resetAllMocks();
  session = { accountId: 'account-a', token: 'token-a' };
  mocks.readSession.mockImplementation(() => session);
  mocks.create.mockReturnValue({ getOperationalConversations: mocks.conversations, getOperationalMessages: mocks.messages, sendOperationalMessage: mocks.send });
});

function delayedFailure(method) {
  let reject;
  method.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  return () => reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
}

it('keeps a new account when the previous account receives a late 401', async () => {
  const fail = delayedFailure(mocks.conversations);
  const request = readConversations('station-a');
  session = { accountId: 'account-b', token: 'token-b' };
  expect(mocks.create.mock.calls[0][0].getAccessToken()).toBe('token-a');
  fail();
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(mocks.expired).not.toHaveBeenCalled();
});

it('ignores an earlier token response after the same account signs in again', async () => {
  const fail = delayedFailure(mocks.messages);
  const request = readMessages('operation-a');
  session = { accountId: 'account-a', token: 'token-new' };
  fail();
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(mocks.expired).not.toHaveBeenCalled();
});

it('expires the current session on its own unauthorized response', async () => {
  mocks.messages.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
  await expect(readMessages('operation-a')).rejects.toMatchObject({ status: 401 });
  expect(mocks.expired).toHaveBeenCalledExactlyOnceWith({ status: 401 });
});

it('does not expire a session because a cancelled request finishes with 401', async () => {
  const fail = delayedFailure(mocks.messages);
  const controller = new AbortController();
  const request = readMessages('operation-a', { signal: controller.signal });
  controller.abort();
  fail();
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(mocks.expired).not.toHaveBeenCalled();
});

it('uses the existing POST contract and idempotency key without clearing a replacement session', async () => {
  const fail = delayedFailure(mocks.send);
  const request = sendMessage('operation-a', 'Texto del usuario', 'stable-command-key');
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith('operation-a', { content: 'Texto del usuario' }, 'stable-command-key', undefined, undefined);
  session = { accountId: 'account-b', token: 'token-b' };
  fail();
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(mocks.expired).not.toHaveBeenCalled();
});
