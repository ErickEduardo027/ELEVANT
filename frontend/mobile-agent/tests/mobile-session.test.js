const mockAsyncData = new Map();
const mockSecureData = new Map();
let mockUuidCounter = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockAsyncData.keys()]),
    getItem: jest.fn(async key => mockAsyncData.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      mockAsyncData.set(key, value);
    }),
    removeItem: jest.fn(async key => {
      mockAsyncData.delete(key);
    }),
    multiRemove: jest.fn(async keys => {
      keys.forEach(key => mockAsyncData.delete(key));
    }),
  },
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async key => mockSecureData.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => {
    mockSecureData.set(key, value);
  }),
  deleteItemAsync: jest.fn(async key => {
    mockSecureData.delete(key);
  }),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    mockUuidCounter += 1;
    return `10000000-0000-4000-8000-${String(mockUuidCounter).padStart(12, '0')}`;
  }),
}));

const {
  assignedOperationsCacheKey,
  clearStoredMobileSession,
  getOrCreateRampChecklistSubmitCommandIfCurrent,
  getOrCreateRampServiceTransitionCommandIfCurrent,
  getOrCreateRampOperationSubmitCommandIfCurrent,
  getOrCreateRampStartCommandIfCurrent,
  readRampChecklistDraftIfCurrent,
  readRampChecklistSubmitCommandIfCurrent,
  readRampIncidentOutboxIfCurrent,
  readRampOperationSubmitCommandIfCurrent,
  readOrCreateMobileInstallationId,
  readAssignedOperationsCacheIfCurrent,
  readStoredMobileSession,
  updateStoredMobileSessionMetadata,
  writeRampChecklistDraftIfCurrent,
  reserveRampIncidentOutboxItemIfCurrent,
  removeRampOperationSubmitCommandIfCurrent,
  updateRampIncidentOutboxItemIfCurrent,
  writeAssignedOperationsCacheIfCurrent,
  writeStoredMobileSession,
} = require('../src/storage/mobile-session');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const SecureStore = require('expo-secure-store');

const ACCOUNT_A = '20000000-0000-4000-8000-000000000001';
const ACCOUNT_B = '20000000-0000-4000-8000-000000000002';
const OPERATION_A = '70000000-0000-4000-8000-000000000001';
const OPERATION_B = '70000000-0000-4000-8000-000000000002';
const CHECKLIST_A = '71000000-0000-4000-8000-000000000001';
const SERVICE_A = '72000000-0000-4000-8000-000000000001';
const CREDENTIAL_KEY = 'elevant.mobile.session-credential.v1';
const INSTALLATION_ID_KEY = 'elevant.mobile.installation-id.v1';
const METADATA_KEY = 'elevant:mobile:session-metadata:v1';

function metadata(accountId, extra = {}) {
  return {
    actor: { accountId },
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    ...extra,
  };
}

beforeEach(() => {
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
});

test('keeps only the compact credential envelope in SecureStore', async () => {
  const token = 'header.payload.signature';
  const largeMetadata = metadata(ACCOUNT_A, { padding: 'x'.repeat(10_000) });

  await writeStoredMobileSession(token, largeMetadata);

  const secureRaw = mockSecureData.get(CREDENTIAL_KEY);
  const metadataRaw = mockAsyncData.get(METADATA_KEY);
  expect(secureRaw).toBeDefined();
  expect(secureRaw.length).toBeLessThan(2_048);
  expect(JSON.parse(secureRaw)).toEqual({
    schemaVersion: 1,
    sessionId: '10000000-0000-4000-8000-000000000001',
    accessToken: token,
  });
  expect(metadataRaw).not.toContain(token);
  expect(JSON.parse(metadataRaw).metadata).toEqual(largeMetadata);
});

test('prevents an old request from repopulating cache after account change', async () => {
  const oldSessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const oldCacheKey = assignedOperationsCacheKey(ACCOUNT_A);

  await clearStoredMobileSession();
  await writeStoredMobileSession('token-b', metadata(ACCOUNT_B));

  await expect(
    writeAssignedOperationsCacheIfCurrent(oldSessionId, oldCacheKey, '{"old":true}'),
  ).resolves.toBe('not-current');
  expect(mockAsyncData.has(oldCacheKey)).toBe(false);
});

test('rotates authorization revision and invalidates its cache on refresh', async () => {
  const oldSessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const cacheKey = assignedOperationsCacheKey(ACCOUNT_A);
  await expect(
    writeAssignedOperationsCacheIfCurrent(oldSessionId, cacheKey, '{"current":true}'),
  ).resolves.toBe('written');

  const nextSessionId = await updateStoredMobileSessionMetadata(
    metadata(ACCOUNT_A, { authorizationVersion: 2 }),
    oldSessionId,
  );

  expect(nextSessionId).toBe('10000000-0000-4000-8000-000000000002');
  expect(nextSessionId).not.toBe(oldSessionId);
  expect(mockAsyncData.has(cacheKey)).toBe(false);
  await expect(
    writeAssignedOperationsCacheIfCurrent(oldSessionId, cacheKey, '{"old":true}'),
  ).resolves.toBe('not-current');
  await expect(
    writeAssignedOperationsCacheIfCurrent(nextSessionId, cacheKey, '{"new":true}'),
  ).resolves.toBe('written');
});

test('fails closed when credential and metadata revisions do not match', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const envelope = JSON.parse(mockAsyncData.get(METADATA_KEY));
  mockAsyncData.set(
    METADATA_KEY,
    JSON.stringify({ ...envelope, sessionId: '30000000-0000-4000-8000-000000000003' }),
  );

  await expect(readStoredMobileSession()).resolves.toEqual({ kind: 'missing' });
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
  expect(mockAsyncData.has(METADATA_KEY)).toBe(false);
  await expect(
    readAssignedOperationsCacheIfCurrent(
      sessionId,
      assignedOperationsCacheKey(ACCOUNT_A),
    ),
  ).resolves.toEqual({ kind: 'not-current' });
});

test('removes partial state when secure credential persistence fails', async () => {
  SecureStore.setItemAsync.mockRejectedValueOnce(new Error('secure-store-failed'));

  await expect(
    writeStoredMobileSession('token-a', metadata(ACCOUNT_A)),
  ).rejects.toThrow('Mobile session storage is unavailable.');
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
  expect(mockAsyncData.has(METADATA_KEY)).toBe(false);
});

test('distinguishes optional cache failure from session validation failure', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('cache-write-failed'));

  await expect(
    writeAssignedOperationsCacheIfCurrent(
      sessionId,
      assignedOperationsCacheKey(ACCOUNT_A),
      '{"current":true}',
    ),
  ).resolves.toBe('cache-unavailable');
  await expect(readStoredMobileSession()).resolves.toMatchObject({
    kind: 'active',
    sessionId,
  });
});

test('keeps one installation identity outside the login session lifecycle', async () => {
  const installationId = await readOrCreateMobileInstallationId();
  await expect(readOrCreateMobileInstallationId()).resolves.toBe(installationId);

  await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  await clearStoredMobileSession();

  expect(mockSecureData.get(INSTALLATION_ID_KEY)).toBe(installationId);
  await expect(readOrCreateMobileInstallationId()).resolves.toBe(installationId);
});

test('reuses a start idempotency key per account and operation until logout', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const first = await getOrCreateRampStartCommandIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
  );

  await expect(
    getOrCreateRampStartCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A),
  ).resolves.toEqual(first);
  await expect(
    getOrCreateRampStartCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_B),
  ).resolves.not.toEqual(first);

  await clearStoredMobileSession();
  await expect(
    getOrCreateRampStartCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A),
  ).resolves.toEqual({ kind: 'not-current' });

  const nextSessionId = await writeStoredMobileSession(
    'token-a-next',
    metadata(ACCOUNT_A),
  );
  await expect(
    getOrCreateRampStartCommandIfCurrent(
      nextSessionId,
      ACCOUNT_A,
      OPERATION_A,
    ),
  ).resolves.not.toEqual(first);
});

test('namespaces checklist drafts by account, operation, and checklist', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const draft = JSON.stringify({ answers: { itemA: { result: 'Ok' } } });

  await expect(
    writeRampChecklistDraftIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_A,
      CHECKLIST_A,
      draft,
    ),
  ).resolves.toBe('written');
  await expect(
    readRampChecklistDraftIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_A,
      CHECKLIST_A,
    ),
  ).resolves.toEqual({ kind: 'current', value: draft });
  await expect(
    readRampChecklistDraftIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_B,
      CHECKLIST_A,
    ),
  ).resolves.toEqual({ kind: 'current', value: null });
  await expect(
    readRampChecklistDraftIfCurrent(
      sessionId,
      ACCOUNT_B,
      OPERATION_A,
      CHECKLIST_A,
    ),
  ).resolves.toEqual({ kind: 'not-current' });
});

test('reserves multiple incident reports before network and preserves FIFO keys', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const firstPayload = JSON.stringify({ incidentType: 'Safety', severity: 'High', description: 'Equipo inmovilizado', occurredAt: '2026-09-23T12:00:00Z' });
  const secondPayload = JSON.stringify({ incidentType: 'Equipment', severity: 'Low', description: 'Equipo revisado', occurredAt: '2026-09-23T12:01:00Z' });
  const first = await reserveRampIncidentOutboxItemIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, firstPayload);
  const second = await reserveRampIncidentOutboxItemIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, secondPayload);
  expect(first.kind).toBe('current');
  expect(second.items).toHaveLength(2);
  expect(second.items.map(item => item.payload)).toEqual([firstPayload, secondPayload]);
  expect(second.items[0].idempotencyKey).toBe(first.items[0].idempotencyKey);
  await expect(readRampIncidentOutboxIfCurrent(sessionId, ACCOUNT_A, OPERATION_B))
    .resolves.toEqual({ kind: 'current', items: [] });
  await expect(readRampIncidentOutboxIfCurrent(sessionId, ACCOUNT_B, OPERATION_A))
    .resolves.toEqual({ kind: 'not-current' });

  const blocked = await updateRampIncidentOutboxItemIfCurrent(
    sessionId, ACCOUNT_A, OPERATION_A, first.items[0].idempotencyKey, 'block');
  expect(blocked.items[0].state).toBe('blocked');
  expect(blocked.items[1].state).toBe('pending');
  const removed = await updateRampIncidentOutboxItemIfCurrent(
    sessionId, ACCOUNT_A, OPERATION_A, first.items[0].idempotencyKey, 'remove');
  expect(removed.items).toHaveLength(1);
  expect(removed.items[0].payload).toBe(secondPayload);

  await clearStoredMobileSession();
  await expect(readRampIncidentOutboxIfCurrent(sessionId, ACCOUNT_A, OPERATION_A))
    .resolves.toEqual({ kind: 'not-current' });
  expect([...mockAsyncData.keys()].some(key => key.includes('ramp-incident-outbox'))).toBe(false);
});

test('does not overwrite a malformed incident outbox or lose reserved reports', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const key = `elevant:mobile:ramp-incident-outbox:v1:${ACCOUNT_A}:${OPERATION_A}`;
  mockAsyncData.set(key, '{invalid');
  await expect(reserveRampIncidentOutboxItemIfCurrent(
    sessionId, ACCOUNT_A, OPERATION_A, '{"description":"test report"}',
  )).rejects.toThrow('Mobile session storage is unavailable.');
  expect(mockAsyncData.get(key)).toBe('{invalid');
});

test('freezes one operation handoff per account and scrubs it on logout', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const first = await getOrCreateRampOperationSubmitCommandIfCurrent(
    sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ agentNote: 'Listo' }));
  const second = await getOrCreateRampOperationSubmitCommandIfCurrent(
    sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ agentNote: 'Cambiado' }));
  expect(second).toEqual(first);
  await expect(readRampOperationSubmitCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_B))
    .resolves.toEqual({ kind: 'current', command: null });
  await expect(readRampOperationSubmitCommandIfCurrent(sessionId, ACCOUNT_B, OPERATION_A))
    .resolves.toEqual({ kind: 'not-current' });
  await expect(readRampOperationSubmitCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A))
    .resolves.toMatchObject({ kind: 'current', command: { idempotencyKey: first.idempotencyKey } });
  expect(await removeRampOperationSubmitCommandIfCurrent(
    sessionId, ACCOUNT_A, OPERATION_A, '90000000-0000-4000-8000-000000000001'))
    .toBe('changed');
  await clearStoredMobileSession();
  expect([...mockAsyncData.keys()].some(key => key.includes('ramp-operation-submit'))).toBe(false);
});

test('freezes checklist payload and idempotency key before an uncertain request', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const firstPayload = JSON.stringify({ answers: [{ itemId: SERVICE_A, result: 'Ok' }] });
  const changedPayload = JSON.stringify({ answers: [{ itemId: SERVICE_A, result: 'NotOk', note: 'changed' }] });
  const first = await getOrCreateRampChecklistSubmitCommandIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
    CHECKLIST_A,
    firstPayload,
  );

  await expect(
    getOrCreateRampChecklistSubmitCommandIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_A,
      CHECKLIST_A,
      changedPayload,
    ),
  ).resolves.toEqual(first);
  await expect(
    readRampChecklistSubmitCommandIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_A,
      CHECKLIST_A,
    ),
  ).resolves.toEqual({
    kind: 'current',
    command: {
      idempotencyKey: first.idempotencyKey,
      payload: firstPayload,
    },
  });
});

test('fails closed instead of minting a new key over a corrupt pending command', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  await getOrCreateRampChecklistSubmitCommandIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
    CHECKLIST_A,
    JSON.stringify({ answers: [{ itemId: SERVICE_A, result: 'Ok' }] }),
  );
  const commandKey = [...mockAsyncData.keys()].find(key =>
    key.includes('ramp-checklist-submit-command'),
  );
  mockAsyncData.set(commandKey, '{"schemaVersion":1,"corrupt":true}');

  await expect(
    getOrCreateRampChecklistSubmitCommandIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_A,
      CHECKLIST_A,
      JSON.stringify({ answers: [{ itemId: SERVICE_A, result: 'NotOk' }] }),
    ),
  ).rejects.toThrow('Mobile session storage is unavailable.');
});

test('uses one frozen service command per target status and clears execution data on logout', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const startPayload = JSON.stringify({ targetStatus: 'InProgress' });
  const completePayload = JSON.stringify({ targetStatus: 'Completed', executedQuantity: 2 });
  const start = await getOrCreateRampServiceTransitionCommandIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
    SERVICE_A,
    'InProgress',
    startPayload,
  );
  const complete = await getOrCreateRampServiceTransitionCommandIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
    SERVICE_A,
    'Completed',
    completePayload,
  );

  expect(start).toMatchObject({ kind: 'current', payload: startPayload });
  expect(complete).toMatchObject({ kind: 'current', payload: completePayload });
  expect(complete.idempotencyKey).not.toBe(start.idempotencyKey);
  await expect(
    getOrCreateRampServiceTransitionCommandIfCurrent(
      sessionId,
      ACCOUNT_A,
      OPERATION_A,
      SERVICE_A,
      'InProgress',
      JSON.stringify({ targetStatus: 'InProgress', note: 'changed' }),
    ),
  ).resolves.toEqual(start);

  await clearStoredMobileSession();
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-checklist')),
  ).toBe(false);
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-service-transition')),
  ).toBe(false);
});

test('removes account-scoped execution data when the owning session expires', async () => {
  const sessionId = await writeStoredMobileSession(
    'token-a',
    metadata(ACCOUNT_A),
  );
  await writeRampChecklistDraftIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
    CHECKLIST_A,
    JSON.stringify({ schemaVersion: 1, checklistId: CHECKLIST_A, answers: {} }),
  );
  await getOrCreateRampServiceTransitionCommandIfCurrent(
    sessionId,
    ACCOUNT_A,
    OPERATION_A,
    SERVICE_A,
    'InProgress',
    JSON.stringify({ targetStatus: 'InProgress' }),
  );

  const metadataEnvelope = JSON.parse(mockAsyncData.get(METADATA_KEY));
  metadataEnvelope.metadata.expiresAt = new Date(Date.now() - 1_000).toISOString();
  mockAsyncData.set(METADATA_KEY, JSON.stringify(metadataEnvelope));

  await expect(readStoredMobileSession()).resolves.toEqual({
    kind: 'expired',
    accountId: ACCOUNT_A,
  });
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-checklist')),
  ).toBe(false);
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-service-transition')),
  ).toBe(false);
});
