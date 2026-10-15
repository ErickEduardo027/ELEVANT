const mockValues = new Map();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: jest.fn(async key => mockValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => { mockValues.set(key, value); }),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm, value) => `digest:${value.length}`),
}));

const {
  authenticateLocalDevelopmentAgent,
  changeLocalDevelopmentPassword,
  LOCAL_DEVELOPMENT_EMAIL,
  LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD,
} = require('../src/services/local-development-auth');

beforeEach(() => {
  mockValues.clear();
  process.env.EXPO_PUBLIC_ENABLE_LOCAL_AUTH = 'true';
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_ENABLE_LOCAL_AUTH;
});

test('requires activation for the development temporary password', async () => {
  await expect(authenticateLocalDevelopmentAgent(
    LOCAL_DEVELOPMENT_EMAIL,
    LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD,
  )).resolves.toBe('password_change_required');
});

test('stores only a digest and authenticates with the new password', async () => {
  const newPassword = 'NuevaClaveSegura!2026';
  await expect(changeLocalDevelopmentPassword(
    LOCAL_DEVELOPMENT_EMAIL,
    LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD,
    newPassword,
  )).resolves.toBe(true);

  expect([...mockValues.values()]).toHaveLength(1);
  expect([...mockValues.values()][0]).not.toContain(newPassword);
  await expect(authenticateLocalDevelopmentAgent(
    LOCAL_DEVELOPMENT_EMAIL,
    newPassword,
  )).resolves.toBe('authenticated');
  await expect(authenticateLocalDevelopmentAgent(
    LOCAL_DEVELOPMENT_EMAIL,
    'incorrecta',
  )).resolves.toBe('invalid');
});
