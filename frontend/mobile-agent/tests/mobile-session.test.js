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
  clearStoredMobileSessionIfCurrent,
  countPendingEvidence,
  getOrCreateRampChecklistSubmitCommandIfCurrent,
  getOrCreateRampServiceTransitionCommandIfCurrent,
  getOrCreateRampOperationSubmitCommandIfCurrent,
  getOrCreateRampStartCommandIfCurrent,
  reserveOperationChatCommandIfCurrent,
  readOperationChatCommandIfCurrent,
  clearOperationChatCommandIfCurrent,
  readRampChecklistDraftIfCurrent,
  readRampChecklistSubmitCommandIfCurrent,
  readRampIncidentOutboxIfCurrent,
  readRampOperationSubmitCommandIfCurrent,
  readOrCreateMobileInstallationId,
  readAssignedOperationsCacheIfCurrent,
  readStoredMobileSession,
  replaceStoredMobileCredentialIfCurrent,
  updateStoredMobileSessionMetadata,
  writeRampChecklistDraftIfCurrent,
  reserveRampIncidentOutboxItemIfCurrent,
  removeRampOperationSubmitCommandIfCurrent,
  updateRampIncidentOutboxItemIfCurrent,
  writeAssignedOperationsCacheIfCurrent,
  writeRampChecklistCacheIfCurrent,
  writeRampOperationChargesCacheIfCurrent,
  writeStoredMobileSession,
} = require('../src/storage/mobile-session');
const { observeServerDate, resetServerClockForTests } = require('../src/synchronization/server-clock');
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

const inMinutes = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
// Refresh tokens are 32 random bytes in Base64URL (ADR-0021): 43 characters.
const refreshToken = letter => `refresh-${letter}-${letter.repeat(33)}`;
const REFRESH_A = refreshToken('a');
const REFRESH_A2 = refreshToken('b');
const REFRESH_B = refreshToken('c');
// The size of a real access token: header, claims (sub, jti, sv, auth_time, aud, exp, iat, iss, nbf) and signature.
const accessToken = name => `eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9.${name}${'x'.repeat(620)}.${'s'.repeat(43)}`;

beforeEach(() => {
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  resetServerClockForTests();
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
    schemaVersion: 2,
    sessionId: '10000000-0000-4000-8000-000000000001',
    accessToken: token,
    refreshToken: null,
  });
  expect(metadataRaw).not.toContain(token);
  expect(JSON.parse(metadataRaw).metadata).toEqual(largeMetadata);
});

describe('a session that renews itself (S3)', () => {
  test('the v2 envelope keeps the refresh token only in SecureStore and stays under 2048 bytes', async () => {
    const token = accessToken('a');
    const sessionId = await writeStoredMobileSession(token,
      metadata(ACCOUNT_A, { refreshExpiresAt: inMinutes(30 * 24 * 60) }), REFRESH_A);

    const secureRaw = mockSecureData.get(CREDENTIAL_KEY);
    expect(JSON.parse(secureRaw)).toEqual({ schemaVersion: 2, sessionId, accessToken: token, refreshToken: REFRESH_A });
    expect(secureRaw.length).toBeLessThan(2_048);
    expect([...mockAsyncData.values()].some(value => value.includes(REFRESH_A) || value.includes(token))).toBe(false);
  });

  test('an expired access token with a refresh token in force stays active and keeps the caches, by ELEVANT’s clock', async () => {
    const sessionId = await writeStoredMobileSession('token-a',
      metadata(ACCOUNT_A, { expiresAt: inMinutes(-5), refreshExpiresAt: inMinutes(30 * 24 * 60) }), REFRESH_A);
    const cacheKey = assignedOperationsCacheKey(ACCOUNT_A);
    await expect(writeAssignedOperationsCacheIfCurrent(sessionId, cacheKey, '{"cached":true}')).resolves.toBe('written');
    await writeRampChecklistCacheIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ checklistId: CHECKLIST_A }));

    await expect(readStoredMobileSession()).resolves.toMatchObject({
      kind: 'active', sessionId, accessToken: 'token-a', refreshToken: REFRESH_A,
    });
    expect(mockAsyncData.get(cacheKey)).toBe('{"cached":true}');
    expect([...mockAsyncData.keys()].some(key => key.includes('ramp-checklist-cache'))).toBe(true);

    // ELEVANT's clock decides, not the tablet's: an hour ahead, an access token of ten more minutes already expired.
    expect(observeServerDate(new Date(Date.now() + 60 * 60_000).toUTCString(), Date.now(), Date.now())).toBe(true);
    await clearStoredMobileSession();
    await writeStoredMobileSession('token-b', metadata(ACCOUNT_B, { expiresAt: inMinutes(10) }));
    await expect(readStoredMobileSession()).resolves.toEqual({ kind: 'expired', accountId: ACCOUNT_B });
  });

  test('replacing the credential keeps the revision and the caches, and the secret is written first', async () => {
    const sessionId = await writeStoredMobileSession('token-a',
      metadata(ACCOUNT_A, { refreshExpiresAt: inMinutes(30 * 24 * 60) }), REFRESH_A);
    const cacheKey = assignedOperationsCacheKey(ACCOUNT_A);
    await writeAssignedOperationsCacheIfCurrent(sessionId, cacheKey, '{"cached":true}');
    await writeRampOperationChargesCacheIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ charges: [] }));
    SecureStore.setItemAsync.mockClear();
    AsyncStorage.setItem.mockClear();

    const renewed = metadata(ACCOUNT_A, { expiresAt: inMinutes(15), refreshExpiresAt: inMinutes(30 * 24 * 60) });
    await expect(replaceStoredMobileCredentialIfCurrent(sessionId, 'token-a', 'token-a2', REFRESH_A2, renewed))
      .resolves.toBe(true);

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync.mock.invocationCallOrder[0])
      .toBeLessThan(AsyncStorage.setItem.mock.invocationCallOrder[0]);
    await expect(readStoredMobileSession()).resolves.toEqual({
      kind: 'active', sessionId, accessToken: 'token-a2', refreshToken: REFRESH_A2, metadata: renewed,
    });
    expect(mockAsyncData.get(cacheKey)).toBe('{"cached":true}');
    expect([...mockAsyncData.keys()].some(key => key.includes('ramp-operation-charges'))).toBe(true);
    await expect(writeAssignedOperationsCacheIfCurrent(sessionId, cacheKey, '{"next":true}')).resolves.toBe('written');
  });

  test('a late renewal never overwrites another credential nor another account', async () => {
    const renewedA = metadata(ACCOUNT_A, { refreshExpiresAt: inMinutes(30 * 24 * 60) });
    const sessionA = await writeStoredMobileSession('token-a', renewedA, REFRESH_A);
    await expect(replaceStoredMobileCredentialIfCurrent(sessionA, 'token-a', 'token-a2', REFRESH_A2, renewedA))
      .resolves.toBe(true);
    // An answer to the earlier credential arrives after that one was replaced.
    await expect(replaceStoredMobileCredentialIfCurrent(sessionA, 'token-a', 'token-a3', refreshToken('d'), renewedA))
      .resolves.toBe(false);
    await expect(readStoredMobileSession()).resolves.toMatchObject({ accessToken: 'token-a2', refreshToken: REFRESH_A2 });

    // Another agent signed in on the tablet meanwhile.
    await clearStoredMobileSession();
    const sessionB = await writeStoredMobileSession('token-b',
      metadata(ACCOUNT_B, { refreshExpiresAt: inMinutes(30 * 24 * 60) }), REFRESH_B);
    await expect(replaceStoredMobileCredentialIfCurrent(sessionA, 'token-a2', 'token-a4', refreshToken('e'), renewedA))
      .resolves.toBe(false);
    // A renewal that names another account never takes the place of this one.
    await expect(replaceStoredMobileCredentialIfCurrent(sessionB, 'token-b', 'token-x', refreshToken('f'), renewedA))
      .resolves.toBe(false);
    await expect(readStoredMobileSession()).resolves.toMatchObject({
      kind: 'active', sessionId: sessionB, accessToken: 'token-b', refreshToken: REFRESH_B,
    });
  });

  test('still reads the credential the deployed APK stored (v1)', async () => {
    const sessionId = '30000000-0000-4000-8000-000000000009';
    mockSecureData.set(CREDENTIAL_KEY, JSON.stringify({ schemaVersion: 1, sessionId, accessToken: 'token-v1' }));
    mockAsyncData.set(METADATA_KEY, JSON.stringify({ schemaVersion: 1, sessionId,
      metadata: { schemaVersion: 1, actor: { accountId: ACCOUNT_A }, expiresAt: inMinutes(10) } }));

    await expect(readStoredMobileSession()).resolves.toMatchObject({
      kind: 'active', sessionId, accessToken: 'token-v1', refreshToken: null,
    });
  });

  test('when another account signs in, the refresh token of the earlier one is gone', async () => {
    await writeStoredMobileSession('token-a', metadata(ACCOUNT_A, { refreshExpiresAt: inMinutes(30 * 24 * 60) }),
      REFRESH_A);
    expect(mockSecureData.get(CREDENTIAL_KEY)).toContain(REFRESH_A);

    await writeStoredMobileSession('token-b', metadata(ACCOUNT_B));
    expect([...mockSecureData.values(), ...mockAsyncData.values()].some(value => value.includes(REFRESH_A))).toBe(false);
    await expect(readStoredMobileSession()).resolves.toMatchObject({ accessToken: 'token-b', refreshToken: null });
  });
});

test('keeps one account-scoped chat command stable across retries and for the same account after logout (3-N12)', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const first = await reserveOperationChatCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, ' Puente listo ');
  expect(first).toMatchObject({ kind: 'current', command: { content: 'Puente listo' } });
  const retry = await reserveOperationChatCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, 'texto distinto');
  expect(retry).toEqual(first);
  expect(await readOperationChatCommandIfCurrent(sessionId, ACCOUNT_B, OPERATION_A))
    .toEqual({ kind: 'not-current' });
  expect(await clearOperationChatCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A,
    first.command.idempotencyKey)).toBe('cleared');
  expect(await readOperationChatCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A))
    .toEqual({ kind: 'current', command: null });
  const kept = await reserveOperationChatCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, 'Otro mensaje');
  await clearStoredMobileSession();
  expect([...mockAsyncData.keys()].some(key => key.startsWith('elevant:mobile:operation-chat-command:v1:'))).toBe(true);
  const otherSession = await writeStoredMobileSession('token-b', metadata(ACCOUNT_B));
  await expect(readOperationChatCommandIfCurrent(otherSession, ACCOUNT_B, OPERATION_A))
    .resolves.toEqual({ kind: 'current', command: null });
  await clearStoredMobileSession();
  const nextSession = await writeStoredMobileSession('token-a-next', metadata(ACCOUNT_A));
  await expect(readOperationChatCommandIfCurrent(nextSession, ACCOUNT_A, OPERATION_A)).resolves.toEqual(kept);
});

test('keeps pending attendance observations of the account on logout (3-N12)', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const key = `elevant:mobile:attendance-draft-pending:v1:${sessionId}:${ACCOUNT_A}:${OPERATION_A}:${CHECKLIST_A}`;
  mockAsyncData.set(key, JSON.stringify({ schemaVersion: 1,
    idempotencyKey: '82000000-0000-4000-8000-000000000001',
    request: { expectedRevision: 0, incidentNote: 'Observación privada' },
  }));
  await clearStoredMobileSession();
  expect(mockAsyncData.has(key)).toBe(true);
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

test('reuses a start idempotency key per account and operation, also after the same account signs in again', async () => {
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
  // 3-N12: the reservation outlives the session, so a start that may have reached ELEVANT keeps its key.
  await expect(
    getOrCreateRampStartCommandIfCurrent(
      nextSessionId,
      ACCOUNT_A,
      OPERATION_A,
    ),
  ).resolves.toEqual(first);
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
  // 3-N12: the unsent report stays on the device until the same account signs in and sends it.
  expect([...mockAsyncData.keys()].some(key => key.includes('ramp-incident-outbox'))).toBe(true);
  const nextSessionId = await writeStoredMobileSession('token-a-next', metadata(ACCOUNT_A));
  await expect(readRampIncidentOutboxIfCurrent(nextSessionId, ACCOUNT_A, OPERATION_A))
    .resolves.toEqual({ kind: 'current', items: removed.items });
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

test('freezes one operation handoff per account and keeps it after logout (3-N12)', async () => {
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
  expect([...mockAsyncData.keys()].some(key => key.includes('ramp-operation-submit'))).toBe(true);
  const nextSessionId = await writeStoredMobileSession('token-a-next', metadata(ACCOUNT_A));
  await expect(readRampOperationSubmitCommandIfCurrent(nextSessionId, ACCOUNT_A, OPERATION_A))
    .resolves.toMatchObject({ kind: 'current', command: { idempotencyKey: first.idempotencyKey } });
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

test('uses one frozen service command per target status; logout keeps it and drops the caches (3-N12)', async () => {
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
  await writeRampOperationChargesCacheIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ charges: [] }));
  await writeRampChecklistCacheIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ checklistId: CHECKLIST_A }));

  await clearStoredMobileSession();
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-checklist-cache') || key.includes('ramp-operation-charges')),
  ).toBe(false);
  expect(
    [...mockAsyncData.keys()].filter(key => key.includes('ramp-service-transition')),
  ).toHaveLength(2);
});

test('keeps the unsent execution data of an expired session and drops its caches (3-N12)', async () => {
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
  await writeRampOperationChargesCacheIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ charges: [] }));

  const metadataEnvelope = JSON.parse(mockAsyncData.get(METADATA_KEY));
  metadataEnvelope.metadata.expiresAt = new Date(Date.now() - 1_000).toISOString();
  mockAsyncData.set(METADATA_KEY, JSON.stringify(metadataEnvelope));

  await expect(readStoredMobileSession()).resolves.toEqual({
    kind: 'expired',
    accountId: ACCOUNT_A,
  });
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-operation-charges')),
  ).toBe(false);
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-checklist-draft')),
  ).toBe(true);
  expect(
    [...mockAsyncData.keys()].some(key => key.includes('ramp-service-transition')),
  ).toBe(true);
});

test('a revoked session keeps every unsent record bound to its account; only that account counts it as its own (3-N12)', async () => {
  const sessionId = await writeStoredMobileSession('token-a', metadata(ACCOUNT_A));
  const queued = key => ({ idempotencyKey: key, command: { kind: 'milestone', operationId: OPERATION_A,
    code: 'BLOCK_ON', occurredAt: '2026-11-07T20:00:00.000Z' }, createdAt: '2026-11-07T20:00:00.000Z', state: 'pending',
    attempts: 0 });
  mockAsyncData.set(`elevant.flightReportOutbox.v1.${ACCOUNT_A}`, JSON.stringify([
    queued('91000000-0000-4000-8000-000000000001'), { ...queued('91000000-0000-4000-8000-000000000002'), state: 'blocked' }]));
  await reserveRampIncidentOutboxItemIfCurrent(sessionId, ACCOUNT_A, OPERATION_A,
    JSON.stringify({ incidentType: 'Safety', severity: 'High', description: 'Derrame de combustible', occurredAt: '2026-11-07T20:00:00Z' }));
  await getOrCreateRampServiceTransitionCommandIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, SERVICE_A, 'Completed',
    JSON.stringify({ targetStatus: 'Completed', executedQuantity: 1 }));
  mockAsyncData.set(`elevant:mobile:attendance-draft-pending:v1:${sessionId}:${ACCOUNT_A}:${OPERATION_A}:${CHECKLIST_A}`,
    JSON.stringify({ schemaVersion: 1, idempotencyKey: '82000000-0000-4000-8000-000000000001',
      request: { expectedRevision: 0, incidentNote: 'Llegué tarde por el puente' } }));
  // A draft is not a record sent anywhere: it is kept but not counted.
  await writeRampChecklistDraftIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, CHECKLIST_A, JSON.stringify({ answers: {} }));
  await writeRampOperationChargesCacheIfCurrent(sessionId, ACCOUNT_A, OPERATION_A, JSON.stringify({ charges: [] }));
  await expect(countPendingEvidence()).resolves.toEqual({ current: 5, others: 0 });

  // ELEVANT answers 401: the credential, its metadata and the caches go; what the agent recorded stays.
  await expect(clearStoredMobileSessionIfCurrent(sessionId)).resolves.toBe(true);
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
  expect(mockAsyncData.has(METADATA_KEY)).toBe(false);
  expect([...mockAsyncData.keys()].some(key => key.includes('ramp-operation-charges'))).toBe(false);
  await expect(countPendingEvidence()).resolves.toEqual({ current: 0, others: 5 });

  // Another agent on the same tablet neither reads nor counts them as its own.
  const otherSession = await writeStoredMobileSession('token-b', metadata(ACCOUNT_B));
  await expect(readRampIncidentOutboxIfCurrent(otherSession, ACCOUNT_B, OPERATION_A))
    .resolves.toEqual({ kind: 'current', items: [] });
  mockAsyncData.set(`elevant.flightReportOutbox.v1.${ACCOUNT_B}`, JSON.stringify([queued('91000000-0000-4000-8000-000000000003')]));
  await expect(countPendingEvidence()).resolves.toEqual({ current: 1, others: 5 });
  await clearStoredMobileSession();

  // The same account signs in again and finds its records.
  const nextSession = await writeStoredMobileSession('token-a-next', metadata(ACCOUNT_A));
  await expect(countPendingEvidence()).resolves.toEqual({ current: 5, others: 1 });
  await expect(readRampIncidentOutboxIfCurrent(nextSession, ACCOUNT_A, OPERATION_A))
    .resolves.toMatchObject({ kind: 'current', items: [{ state: 'pending' }] });
  await expect(readRampChecklistDraftIfCurrent(nextSession, ACCOUNT_A, OPERATION_A, CHECKLIST_A))
    .resolves.toEqual({ kind: 'current', value: JSON.stringify({ answers: {} }) });
});
