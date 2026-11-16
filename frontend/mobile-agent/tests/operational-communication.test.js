// 3-I: a message to OCC travels through the device's queue with its stable key, so a lost answer or a missing signal
// never loses nor doubles it.
const mockStore = new Map();
const mockApi = { getOperationalConversations: jest.fn(), getOperationalMessages: jest.fn(),
  getOperationalNotifications: jest.fn(), setOperationalNotificationRead: jest.fn(),
  sendOperationalMessage: jest.fn(), markOperationalConversationRead: jest.fn() };
const mockContext = jest.fn();
const mockReject = jest.fn();
const mockRegister = jest.fn();
let mockUuid = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async key => { mockStore.delete(key); }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `50000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ status }) { super(`API ${status}`); this.kind = 'http'; this.status = status; }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readLegacyRampCommandsIfCurrent: jest.fn(async () => ({ kind: 'current', commands: [] })),
  removeLegacyRampCommandIfCurrent: jest.fn(),
  removeRampChecklistDraftIfCurrent: jest.fn(),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: jest.fn(), readWalkaroundPhoto: jest.fn(), forgetWalkaroundPhoto: jest.fn(),
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: (...args) => mockReject(...args),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegister(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { resetFlightReportForTests } = require('../src/services/flight-report');
const { sendOperationalMessage, getOperationalMessages, markOperationalConversationRead, readPendingOperationMessages,
  getOperationalNotifications, setOperationalNotificationRead } = require('../src/services/operational-communication');
const accountId = '20000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000001';
const operationId = '70000000-0000-4000-8000-000000000001';
const installationId = '40000000-0000-4000-8000-000000000001';
const key = '50000000-0000-4000-8000-000000000001';
const message = { operationId, content: 'Puente listo' };

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockUuid = 0;
  resetFlightReportForTests();
  mockContext.mockResolvedValue({ sessionId, accessToken: 'token', session: { actor: { accountId } } });
  mockRegister.mockResolvedValue({ installationId });
  mockReject.mockResolvedValue(true);
  mockApi.sendOperationalMessage.mockResolvedValue(message);
  mockApi.getOperationalMessages.mockResolvedValue({ operationId, messages: [message], hasMore: false });
  mockApi.getOperationalNotifications.mockResolvedValue({ notifications: [], hasMore: false });
  mockApi.setOperationalNotificationRead.mockResolvedValue({ id: key, readAt: '2026-09-24T10:00:00Z' });
});

test('saves the message on the device first, registers the installation and sends it with its key', async () => {
  await expect(sendOperationalMessage(operationId, `  ${message.content} `)).resolves.toEqual(message);
  expect(mockApi.sendOperationalMessage).toHaveBeenCalledWith(operationId, { content: message.content }, key,
    installationId);
  expect(mockRegister.mock.invocationCallOrder[0]).toBeLessThan(mockApi.sendOperationalMessage.mock.invocationCallOrder[0]);
  await expect(readPendingOperationMessages(operationId)).resolves.toEqual([]);
});

test('without signal the messages wait in their order and go out with their keys when it returns', async () => {
  mockApi.sendOperationalMessage.mockRejectedValue({ mockNetwork: true });
  await expect(sendOperationalMessage(operationId, 'Puente listo')).resolves.toBeNull();
  await expect(sendOperationalMessage(operationId, 'Equipaje en camino')).resolves.toBeNull();
  const waiting = await readPendingOperationMessages(operationId);
  expect(waiting.map(item => [item.content, item.state])).toEqual([['Puente listo', 'pending'],
    ['Equipaje en camino', 'pending']]);

  mockApi.sendOperationalMessage.mockReset();
  mockApi.sendOperationalMessage.mockResolvedValue(message);
  await expect(sendOperationalMessage(operationId, 'Listos para cerrar')).resolves.toEqual(message);
  expect(mockApi.sendOperationalMessage.mock.calls.map(call => [call[1].content, call[2]])).toEqual([
    ['Puente listo', waiting[0].idempotencyKey], ['Equipaje en camino', waiting[1].idempotencyKey],
    ['Listos para cerrar', '50000000-0000-4000-8000-000000000003']]);
  await expect(readPendingOperationMessages(operationId)).resolves.toEqual([]);
});

test('a message ELEVANT refuses is reported and leaves the queue; an empty one is never saved', async () => {
  mockApi.sendOperationalMessage.mockRejectedValue(new ElevantApiError({ status: 409 }));
  await expect(sendOperationalMessage(operationId, 'Puente listo')).rejects.toMatchObject({ code: 'conflict' });
  await expect(readPendingOperationMessages(operationId)).resolves.toEqual([]);
  await expect(sendOperationalMessage(operationId, '   ')).rejects.toMatchObject({ code: 'request_failed' });
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
