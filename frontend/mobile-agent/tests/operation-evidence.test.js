const mockValues = new Map();
const mockCopyAsync = jest.fn(async () => undefined);
const mockDeleteAsync = jest.fn(async () => undefined);
const mockMakeDirectoryAsync = jest.fn(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async key => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key, value) => mockValues.set(key, value)),
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  copyAsync: mockCopyAsync,
  deleteAsync: mockDeleteAsync,
  makeDirectoryAsync: mockMakeDirectoryAsync,
}));
jest.mock('../src/storage/mobile-session', () => ({
  readStoredMobileSession: jest.fn(async () => ({
    kind: 'active',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    metadata: { actor: { accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } },
  })),
}));

const {
  importEvidencePhoto,
  readOperationEvidence,
  removeEvidencePhoto,
  saveOperationEvidence,
} = require('../src/storage/operation-evidence');

const operationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(() => {
  mockValues.clear();
  jest.clearAllMocks();
});

test('stores evidence by account and operation without embedding photo bytes', async () => {
  const photo = await importEvidencePhoto(operationId, 'file:///camera/photo.jpg');
  await saveOperationEvidence(operationId, {
    responsibleName: 'María Pérez',
    bridgeKeyDelivered: true,
    observations: 'Entrega conforme.',
    signaturePaths: ['M 1 1 L 4 4'],
    photos: [photo],
  });

  expect(mockCopyAsync).toHaveBeenCalledWith(expect.objectContaining({
    from: 'file:///camera/photo.jpg',
  }));
  const stored = [...mockValues.values()][0];
  expect(stored).not.toContain('base64');
  await expect(readOperationEvidence(operationId)).resolves.toMatchObject({
    responsibleName: 'María Pérez',
    bridgeKeyDelivered: true,
    signaturePaths: ['M 1 1 L 4 4'],
    photos: [expect.objectContaining({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })],
  });
});

test('removes a local photo idempotently', async () => {
  await removeEvidencePhoto({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    localUri: 'file:///documents/evidence/photo.jpg',
    createdAt: new Date().toISOString(),
  });
  expect(mockDeleteAsync).toHaveBeenCalledWith(
    'file:///documents/evidence/photo.jpg',
    { idempotent: true },
  );
});
