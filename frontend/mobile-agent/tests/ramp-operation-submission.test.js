const mockApi = { submitRampOperation: jest.fn() };
const mockContext = jest.fn();
const mockRejectSession = jest.fn();
const mockRegisterDevice = jest.fn();
const mockAssigned = jest.fn();
const mockChecklist = jest.fn();
const mockIncidents = jest.fn();
const mockReadCommand = jest.fn();
const mockGetCommand = jest.fn();
const mockRemoveCommand = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ status }) {
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
  getOrCreateRampOperationSubmitCommandIfCurrent: (...args) => mockGetCommand(...args),
  readRampOperationSubmitCommandIfCurrent: (...args) => mockReadCommand(...args),
  removeRampOperationSubmitCommandIfCurrent: (...args) => mockRemoveCommand(...args),
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
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegisterDevice(...args),
}));
jest.mock('../src/services/assigned-operations', () => ({
  getAssignedOperations: (...args) => mockAssigned(...args),
}));
jest.mock('../src/services/ramp-operation-checklist', () => ({
  getRampOperationChecklist: (...args) => mockChecklist(...args),
}));
jest.mock('../src/services/ramp-incidents', () => ({
  loadRampIncidentCenter: (...args) => mockIncidents(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const {
  readRampOperationPendingSubmission,
  submitRampOperation,
} = require('../src/services/ramp-operation-submission');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '50000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const FROZEN = { agentNote: 'Entrega original' };
const COMMAND = {
  kind: 'current',
  idempotencyKey: IDEMPOTENCY_KEY,
  payload: JSON.stringify(FROZEN),
};

function context(sessionId = SESSION_ID) {
  return {
    sessionId,
    accessToken: 'header.payload.signature',
    session: { actor: { accountId: ACCOUNT_ID } },
  };
}

function assigned(status = 'InProgress', services = [{ status: 'Completed' }]) {
  return {
    source: 'network',
    operations: [{ operation: { id: OPERATION_ID, status }, services }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue(context());
  mockRejectSession.mockResolvedValue(true);
  mockReadCommand.mockResolvedValue({ kind: 'current', command: null });
  mockGetCommand.mockResolvedValue(COMMAND);
  mockRemoveCommand.mockResolvedValue('removed');
  mockRegisterDevice.mockResolvedValue({ installationId: INSTALLATION_ID });
  mockAssigned.mockResolvedValue(assigned());
  mockChecklist.mockResolvedValue({ checklist: { status: 'Submitted' } });
  mockIncidents.mockResolvedValue({ online: true, outbox: [] });
  mockApi.submitRampOperation.mockResolvedValue({
    operationId: OPERATION_ID,
    status: 'PendingReview',
    revisionNumber: 1,
  });
});

test('checks canonical readiness and freezes payload before posting the handoff', async () => {
  await submitRampOperation(OPERATION_ID, FROZEN);
  expect(mockAssigned).toHaveBeenCalledWith({ signal: undefined });
  expect(mockChecklist).toHaveBeenCalledWith(OPERATION_ID, { signal: undefined });
  expect(mockIncidents).toHaveBeenCalledWith(OPERATION_ID, { signal: undefined });
  expect(mockGetCommand).toHaveBeenCalledWith(
    SESSION_ID, ACCOUNT_ID, OPERATION_ID, JSON.stringify(FROZEN));
  expect(mockGetCommand.mock.invocationCallOrder[0]).toBeLessThan(
    mockApi.submitRampOperation.mock.invocationCallOrder[0]);
  expect(mockApi.submitRampOperation).toHaveBeenCalledWith(
    OPERATION_ID, FROZEN, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
  expect(mockRemoveCommand).toHaveBeenCalledWith(
    SESSION_ID, ACCOUNT_ID, OPERATION_ID, IDEMPOTENCY_KEY);
});

test.each([
  ['nonterminal service', assigned('InProgress', [{ status: 'Planned' }])],
  ['non-current operation', assigned('PendingReview')],
  ['cached snapshot', { ...assigned(), source: 'cache' }],
  ['no services', assigned('InProgress', [])],
])('does not reserve a new handoff with %s', async (_description, snapshot) => {
  mockAssigned.mockResolvedValue(snapshot);
  await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict' });
  expect(mockGetCommand).not.toHaveBeenCalled();
  expect(mockApi.submitRampOperation).not.toHaveBeenCalled();
});

test('requires submitted checklist and a drained incident outbox', async () => {
  mockChecklist.mockResolvedValueOnce({ checklist: { status: 'InProgress' } });
  await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict' });
  mockIncidents.mockResolvedValueOnce({ online: true, outbox: [{ state: 'blocked' }] });
  await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict' });
  expect(mockGetCommand).not.toHaveBeenCalled();
});

test('replays an uncertain request with its original body without requiring InProgress again', async () => {
  mockApi.submitRampOperation.mockRejectedValueOnce({ mockNetwork: true, reason: 'offline' });
  await expect(submitRampOperation(OPERATION_ID, FROZEN))
    .rejects.toMatchObject({ code: 'network_unavailable' });
  expect(mockRemoveCommand).not.toHaveBeenCalled();
  mockReadCommand.mockResolvedValue({ kind: 'current', command: COMMAND });
  mockAssigned.mockResolvedValue(assigned('PendingReview'));
  await submitRampOperation(OPERATION_ID, { agentNote: 'Nota cambiada' });
  expect(mockApi.submitRampOperation).toHaveBeenLastCalledWith(
    OPERATION_ID, FROZEN, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
  expect(mockAssigned).toHaveBeenCalledTimes(1);
});

test('does not overwrite a corrupt frozen command', async () => {
  mockReadCommand.mockResolvedValue({ kind: 'current', command: {
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: '{invalid',
  } });
  await expect(readRampOperationPendingSubmission(OPERATION_ID))
    .rejects.toMatchObject({ code: 'storage_unavailable' });
  expect(mockRemoveCommand).not.toHaveBeenCalled();
});

test('drops a deterministically rejected command but preserves ambiguous failures', async () => {
  mockApi.submitRampOperation.mockRejectedValueOnce(new ElevantApiError({ status: 409 }));
  await expect(submitRampOperation(OPERATION_ID, FROZEN))
    .rejects.toMatchObject({ code: 'conflict' });
  expect(mockRemoveCommand).toHaveBeenCalledWith(
    SESSION_ID, ACCOUNT_ID, OPERATION_ID, IDEMPOTENCY_KEY);
});

test('never posts after the account session changes during registration', async () => {
  mockContext.mockResolvedValueOnce(context())
    .mockResolvedValueOnce(context())
    .mockResolvedValueOnce(context(ACCOUNT_ID));
  await expect(submitRampOperation(OPERATION_ID, FROZEN))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(mockApi.submitRampOperation).not.toHaveBeenCalled();
});

test('revoked login clears the current session', async () => {
  mockApi.submitRampOperation.mockRejectedValueOnce(new ElevantApiError({ status: 401 }));
  await expect(submitRampOperation(OPERATION_ID, FROZEN))
    .rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
});
