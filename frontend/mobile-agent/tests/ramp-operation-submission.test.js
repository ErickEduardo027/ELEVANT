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
const mockFlush = jest.fn();
const mockQueue = jest.fn();
const mockDocuments = jest.fn();

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
// 3-N06: the hand-off waits for the device's queue and the signed Service Order.
jest.mock('../src/services/flight-report', () => ({
  flushFlightReport: (...args) => mockFlush(...args),
  readOperationQueue: (...args) => mockQueue(...args),
  loadOperationDocuments: (...args) => mockDocuments(...args),
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

function serviceOrder(overrides = {}) {
  return { operationId: OPERATION_ID, damageMarks: [], documents: [
    { kind: 'FlightReport', isFullySigned: false, staleRoles: [] },
    { kind: 'ServiceOrder', isFullySigned: true, staleRoles: [], ...overrides },
  ] };
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
  mockFlush.mockResolvedValue(undefined);
  mockQueue.mockResolvedValue({ pending: 0, blocked: 0 });
  mockDocuments.mockResolvedValue(serviceOrder());
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
  expect(mockRejectSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID }),
    expect.objectContaining({ code: 'unauthenticated' }));
});

describe('hand-off readiness (3-N06)', () => {
  test('sends the device queue first and checks it and the Service Order before reserving the hand-off', async () => {
    await submitRampOperation(OPERATION_ID, FROZEN);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockQueue).toHaveBeenCalledWith(OPERATION_ID);
    expect(mockDocuments).toHaveBeenCalledWith(OPERATION_ID);
    expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(mockQueue.mock.invocationCallOrder[0]);
    expect(mockDocuments.mock.invocationCallOrder[0]).toBeLessThan(mockGetCommand.mock.invocationCallOrder[0]);
  });

  test.each([
    ['records still on the device', { pending: 2, blocked: 0 }],
    ['a record ELEVANT refused', { pending: 0, blocked: 1 }],
  ])('holds the hand-off with %s', async (_description, queue) => {
    mockQueue.mockResolvedValue(queue);
    await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict',
      problemCode: 'pending_queue',
      message: 'Faltan registros por enviar a ELEVANT. Abre Sincronización y espera a que se envíen.' });
    expect(mockGetCommand).not.toHaveBeenCalled();
    expect(mockApi.submitRampOperation).not.toHaveBeenCalled();
  });

  test.each([
    ['without every signature', { isFullySigned: false }],
    ['signed on an earlier content', { staleRoles: ['AirlineRepresentative'] }],
  ])('holds the hand-off while the Service Order is %s', async (_description, order) => {
    mockDocuments.mockResolvedValue(serviceOrder(order));
    await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict',
      problemCode: 'service_order_unsigned',
      message: 'Falta firmar la Orden de Servicio (aerolínea y AVIAM) sobre su contenido actual.' });
    expect(mockApi.submitRampOperation).not.toHaveBeenCalled();
  });

  // N3 (D-N3): the tablet says these forms are not needed to hand off; the service agrees.
  test('an unsigned Flight Report or bridge checklist does not hold the hand-off', async () => {
    const documents = serviceOrder();
    documents.documents.push({ kind: 'BridgeChecklist', isFullySigned: false, staleRoles: ['BridgeOperator'] });
    mockDocuments.mockResolvedValue(documents);
    await submitRampOperation(OPERATION_ID, FROZEN);
    expect(mockApi.submitRampOperation).toHaveBeenCalledWith(
      OPERATION_ID, FROZEN, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
  });

  test('an uncertain hand-off already reserved is replayed without the checks', async () => {
    mockReadCommand.mockResolvedValue({ kind: 'current', command: COMMAND });
    mockQueue.mockResolvedValue({ pending: 1, blocked: 0 });
    await submitRampOperation(OPERATION_ID, FROZEN);
    expect(mockQueue).not.toHaveBeenCalled();
    expect(mockApi.submitRampOperation).toHaveBeenCalledWith(
      OPERATION_ID, FROZEN, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
  });
});

describe('every requirement names its cause (N1)', () => {
  test('a checklist ELEVANT has not received holds the hand-off with checklist_not_submitted', async () => {
    mockChecklist.mockResolvedValue({ checklist: { status: 'InProgress' } });
    await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict',
      problemCode: 'checklist_not_submitted',
      message: 'Falta enviar el checklist a ELEVANT: ábrelo, complétalo y envíalo antes de entregar.' });
    expect(mockGetCommand).not.toHaveBeenCalled();
    expect(mockApi.submitRampOperation).not.toHaveBeenCalled();
  });

  // The run of the VPS of 16 November: the checklist sent a moment before still waited in the queue when the hand-off
  // read it. The queue goes out first, so what the agent just sent counts.
  test('the queue goes out before the checklist is read, so a checklist just sent counts', async () => {
    let sent = false;
    mockFlush.mockImplementation(async () => { sent = true; });
    mockChecklist.mockImplementation(async () => ({ checklist: { status: sent ? 'Submitted' : 'InProgress' } }));
    await submitRampOperation(OPERATION_ID, FROZEN);
    expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(mockChecklist.mock.invocationCallOrder[0]);
    expect(mockQueue.mock.invocationCallOrder[0]).toBeLessThan(mockChecklist.mock.invocationCallOrder[0]);
    expect(mockApi.submitRampOperation).toHaveBeenCalledWith(
      OPERATION_ID, FROZEN, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
  });

  // The device's copy may be older than the checklist the queue just sent: without signal the hand-off waits for
  // signal, and never says the checklist is missing.
  test.each(['InProgress', 'Submitted'])('a checklist read only from the saved copy (%s) waits for signal', async status => {
    mockChecklist.mockResolvedValue({ fromCache: true, checklist: { status } });
    await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'network_unavailable' });
    expect(mockGetCommand).not.toHaveBeenCalled();
    expect(mockApi.submitRampOperation).not.toHaveBeenCalled();
  });

  test('the queue goes out before the services are read, so a service just finished counts', async () => {
    let sent = false;
    mockFlush.mockImplementation(async () => { sent = true; });
    mockAssigned.mockImplementation(async () => assigned('InProgress', [{ status: sent ? 'Completed' : 'InProgress' }]));
    await submitRampOperation(OPERATION_ID, FROZEN);
    expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(mockAssigned.mock.invocationCallOrder[0]);
    expect(mockApi.submitRampOperation).toHaveBeenCalled();
  });

  test.each([
    ['waiting to go out', 'pending'],
    ['refused by ELEVANT', 'blocked'],
  ])('an incident report %s holds the hand-off with pending_incidents', async (_description, state) => {
    mockIncidents.mockResolvedValue({ online: true, outbox: [{ state }] });
    await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toMatchObject({ code: 'conflict',
      problemCode: 'pending_incidents',
      message: 'Hay incidencias de esta operación que no llegaron a ELEVANT: ábrelas en Incidencias antes de entregar.' });
    expect(mockGetCommand).not.toHaveBeenCalled();
  });

  test('without signal for the incidents the hand-off keeps that failure', async () => {
    const issue = new (require('../src/services/mobile-service-error').MobileServiceError)('network_unavailable');
    mockIncidents.mockResolvedValue({ online: false, outbox: [], issue });
    await expect(submitRampOperation(OPERATION_ID, FROZEN)).rejects.toBe(issue);
  });
});
