const mockData = new Map();
let mockSession = {
  kind: 'active', sessionId: '30000000-0000-4000-8000-000000000001',
  metadata: { actor: { accountId: '20000000-0000-4000-8000-000000000001' } },
};
const mockStorage = {
  getAllKeys: jest.fn(async () => [...mockData.keys()]),
  getItem: jest.fn(async key => mockData.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockData.set(key, value); }),
  removeItem: jest.fn(async key => { mockData.delete(key); }),
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: mockStorage,
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '82000000-0000-4000-8000-000000000001'),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readStoredMobileSession: jest.fn(async () => mockSession),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {
    constructor() { super('Mobile session storage is unavailable.'); }
  },
}));

const {
  readPendingAttendanceDraft, reservePendingAttendanceDraft,
  clearPendingAttendanceDraft,
} = require('../src/storage/attendance-draft');
const operationId = '70000000-0000-4000-8000-000000000005';
const assignmentId = '70000000-0000-4000-8000-000000000006';
const request = { expectedRevision: 0, observedStartAt: null,
  observedEndAt: null, incidentNote: 'Observado' };

beforeEach(() => {
  mockData.clear();
  jest.clearAllMocks();
  mockSession = { kind: 'active', sessionId: '30000000-0000-4000-8000-000000000001',
    metadata: { actor: { accountId: '20000000-0000-4000-8000-000000000001' } } };
});

test('reserves one immutable key and body across retries', async () => {
  const first = await reservePendingAttendanceDraft(operationId, assignmentId, request);
  const second = await reservePendingAttendanceDraft(operationId, assignmentId, request);
  expect(second).toEqual(first);
  expect(first).toEqual({ idempotencyKey: '82000000-0000-4000-8000-000000000001', request });
  expect(await readPendingAttendanceDraft(operationId, assignmentId)).toEqual(first);
  expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
});

test('freezes the reserved body independently of later caller edits', async () => {
  const mutable = { ...request };
  const first = await reservePendingAttendanceDraft(operationId, assignmentId, mutable);
  mutable.incidentNote = 'Editado después de reservar';
  expect(first.request.incidentNote).toBe('Observado');
  expect((await readPendingAttendanceDraft(operationId, assignmentId)).request.incidentNote)
    .toBe('Observado');
});

test('never exposes the command to another account', async () => {
  await reservePendingAttendanceDraft(operationId, assignmentId, request);
  mockSession = { ...mockSession, sessionId: '30000000-0000-4000-8000-000000000002',
    metadata: { actor: { accountId: '20000000-0000-4000-8000-000000000002' } } };
  expect(await readPendingAttendanceDraft(operationId, assignmentId)).toBeNull();
  expect(mockData.size).toBe(1);
});

test('a new session of the same account takes the unsent command with its first key and body (3-N12)', async () => {
  const first = await reservePendingAttendanceDraft(operationId, assignmentId, request);
  // Signed out (or revoked) and signed in again: the observation the agent typed is still offered for a retry.
  mockSession = { ...mockSession, sessionId: '30000000-0000-4000-8000-000000000002' };
  expect(await readPendingAttendanceDraft(operationId, assignmentId)).toEqual(first);
  expect([...mockData.keys()]).toEqual([
    `elevant:mobile:attendance-draft-pending:v1:30000000-0000-4000-8000-000000000002:20000000-0000-4000-8000-000000000001:${operationId}:${assignmentId}`,
  ]);
  expect(await reservePendingAttendanceDraft(operationId, assignmentId, { ...request, incidentNote: 'Otra' })).toEqual(first);
  expect(await clearPendingAttendanceDraft(operationId, assignmentId, first.idempotencyKey)).toBe(true);
  expect(mockData.size).toBe(0);
});

test('clears only the confirmed matching key', async () => {
  await reservePendingAttendanceDraft(operationId, assignmentId, request);
  expect(await clearPendingAttendanceDraft(operationId, assignmentId,
    '82000000-0000-4000-8000-000000000002')).toBe(false);
  expect(await readPendingAttendanceDraft(operationId, assignmentId)).not.toBeNull();
  expect(await clearPendingAttendanceDraft(operationId, assignmentId,
    '82000000-0000-4000-8000-000000000001')).toBe(true);
  expect(await readPendingAttendanceDraft(operationId, assignmentId)).toBeNull();
});

test('rejects corrupt local command instead of reusing its key or logging its note', async () => {
  await reservePendingAttendanceDraft(operationId, assignmentId, request);
  const storedKey = [...mockData.keys()][0];
  mockData.set(storedKey, '{"idempotencyKey":"bad","request":{"incidentNote":"private"}}');
  await expect(readPendingAttendanceDraft(operationId, assignmentId))
    .rejects.toThrow('Mobile session storage is unavailable.');
  expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
});

test('fails safely when storage cannot be read', async () => {
  mockStorage.getItem.mockRejectedValueOnce(new Error('raw hardware detail'));
  await expect(readPendingAttendanceDraft(operationId, assignmentId))
    .rejects.toThrow('Mobile session storage is unavailable.');
});
