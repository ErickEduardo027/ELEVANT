const mockApi = {
  registerMobileDevice: jest.fn(),
  startRampOperation: jest.fn(),
};
const mockReadOrCreateMobileInstallationId = jest.fn();
const mockGetOrCreateRampStartCommandIfCurrent = jest.fn();
const mockGetMobileSessionRequestContext = jest.fn();
const mockRejectMobileSessionRequest = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind, status, traceId }) {
      super(`Elevant API error ${status}`);
      this.name = 'ElevantApiError';
      this.kind = kind;
      this.status = status;
      this.traceId = traceId;
    }
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(() => false),
}));

jest.mock('../src/storage/mobile-session', () => ({
  getOrCreateRampStartCommandIfCurrent: (...args) =>
    mockGetOrCreateRampStartCommandIfCurrent(...args),
  readOrCreateMobileInstallationId: (...args) =>
    mockReadOrCreateMobileInstallationId(...args),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));

jest.mock('../src/services/mobile-auth', () => {
  const { MobileServiceError } = jest.requireActual(
    '../src/services/mobile-service-error',
  );
  return {
    getMobileSessionRequestContext: (...args) =>
      mockGetMobileSessionRequestContext(...args),
    rejectMobileSessionRequest: (...args) =>
      mockRejectMobileSessionRequest(...args),
    MobileServiceError,
  };
});

const { ElevantApiError } = require('@elevant/api-client');
const { Platform } = require('react-native');
const {
  startAssignedRampOperation,
} = require('../src/services/ramp-operation-start');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '50000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const TEST_PLATFORM = Platform.OS === 'android' ? 'Android' : 'Ios';

function requestContext(overrides = {}) {
  return {
    accessToken: 'header.payload.signature',
    sessionId: SESSION_ID,
    session: { actor: { accountId: ACCOUNT_ID } },
    ...overrides,
  };
}

function startedResponse() {
  return {
    receiptId: '60000000-0000-4000-8000-000000000001',
    operation: {
      id: OPERATION_ID,
      status: 'InProgress',
      plannedStartAt: null,
      plannedEndAt: null,
      actualStartAt: '2026-09-17T18:00:00Z',
      actualEndAt: null,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadOrCreateMobileInstallationId.mockResolvedValue(INSTALLATION_ID);
  mockGetOrCreateRampStartCommandIfCurrent.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
  });
  mockGetMobileSessionRequestContext.mockResolvedValue(requestContext());
  mockRejectMobileSessionRequest.mockResolvedValue(true);
  mockApi.registerMobileDevice.mockResolvedValue({
    installationId: INSTALLATION_ID,
    platform: TEST_PLATFORM,
    appVersion: '1.0.0',
    lastSeenAt: '2026-09-17T18:00:00Z',
  });
  mockApi.startRampOperation.mockResolvedValue(startedResponse());
});

test('reserves the command, registers the installation, and then sends start', async () => {
  await expect(startAssignedRampOperation(OPERATION_ID)).resolves.toEqual(
    startedResponse(),
  );

  expect(mockApi.registerMobileDevice).toHaveBeenCalledWith(
    expect.objectContaining({
      installationId: INSTALLATION_ID,
      appVersion: '1.0.0',
    }),
    { signal: undefined },
  );
  expect(mockGetOrCreateRampStartCommandIfCurrent).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
  );
  expect(mockApi.startRampOperation).toHaveBeenCalledWith(
    OPERATION_ID,
    INSTALLATION_ID,
    IDEMPOTENCY_KEY,
    { signal: undefined },
  );
  expect(
    mockGetOrCreateRampStartCommandIfCurrent.mock.invocationCallOrder[0],
  ).toBeLessThan(mockApi.registerMobileDevice.mock.invocationCallOrder[0]);
  expect(
    mockApi.registerMobileDevice.mock.invocationCallOrder[0],
  ).toBeLessThan(mockApi.startRampOperation.mock.invocationCallOrder[0]);
});

test('does not start when the authenticated session changes after registration', async () => {
  mockGetMobileSessionRequestContext
    .mockResolvedValueOnce(requestContext())
    .mockResolvedValueOnce(
      requestContext({ sessionId: '30000000-0000-4000-8000-000000000002' }),
    );

  await expect(startAssignedRampOperation(OPERATION_ID)).rejects.toMatchObject({
    code: 'cancelled',
  });
  expect(mockApi.startRampOperation).not.toHaveBeenCalled();
});

test('clears only the rejected session after an unauthorized start response', async () => {
  mockApi.startRampOperation.mockRejectedValue(
    new ElevantApiError({ kind: 'http', status: 401 }),
  );

  await expect(startAssignedRampOperation(OPERATION_ID)).rejects.toMatchObject({
    code: 'unauthenticated',
    status: 401,
  });
  expect(mockRejectMobileSessionRequest).toHaveBeenCalledWith(SESSION_ID);
});

test('preserves conflict as a canonical refresh signal without clearing session', async () => {
  mockApi.startRampOperation.mockRejectedValue(
    new ElevantApiError({ kind: 'http', status: 409 }),
  );

  await expect(startAssignedRampOperation(OPERATION_ID)).rejects.toMatchObject({
    code: 'conflict',
    status: 409,
    retryable: false,
  });
  expect(mockRejectMobileSessionRequest).not.toHaveBeenCalled();
});

test('distinguishes a device binding conflict from an operation conflict', async () => {
  mockApi.registerMobileDevice.mockRejectedValue(
    new ElevantApiError({ kind: 'http', status: 409 }),
  );

  await expect(startAssignedRampOperation(OPERATION_ID)).rejects.toMatchObject({
    code: 'device_conflict',
    status: 409,
    retryable: false,
  });
  expect(mockGetOrCreateRampStartCommandIfCurrent).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
  );
  expect(mockApi.startRampOperation).not.toHaveBeenCalled();
  expect(mockRejectMobileSessionRequest).not.toHaveBeenCalled();
});
