const mockApi = { getOperationalConversations: jest.fn(), getOperationalMessages: jest.fn(),
  getOperationalNotifications: jest.fn(), setOperationalNotificationRead: jest.fn(),
  sendOperationalMessage: jest.fn(), markOperationalConversationRead: jest.fn() };
const mockContext = jest.fn();
const mockReject = jest.fn();
const mockReserve = jest.fn();
const mockRead = jest.fn();
const mockClear = jest.fn();
const mockRegister = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ status }) { super(`API ${status}`); this.kind = 'http'; this.status = status; }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('../src/storage/mobile-session', () => ({
  reserveOperationChatCommandIfCurrent: (...args) => mockReserve(...args),
  readOperationChatCommandIfCurrent: (...args) => mockRead(...args),
  clearOperationChatCommandIfCurrent: (...args) => mockClear(...args),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: (...args) => mockReject(...args),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegister(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { sendOperationalMessage, getOperationalMessages, markOperationalConversationRead,
  getOperationalNotifications, setOperationalNotificationRead } = require('../src/services/operational-communication');
const accountId = '20000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000001';
const operationId = '70000000-0000-4000-8000-000000000001';
const installationId = '40000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const message = { operationId, content: 'Puente listo' };

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId, accessToken: 'token', session: { actor: { accountId } } });
  mockReserve.mockResolvedValue({ kind: 'current', command: { idempotencyKey: key, content: message.content } });
  mockRead.mockResolvedValue({ kind: 'current', command: null });
  mockClear.mockResolvedValue('cleared');
  mockRegister.mockResolvedValue({ installationId });
  mockReject.mockResolvedValue(true);
  mockApi.sendOperationalMessage.mockResolvedValue(message);
  mockApi.getOperationalMessages.mockResolvedValue({ operationId, messages: [message], hasMore: false });
  mockApi.getOperationalNotifications.mockResolvedValue({ notifications: [], hasMore: false });
  mockApi.setOperationalNotificationRead.mockResolvedValue({ id: key, readAt: '2026-09-24T10:00:00Z' });
});

test('reserves stable message before device registration and clears after acknowledged send', async () => {
  await expect(sendOperationalMessage(operationId, message.content)).resolves.toEqual(message);
  expect(mockReserve).toHaveBeenCalledWith(sessionId, accountId, operationId, message.content);
  expect(mockApi.sendOperationalMessage).toHaveBeenCalledWith(operationId,
    { content: message.content }, key, installationId, { signal: undefined });
  expect(mockClear).toHaveBeenCalledWith(sessionId, accountId, operationId, key);
  expect(mockReserve.mock.invocationCallOrder[0]).toBeLessThan(mockRegister.mock.invocationCallOrder[0]);
  expect(mockRegister.mock.invocationCallOrder[0]).toBeLessThan(mockApi.sendOperationalMessage.mock.invocationCallOrder[0]);
});

test('keeps reserved key on unknown network outcome for exact retry', async () => {
  mockApi.sendOperationalMessage.mockRejectedValueOnce(new Error('unknown outcome'));
  await expect(sendOperationalMessage(operationId, message.content)).rejects.toMatchObject({ code: 'request_failed' });
  expect(mockClear).not.toHaveBeenCalled();
  await expect(sendOperationalMessage(operationId, 'different draft')).resolves.toEqual(message);
  expect(mockApi.sendOperationalMessage.mock.calls[1][2]).toBe(key);
  expect(mockApi.sendOperationalMessage.mock.calls[1][1]).toEqual({ content: message.content });
});

test('reads messages and notifications through the authenticated API and clears a rejected session', async () => {
  await expect(getOperationalMessages(operationId)).resolves.toMatchObject({ messages: [message] });
  await expect(getOperationalNotifications()).resolves.toMatchObject({ notifications: [] });
  await expect(setOperationalNotificationRead(key, true)).resolves.toMatchObject({ id: key });
  mockApi.getOperationalMessages.mockRejectedValueOnce(new ElevantApiError({ status: 401 }));
  await expect(getOperationalMessages(operationId)).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockReject).toHaveBeenCalledWith(sessionId);
});

test('moves the read cursor through the authenticated API', async () => {
  mockApi.markOperationalConversationRead.mockResolvedValue(undefined);
  await expect(markOperationalConversationRead(operationId, key)).resolves.toBeUndefined();
  expect(mockApi.markOperationalConversationRead).toHaveBeenCalledWith(operationId, key, { signal: undefined });
  mockApi.markOperationalConversationRead.mockRejectedValueOnce(new ElevantApiError({ status: 401 }));
  await expect(markOperationalConversationRead(operationId, key)).rejects.toMatchObject({ code: 'unauthenticated' });
});
