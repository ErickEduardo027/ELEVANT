const mockApi = { reopenRampOperationCorrection: jest.fn() };
const mockContext = jest.fn();
const mockAssigned = jest.fn();
const mockRegisterDevice = jest.fn();
const mockReadCommand = jest.fn();
const mockGetCommand = jest.fn();
const mockRemoveCommand = jest.fn();
const mockRejectSession = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor(status) {
      super(`API ${status}`);
      this.kind = 'http';
      this.status = status;
    }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readRampCorrectionCommandIfCurrent: (...args) => mockReadCommand(...args),
  getOrCreateRampCorrectionCommandIfCurrent: (...args) => mockGetCommand(...args),
  removeRampCorrectionCommandIfCurrent: (...args) => mockRemoveCommand(...args),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => {
  const { MobileServiceError } = jest.requireActual('../src/services/mobile-service-error');
  return {
    getMobileSessionRequestContext: (...args) => mockContext(...args),
    rejectMobileSessionRequest: (...args) => mockRejectSession(...args),
    MobileServiceError,
  };
});
jest.mock('../src/services/assigned-operations', () => ({
  getAssignedOperations: (...args) => mockAssigned(...args),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegisterDevice(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const {
  readPendingRampCorrection,
  reopenRampOperationCorrection,
} = require('../src/services/ramp-operation-correction');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '50000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const CORRECTION = {
  receiptId: '60000000-0000-4000-8000-000000000001',
  operationId: OPERATION_ID,
  previousSubmissionId: '80000000-0000-4000-8000-000000000001',
  checklistId: IDEMPOTENCY_KEY,
  revisionNumber: 2,
  status: 'InProgress',
  returnReason: 'Corrige la cantidad del servicio.',
};

function context(sessionId = SESSION_ID) {
  return {
    sessionId,
    accessToken: 'header.payload.signature',
    session: { actor: { accountId: ACCOUNT_ID } },
  };
}

function assigned(status = 'Returned', source = 'network') {
  return {
    source,
    operations: [{ operation: { id: OPERATION_ID, status },
      review: { status: 'Returned', returnReason: CORRECTION.returnReason } }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue(context());
  mockAssigned.mockResolvedValue(assigned());
  mockReadCommand.mockResolvedValue({ kind: 'current', command: null });
  mockGetCommand.mockResolvedValue({ kind: 'current', idempotencyKey: IDEMPOTENCY_KEY });
  mockRemoveCommand.mockResolvedValue('removed');
  mockRegisterDevice.mockResolvedValue({ installationId: INSTALLATION_ID });
  mockRejectSession.mockResolvedValue(true);
  mockApi.reopenRampOperationCorrection.mockResolvedValue(CORRECTION);
});

test('opens a new correction only after a canonical returned assignment', async () => {
  await expect(reopenRampOperationCorrection(OPERATION_ID)).resolves.toEqual(CORRECTION);
  expect(mockAssigned).toHaveBeenCalledWith({ signal: undefined });
  expect(mockGetCommand).toHaveBeenCalledWith(SESSION_ID, ACCOUNT_ID, OPERATION_ID);
  expect(mockGetCommand.mock.invocationCallOrder[0]).toBeLessThan(
    mockRegisterDevice.mock.invocationCallOrder[0]);
  expect(mockApi.reopenRampOperationCorrection).toHaveBeenCalledWith(
    OPERATION_ID, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
  expect(mockRemoveCommand).toHaveBeenCalledWith(
    SESSION_ID, ACCOUNT_ID, OPERATION_ID, IDEMPOTENCY_KEY);
});

test('does not open from cached or non-returned state', async () => {
  mockAssigned.mockResolvedValueOnce(assigned('Returned', 'cache'));
  await expect(reopenRampOperationCorrection(OPERATION_ID))
    .rejects.toMatchObject({ code: 'conflict' });
  mockAssigned.mockResolvedValueOnce(assigned('PendingReview'));
  await expect(reopenRampOperationCorrection(OPERATION_ID))
    .rejects.toMatchObject({ code: 'conflict' });
  expect(mockGetCommand).not.toHaveBeenCalled();
  expect(mockApi.reopenRampOperationCorrection).not.toHaveBeenCalled();
});

test('replays a reserved key after an uncertain network response', async () => {
  mockReadCommand.mockResolvedValue({ kind: 'current',
    command: { idempotencyKey: IDEMPOTENCY_KEY, payload: '{}' } });
  mockApi.reopenRampOperationCorrection.mockRejectedValueOnce({ mockNetwork: true });
  await expect(reopenRampOperationCorrection(OPERATION_ID))
    .rejects.toMatchObject({ code: 'network_unavailable' });
  expect(mockRemoveCommand).not.toHaveBeenCalled();
  expect(mockAssigned).not.toHaveBeenCalled();
  await expect(readPendingRampCorrection(OPERATION_ID)).resolves.toBe(true);
  await expect(reopenRampOperationCorrection(OPERATION_ID)).resolves.toEqual(CORRECTION);
  expect(mockApi.reopenRampOperationCorrection).toHaveBeenNthCalledWith(
    2, OPERATION_ID, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
});

test('clears a definitely rejected command and expires an unauthorized session', async () => {
  mockApi.reopenRampOperationCorrection.mockRejectedValueOnce(new ElevantApiError(409));
  await expect(reopenRampOperationCorrection(OPERATION_ID))
    .rejects.toMatchObject({ code: 'conflict' });
  expect(mockRemoveCommand).toHaveBeenCalledWith(
    SESSION_ID, ACCOUNT_ID, OPERATION_ID, IDEMPOTENCY_KEY);
  mockApi.reopenRampOperationCorrection.mockRejectedValueOnce(new ElevantApiError(401));
  await expect(reopenRampOperationCorrection(OPERATION_ID))
    .rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
});
