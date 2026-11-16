const mockApi = { getOperationAttendanceDraft: jest.fn(), saveRampAttendanceDraft: jest.fn() };
const mockContext = jest.fn();
const mockRejectSession = jest.fn();
const mockRegister = jest.fn();
const mockReserve = jest.fn();
const mockReadPending = jest.fn();
const mockClearPending = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind, status }) {
      super(`Elevant API error ${status}`); this.kind = kind; this.status = status;
    }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: (...args) => mockRejectSession(...args),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegister(...args),
}));
jest.mock('../src/storage/attendance-draft', () => ({
  reservePendingAttendanceDraft: (...args) => mockReserve(...args),
  readPendingAttendanceDraft: (...args) => mockReadPending(...args),
  clearPendingAttendanceDraft: (...args) => mockClearPending(...args),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));

const { ElevantApiError } = require('@elevant/api-client');
const { MobileServiceError } = require('../src/services/mobile-service-error');
const { readRampAttendanceDraft, saveRampAttendanceDraft } =
  require('../src/services/ramp-attendance-draft');

const operationId = '70000000-0000-4000-8000-000000000005';
const assignmentId = '70000000-0000-4000-8000-000000000006';
const accountId = '20000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000001';
const installationId = '81000000-0000-4000-8000-000000000001';
const key = '82000000-0000-4000-8000-000000000001';
const request = { expectedRevision: 0, observedStartAt: null,
  observedEndAt: null, incidentNote: 'Observado' };
const current = () => ({ sessionId, accessToken: 'token',
  session: { actor: { accountId } } });
const receipt = { contribution: { revision: 1, incidentNote: 'Observado' }, replayed: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue(current());
  mockRegister.mockResolvedValue({ installationId });
  mockReserve.mockResolvedValue({ idempotencyKey: key, request });
  mockReadPending.mockResolvedValue({ idempotencyKey: key, request });
  mockClearPending.mockResolvedValue(true);
  mockRejectSession.mockResolvedValue(true);
  mockApi.getOperationAttendanceDraft.mockResolvedValue({ operationId, assignmentId, occ: null, rampAgent: null });
  mockApi.saveRampAttendanceDraft.mockResolvedValue(receipt);
});

test('reads canonical lanes with confirmed installation and same account session', async () => {
  await expect(readRampAttendanceDraft(operationId, assignmentId)).resolves.toMatchObject({ operationId, assignmentId });
  expect(mockApi.getOperationAttendanceDraft).toHaveBeenCalledWith(operationId,
    assignmentId, { signal: undefined, installationId });
  expect(mockRegister).toHaveBeenCalledWith({ accessToken: 'token' }, { signal: undefined, reuseForSession: true });
});

test('persists one intent and retries an uncertain write with identical key and payload', async () => {
  mockApi.saveRampAttendanceDraft.mockRejectedValueOnce(new MobileServiceError('network_unavailable'));
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request))
    .rejects.toMatchObject({ code: 'network_unavailable' });
  expect(mockClearPending).not.toHaveBeenCalled();
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request)).resolves.toEqual(receipt);
  expect(mockApi.saveRampAttendanceDraft).toHaveBeenCalledTimes(2);
  expect(mockApi.saveRampAttendanceDraft.mock.calls[1]).toEqual(mockApi.saveRampAttendanceDraft.mock.calls[0]);
  expect(mockClearPending).toHaveBeenCalledWith(operationId, assignmentId, key);
});

test('does not send under a new session after device registration', async () => {
  mockContext.mockResolvedValueOnce(current()).mockResolvedValueOnce({ ...current(),
    sessionId: '30000000-0000-4000-8000-000000000002' });
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(mockApi.saveRampAttendanceDraft).not.toHaveBeenCalled();
});

test('does not surface a receipt from the former session after the write', async () => {
  mockContext.mockResolvedValueOnce(current()).mockResolvedValueOnce(current())
    .mockResolvedValueOnce({ ...current(),
      sessionId: '30000000-0000-4000-8000-000000000002' });
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(mockClearPending).not.toHaveBeenCalled();
});

test('does not report success if confirmation cannot clear the original intent', async () => {
  mockClearPending.mockResolvedValueOnce(false);
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request))
    .rejects.toMatchObject({ code: 'cancelled' });
});

test('retains a 409 intention for explicit review and canonical reload', async () => {
  mockApi.saveRampAttendanceDraft.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status: 409 }));
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request))
    .rejects.toMatchObject({ code: 'conflict', status: 409 });
  expect(mockClearPending).not.toHaveBeenCalled();
  expect(mockRejectSession).not.toHaveBeenCalled();
});

test.each([401, 403])('does not resend after HTTP %s and rejects only original session', async status => {
  mockApi.saveRampAttendanceDraft.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status }));
  await expect(saveRampAttendanceDraft(operationId, assignmentId, request)).rejects.toMatchObject({ status });
  expect(mockApi.saveRampAttendanceDraft).toHaveBeenCalledTimes(1);
  expect(mockRejectSession).toHaveBeenCalledWith(sessionId);
  expect(mockClearPending).not.toHaveBeenCalled();
});

test.each([401, 403])('does not reject a replacement session when an old request returns HTTP %s', async status => {
  mockApi.getOperationAttendanceDraft.mockRejectedValueOnce(
    new ElevantApiError({ kind: 'http', status }));
  mockRejectSession.mockResolvedValueOnce(false);
  await expect(readRampAttendanceDraft(operationId, assignmentId))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(mockRejectSession).toHaveBeenCalledWith(sessionId);
});

test('requires explicit resolution before replacing a different pending body', async () => {
  mockReadPending.mockResolvedValueOnce({ idempotencyKey: key, request });
  await expect(saveRampAttendanceDraft(operationId, assignmentId,
    { ...request, incidentNote: 'Nuevo texto' })).rejects.toMatchObject({ code: 'conflict' });
  expect(mockApi.saveRampAttendanceDraft).not.toHaveBeenCalled();
});
