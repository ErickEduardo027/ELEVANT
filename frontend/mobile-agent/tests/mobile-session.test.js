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
  readAssignedOperationsCacheIfCurrent,
  readStoredMobileSession,
  updateStoredMobileSessionMetadata,
  writeAssignedOperationsCacheIfCurrent,
  writeStoredMobileSession,
} = require('../src/storage/mobile-session');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const SecureStore = require('expo-secure-store');

const ACCOUNT_A = '20000000-0000-4000-8000-000000000001';
const ACCOUNT_B = '20000000-0000-4000-8000-000000000002';
const CREDENTIAL_KEY = 'elevant.mobile.session-credential.v1';
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
