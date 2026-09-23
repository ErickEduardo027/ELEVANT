const mockApi = {
  getRampOperationChecklist: jest.fn(),
  submitRampOperationChecklist: jest.fn(),
  transitionRampOperationService: jest.fn(),
};
const mockContext = jest.fn();
const mockRejectSession = jest.fn();
const mockRegisterDevice = jest.fn();
const mockGetChecklistCommand = jest.fn();
const mockRemoveChecklistCommand = jest.fn();
const mockRemoveChecklistDraft = jest.fn();
const mockGetServiceCommand = jest.fn();
const mockReadServiceCommand = jest.fn();
const mockRemoveServiceCommand = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind = 'http', status, traceId }) {
      super(`Elevant API error ${status}`);
      this.name = 'ElevantApiError';
      this.kind = kind;
      this.status = status;
      this.traceId = traceId;
    }
  },
}));

jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));

jest.mock('../src/storage/mobile-session', () => ({
  getOrCreateRampChecklistSubmitCommandIfCurrent: (...args) =>
    mockGetChecklistCommand(...args),
  getOrCreateRampServiceTransitionCommandIfCurrent: (...args) =>
    mockGetServiceCommand(...args),
  readRampChecklistDraftIfCurrent: jest.fn(),
  readRampChecklistSubmitCommandIfCurrent: jest.fn(),
  readRampServiceTransitionCommandIfCurrent: (...args) =>
    mockReadServiceCommand(...args),
  removeRampChecklistDraftIfCurrent: (...args) =>
    mockRemoveChecklistDraft(...args),
  removeRampChecklistSubmitCommandIfCurrent: (...args) =>
    mockRemoveChecklistCommand(...args),
  removeRampServiceTransitionCommandIfCurrent: (...args) =>
    mockRemoveServiceCommand(...args),
  writeRampChecklistDraftIfCurrent: jest.fn(),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));

jest.mock('../src/services/mobile-auth', () => {
  const { MobileServiceError } = jest.requireActual(
    '../src/services/mobile-service-error',
  );
  return {
    getMobileSessionRequestContext: (...args) => mockContext(...args),
    rejectMobileSessionRequest: (...args) => mockRejectSession(...args),
    MobileServiceError,
  };
});

jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegisterDevice(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const {
  getRampOperationChecklist,
  submitRampOperationChecklist,
} = require('../src/services/ramp-operation-checklist');
const {
  transitionRampOperationService,
} = require('../src/services/ramp-operation-service-execution');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '50000000-0000-4000-8000-000000000001';
const RECEIPT_ID = '60000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const CHECKLIST_ID = '71000000-0000-4000-8000-000000000001';
const ITEM_ID = '72000000-0000-4000-8000-000000000001';
const SERVICE_ID = '73000000-0000-4000-8000-000000000001';

function context(overrides = {}) {
  return {
    accessToken: 'header.payload.signature',
    sessionId: SESSION_ID,
    session: { actor: { accountId: ACCOUNT_ID } },
    ...overrides,
  };
}

function checklistResponse(operationId = OPERATION_ID) {
  return {
    operationId,
    checklist: {
      id: CHECKLIST_ID,
      status: 'NotStarted',
      startedAt: null,
      submittedAt: null,
      template: { code: 'RAMP', name: 'Checklist rampa', version: 1 },
      sections: [{
        name: 'Seguridad',
        items: [{
          id: ITEM_ID,
          code: 'SAFE-01',
          label: 'Área segura',
          sortOrder: 1,
          isRequired: true,
          requiresNoteWhenNotOk: true,
        }],
      }],
    },
  };
}

function checklistRequest(value = 'Ok') {
  return {
    checklistId: CHECKLIST_ID,
    answers: [{ itemId: ITEM_ID, value }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue(context());
  mockRejectSession.mockResolvedValue(true);
  mockRegisterDevice.mockResolvedValue({ installationId: INSTALLATION_ID });
  mockRemoveChecklistDraft.mockResolvedValue('removed');
  mockRemoveChecklistCommand.mockResolvedValue('removed');
  mockRemoveServiceCommand.mockResolvedValue('removed');
  mockReadServiceCommand.mockResolvedValue({ kind: 'current', command: null });
  mockApi.getRampOperationChecklist.mockResolvedValue(checklistResponse());
});

test('loads only a checklist bound to the requested operation', async () => {
  await expect(getRampOperationChecklist(OPERATION_ID)).resolves.toEqual(
    checklistResponse(),
  );
  mockApi.getRampOperationChecklist.mockResolvedValueOnce(
    checklistResponse('70000000-0000-4000-8000-000000000002'),
  );
  await expect(getRampOperationChecklist(OPERATION_ID)).rejects.toMatchObject({
    code: 'malformed_response',
  });
});

test('reserves checklist payload before registration and replays the frozen body', async () => {
  const frozen = checklistRequest('NotApplicable');
  mockGetChecklistCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(frozen),
  });
  mockApi.submitRampOperationChecklist.mockResolvedValue({
    receiptId: RECEIPT_ID,
    checklist: {
      id: CHECKLIST_ID,
      status: 'Submitted',
      startedAt: '2026-09-17T18:00:00Z',
      submittedAt: '2026-09-17T18:01:00Z',
      answerCount: 1,
    },
  });

  await submitRampOperationChecklist(OPERATION_ID, checklistRequest('Ok'));

  expect(mockApi.submitRampOperationChecklist).toHaveBeenCalledWith(
    OPERATION_ID,
    frozen,
    INSTALLATION_ID,
    IDEMPOTENCY_KEY,
    { signal: undefined },
  );
  expect(mockGetChecklistCommand.mock.invocationCallOrder[0]).toBeLessThan(
    mockRegisterDevice.mock.invocationCallOrder[0],
  );
  expect(mockRegisterDevice.mock.invocationCallOrder[0]).toBeLessThan(
    mockApi.submitRampOperationChecklist.mock.invocationCallOrder[0],
  );
  expect(mockRemoveChecklistCommand).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
    CHECKLIST_ID,
    IDEMPOTENCY_KEY,
  );
});

test('does not submit checklist after account session revision changes', async () => {
  mockGetChecklistCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(checklistRequest()),
  });
  mockContext
    .mockResolvedValueOnce(context())
    .mockResolvedValueOnce(context({ sessionId: '30000000-0000-4000-8000-000000000002' }));

  await expect(
    submitRampOperationChecklist(OPERATION_ID, checklistRequest()),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(mockApi.submitRampOperationChecklist).not.toHaveBeenCalled();
});

test('clears a deterministic checklist conflict command but retains auth semantics', async () => {
  mockGetChecklistCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(checklistRequest()),
  });
  mockApi.submitRampOperationChecklist.mockRejectedValue(
    new ElevantApiError({ status: 409 }),
  );

  await expect(
    submitRampOperationChecklist(OPERATION_ID, checklistRequest()),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(mockRemoveChecklistCommand).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
    CHECKLIST_ID,
    IDEMPOTENCY_KEY,
  );
  expect(mockRejectSession).not.toHaveBeenCalled();
});

test('clears a checklist command after a deterministic not-found rejection', async () => {
  mockGetChecklistCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(checklistRequest()),
  });
  mockApi.submitRampOperationChecklist.mockRejectedValue(
    new ElevantApiError({ status: 404 }),
  );

  await expect(
    submitRampOperationChecklist(OPERATION_ID, checklistRequest()),
  ).rejects.toMatchObject({ code: 'not_found' });
  expect(mockRemoveChecklistCommand).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
    CHECKLIST_ID,
    IDEMPOTENCY_KEY,
  );
});

test('keeps a checklist command reserved when the commit result times out', async () => {
  mockGetChecklistCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(checklistRequest()),
  });
  mockApi.submitRampOperationChecklist.mockRejectedValue(
    Object.assign(new Error('timeout'), { mockNetwork: true, reason: 'timeout' }),
  );

  await expect(
    submitRampOperationChecklist(OPERATION_ID, checklistRequest()),
  ).rejects.toMatchObject({ code: 'request_timeout' });
  expect(mockRemoveChecklistCommand).not.toHaveBeenCalled();
});

test.each([429, 500, 503])(
  'keeps a checklist command reserved when HTTP %s leaves the commit uncertain',
  async status => {
    mockGetChecklistCommand.mockResolvedValue({
      kind: 'current',
      idempotencyKey: IDEMPOTENCY_KEY,
      payload: JSON.stringify(checklistRequest()),
    });
    mockApi.submitRampOperationChecklist.mockRejectedValue(
      new ElevantApiError({ status }),
    );

    await expect(
      submitRampOperationChecklist(OPERATION_ID, checklistRequest()),
    ).rejects.toMatchObject({
      code: 'request_failed',
      retryable: true,
      status,
    });
    expect(mockRemoveChecklistCommand).not.toHaveBeenCalled();
    expect(mockRejectSession).not.toHaveBeenCalled();
  },
);

test('rejects only the current session when checklist authorization is revoked', async () => {
  mockGetChecklistCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(checklistRequest()),
  });
  mockApi.submitRampOperationChecklist.mockRejectedValue(
    new ElevantApiError({ status: 403 }),
  );

  await expect(
    submitRampOperationChecklist(OPERATION_ID, checklistRequest()),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
  expect(mockRemoveChecklistCommand).not.toHaveBeenCalled();
});

test('replays an exact service transition and validates its canonical response', async () => {
  const frozen = {
    targetStatus: 'Completed',
    executedQuantity: 2.5,
    note: 'Finalizado',
  };
  mockGetServiceCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify(frozen),
  });
  mockApi.transitionRampOperationService.mockResolvedValue({
    receiptId: RECEIPT_ID,
    service: {
      id: SERVICE_ID,
      status: 'Completed',
      contractedQuantity: 3,
      executedQuantity: 2.5,
      billingUnit: 'UN',
    },
  });

  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'Completed', executedQuantity: 3 },
    ),
  ).resolves.toMatchObject({ service: { status: 'Completed' } });
  expect(mockApi.transitionRampOperationService).toHaveBeenCalledWith(
    OPERATION_ID,
    SERVICE_ID,
    frozen,
    INSTALLATION_ID,
    IDEMPOTENCY_KEY,
    { signal: undefined },
  );
  expect(mockGetServiceCommand.mock.invocationCallOrder[0]).toBeLessThan(
    mockRegisterDevice.mock.invocationCallOrder[0],
  );
  expect(mockRemoveServiceCommand).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
    SERVICE_ID,
    'Completed',
    IDEMPOTENCY_KEY,
  );
});

test('rejects invalid terminal service payloads before reserving a command', async () => {
  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'NotPerformed', executedQuantity: 1, note: 'No disponible' },
    ),
  ).rejects.toMatchObject({ code: 'request_failed' });
  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'Exception', executedQuantity: 0 },
    ),
  ).rejects.toMatchObject({ code: 'request_failed' });
  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'Completed', executedQuantity: 100_000_000_000_000 },
    ),
  ).rejects.toMatchObject({ code: 'request_failed' });
  expect(mockGetServiceCommand).not.toHaveBeenCalled();
});

test('rejects a service response that does not confirm the requested transition', async () => {
  mockGetServiceCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify({ targetStatus: 'InProgress' }),
  });
  mockApi.transitionRampOperationService.mockResolvedValue({
    receiptId: RECEIPT_ID,
    service: {
      id: SERVICE_ID,
      status: 'Completed',
      contractedQuantity: 3,
      executedQuantity: 3,
      billingUnit: 'UN',
    },
  });

  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'InProgress' },
    ),
  ).rejects.toMatchObject({ code: 'malformed_response' });
});

test('clears a service command after a deterministic not-found rejection', async () => {
  mockGetServiceCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify({ targetStatus: 'InProgress' }),
  });
  mockApi.transitionRampOperationService.mockRejectedValue(
    new ElevantApiError({ status: 404 }),
  );

  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'InProgress' },
    ),
  ).rejects.toMatchObject({ code: 'not_found' });
  expect(mockRemoveServiceCommand).toHaveBeenCalledWith(
    SESSION_ID,
    ACCOUNT_ID,
    OPERATION_ID,
    SERVICE_ID,
    'InProgress',
    IDEMPOTENCY_KEY,
  );
});

test('clears only the rejected session on unauthorized service transition', async () => {
  mockGetServiceCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify({ targetStatus: 'InProgress' }),
  });
  mockApi.transitionRampOperationService.mockRejectedValue(
    new ElevantApiError({ status: 401 }),
  );

  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'InProgress' },
    ),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
});

test.each([429, 500, 503])(
  'keeps a service command reserved when HTTP %s leaves the transition uncertain',
  async status => {
    mockGetServiceCommand.mockResolvedValue({
      kind: 'current',
      idempotencyKey: IDEMPOTENCY_KEY,
      payload: JSON.stringify({ targetStatus: 'InProgress' }),
    });
    mockApi.transitionRampOperationService.mockRejectedValue(
      new ElevantApiError({ status }),
    );

    await expect(
      transitionRampOperationService(
        OPERATION_ID,
        SERVICE_ID,
        { targetStatus: 'InProgress' },
      ),
    ).rejects.toMatchObject({
      code: 'request_failed',
      retryable: true,
      status,
    });
    expect(mockRemoveServiceCommand).not.toHaveBeenCalled();
    expect(mockRejectSession).not.toHaveBeenCalled();
  },
);

test.each([
  ['unavailable', 'network_unavailable'],
  ['timeout', 'request_timeout'],
])(
  'keeps a service command reserved when the network is %s',
  async (reason, code) => {
    mockGetServiceCommand.mockResolvedValue({
      kind: 'current',
      idempotencyKey: IDEMPOTENCY_KEY,
      payload: JSON.stringify({ targetStatus: 'InProgress' }),
    });
    mockApi.transitionRampOperationService.mockRejectedValue(
      Object.assign(new Error(reason), { mockNetwork: true, reason }),
    );

    await expect(
      transitionRampOperationService(
        OPERATION_ID,
        SERVICE_ID,
        { targetStatus: 'InProgress' },
      ),
    ).rejects.toMatchObject({ code, retryable: true });
    expect(mockRemoveServiceCommand).not.toHaveBeenCalled();
    expect(mockRejectSession).not.toHaveBeenCalled();
  },
);

test('rejects only the current session when service authorization is revoked', async () => {
  mockGetServiceCommand.mockResolvedValue({
    kind: 'current',
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: JSON.stringify({ targetStatus: 'InProgress' }),
  });
  mockApi.transitionRampOperationService.mockRejectedValue(
    new ElevantApiError({ status: 403 }),
  );

  await expect(
    transitionRampOperationService(
      OPERATION_ID,
      SERVICE_ID,
      { targetStatus: 'InProgress' },
    ),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
  expect(mockRemoveServiceCommand).not.toHaveBeenCalled();
});
