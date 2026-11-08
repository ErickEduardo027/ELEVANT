// 3-I: the checklist submission and the service transitions travel through the device's queue: saved first with their
// stable key and body, sent in order, kept when the answer is uncertain and dropped once ELEVANT refuses them (the
// agent saw the refusal on the screen that sent them).
const mockStore = new Map();
const mockApi = {
  getRampOperationChecklist: jest.fn(),
  submitRampOperationChecklist: jest.fn(),
  transitionRampOperationService: jest.fn(),
};
const mockContext = jest.fn();
const mockRejectSession = jest.fn();
const mockRegisterDevice = jest.fn();
const mockRemoveChecklistDraft = jest.fn();
const mockReadChecklistCache = jest.fn();
const mockWriteChecklistCache = jest.fn();
let mockUuid = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async key => { mockStore.delete(key); }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `50000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind = 'http', status, traceId, code }) {
      super(`Elevant API error ${status}`);
      this.name = 'ElevantApiError';
      this.kind = kind;
      this.status = status;
      this.traceId = traceId;
      this.code = code;
    }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readRampChecklistCacheIfCurrent: (...args) => mockReadChecklistCache(...args),
  writeRampChecklistCacheIfCurrent: (...args) => mockWriteChecklistCache(...args),
  readRampChecklistDraftIfCurrent: jest.fn(),
  removeRampChecklistDraftIfCurrent: (...args) => mockRemoveChecklistDraft(...args),
  writeRampChecklistDraftIfCurrent: jest.fn(),
  readLegacyRampCommandsIfCurrent: jest.fn(async () => ({ kind: 'current', commands: [] })),
  removeLegacyRampCommandIfCurrent: jest.fn(),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: jest.fn(), readWalkaroundPhoto: jest.fn(), forgetWalkaroundPhoto: jest.fn(),
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

const { ElevantApiError } = require('@elevant/api-client');
const { readFlightReportOutbox } = require('../src/synchronization/flight-report-outbox');
const { resetFlightReportForTests } = require('../src/services/flight-report');
const {
  getRampOperationChecklist,
  readRampChecklistPendingSubmission,
  submitRampOperationChecklist,
} = require('../src/services/ramp-operation-checklist');
const { transitionRampOperationService } = require('../src/services/ramp-operation-service-execution');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const RECEIPT_ID = '60000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const CHECKLIST_ID = '71000000-0000-4000-8000-000000000001';
const ITEM_ID = '72000000-0000-4000-8000-000000000001';
const SERVICE_ID = '73000000-0000-4000-8000-000000000001';
const TAPPED_AT = '2026-09-17T18:00:00.000Z';
const offline = (reason = 'unavailable') => Object.assign(new Error(reason), { mockNetwork: true, reason });

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
  return { checklistId: CHECKLIST_ID, answers: [{ itemId: ITEM_ID, value }] };
}

function submitted() {
  return {
    receiptId: RECEIPT_ID,
    checklist: { id: CHECKLIST_ID, status: 'Submitted', startedAt: '2026-09-17T18:00:00Z',
      submittedAt: '2026-09-17T18:01:00Z', answerCount: 1 },
  };
}

function transitioned(status, executedQuantity = 0) {
  return { receiptId: RECEIPT_ID,
    service: { id: SERVICE_ID, status, contractedQuantity: 3, executedQuantity, billingUnit: 'UN' } };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(TAPPED_AT),
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  mockStore.clear();
  mockUuid = 0;
  resetFlightReportForTests();
  mockContext.mockResolvedValue({ accessToken: 'header.payload.signature', sessionId: SESSION_ID,
    session: { actor: { accountId: ACCOUNT_ID } } });
  mockRejectSession.mockResolvedValue(true);
  mockRegisterDevice.mockResolvedValue({ installationId: INSTALLATION_ID });
  mockRemoveChecklistDraft.mockResolvedValue('removed');
  mockWriteChecklistCache.mockResolvedValue('written');
  mockReadChecklistCache.mockResolvedValue({ kind: 'current', value: null });
  mockApi.getRampOperationChecklist.mockResolvedValue(checklistResponse());
});

afterEach(() => { jest.useRealTimers(); });

describe('checklist', () => {
  test('loads only a checklist bound to the requested operation and keeps a copy for the offline ramp', async () => {
    await expect(getRampOperationChecklist(OPERATION_ID)).resolves.toEqual(checklistResponse());
    expect(mockWriteChecklistCache).toHaveBeenCalledWith(SESSION_ID, ACCOUNT_ID, OPERATION_ID,
      JSON.stringify(checklistResponse()));
    mockApi.getRampOperationChecklist.mockResolvedValueOnce(checklistResponse('70000000-0000-4000-8000-000000000002'));
    await expect(getRampOperationChecklist(OPERATION_ID)).rejects.toMatchObject({ code: 'malformed_response' });
  });

  test('without signal the saved copy opens, flagged as cached; another failure is not hidden', async () => {
    mockApi.getRampOperationChecklist.mockRejectedValue(offline());
    mockReadChecklistCache.mockResolvedValue({ kind: 'current', value: JSON.stringify(checklistResponse()) });
    await expect(getRampOperationChecklist(OPERATION_ID)).resolves.toEqual({ ...checklistResponse(), fromCache: true });
    mockApi.getRampOperationChecklist.mockRejectedValue(new ElevantApiError({ status: 404 }));
    await expect(getRampOperationChecklist(OPERATION_ID)).rejects.toMatchObject({ code: 'not_found' });
  });

  test('a submission waits on the device with its answers frozen and is sent again with the same key and body', async () => {
    mockApi.submitRampOperationChecklist.mockRejectedValue(offline('timeout'));
    await expect(submitRampOperationChecklist(OPERATION_ID, checklistRequest('NotApplicable')))
      .resolves.toMatchObject({ state: 'queued', issue: expect.objectContaining({ code: 'request_timeout' }) });
    const pending = await readRampChecklistPendingSubmission(OPERATION_ID, CHECKLIST_ID);
    expect(pending).toEqual({ idempotencyKey: expect.any(String), request: checklistRequest('NotApplicable') });
    expect(mockRemoveChecklistDraft).not.toHaveBeenCalled();

    mockApi.submitRampOperationChecklist.mockResolvedValue(submitted());
    // A later tap with other answers sends the frozen body: the receipt of the first one is replayed.
    await expect(submitRampOperationChecklist(OPERATION_ID, checklistRequest('Ok')))
      .resolves.toMatchObject({ state: 'confirmed', response: { checklist: { status: 'Submitted' } } });
    expect(mockApi.submitRampOperationChecklist).toHaveBeenLastCalledWith(OPERATION_ID,
      checklistRequest('NotApplicable'), INSTALLATION_ID, pending.idempotencyKey);
    expect(mockRemoveChecklistDraft).toHaveBeenCalledWith(SESSION_ID, ACCOUNT_ID, OPERATION_ID, CHECKLIST_ID);
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
  });

  test.each([409, 404])('a submission ELEVANT refuses with HTTP %s leaves the queue and keeps its kind', async status => {
    mockApi.submitRampOperationChecklist.mockRejectedValue(new ElevantApiError({ status }));
    await expect(submitRampOperationChecklist(OPERATION_ID, checklistRequest()))
      .rejects.toMatchObject({ code: status === 409 ? 'conflict' : 'not_found' });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
    expect(mockRejectSession).not.toHaveBeenCalled();
  });

  test.each([429, 500, 503])('keeps the submission on the device when HTTP %s leaves it uncertain', async status => {
    mockApi.submitRampOperationChecklist.mockRejectedValue(new ElevantApiError({ status }));
    await expect(submitRampOperationChecklist(OPERATION_ID, checklistRequest())).resolves.toMatchObject({
      state: 'queued', issue: expect.objectContaining({ code: 'request_failed', retryable: true, status }),
    });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toHaveLength(1);
    expect(mockRejectSession).not.toHaveBeenCalled();
  });

  test('a revoked authorization rejects only the current session and keeps the submission on the device', async () => {
    mockApi.submitRampOperationChecklist.mockRejectedValue(new ElevantApiError({ status: 403 }));
    await expect(submitRampOperationChecklist(OPERATION_ID, checklistRequest())).rejects.toMatchObject({ code: 'forbidden' });
    expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toHaveLength(1);
  });
});

describe('service transitions', () => {
  test('sends the tapped time with the transition and validates the canonical response', async () => {
    mockApi.transitionRampOperationService.mockResolvedValue(transitioned('Completed', 2.5));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID,
      { targetStatus: 'Completed', executedQuantity: 2.5, note: 'Finalizado' }, { serviceName: 'Equipaje' }))
      .resolves.toMatchObject({ state: 'confirmed', response: { service: { status: 'Completed' } } });
    expect(mockApi.transitionRampOperationService).toHaveBeenCalledWith(OPERATION_ID, SERVICE_ID,
      { targetStatus: 'Completed', executedQuantity: 2.5, note: 'Finalizado', occurredAt: TAPPED_AT },
      INSTALLATION_ID, '50000000-0000-4000-8000-000000000001');
    expect(mockRegisterDevice.mock.invocationCallOrder[0])
      .toBeLessThan(mockApi.transitionRampOperationService.mock.invocationCallOrder[0]);
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
  });

  test('rejects invalid terminal service payloads before saving anything', async () => {
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID,
      { targetStatus: 'NotPerformed', executedQuantity: 1, note: 'No disponible' })).rejects.toMatchObject({ code: 'request_failed' });
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID,
      { targetStatus: 'Exception', executedQuantity: 0 })).rejects.toMatchObject({ code: 'request_failed' });
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID,
      { targetStatus: 'Completed', executedQuantity: 100_000_000_000_000 })).rejects.toMatchObject({ code: 'request_failed' });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
    expect(mockApi.transitionRampOperationService).not.toHaveBeenCalled();
  });

  test('rejects a service response that does not confirm the requested transition', async () => {
    mockApi.transitionRampOperationService.mockResolvedValue(transitioned('Completed', 3));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' }))
      .rejects.toMatchObject({ code: 'malformed_response' });
  });

  test('a refused time keeps its Problem Details code and leaves the queue', async () => {
    mockApi.transitionRampOperationService.mockRejectedValue(
      new ElevantApiError({ status: 409, code: 'service_time_out_of_order' }));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' }))
      .rejects.toMatchObject({ code: 'conflict', problemCode: 'service_time_out_of_order',
        message: 'La hora del servicio es anterior a su último cambio registrado. Revisa la hora y vuelve a registrarlo.' });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
  });

  test('a released assignment (404) leaves the queue', async () => {
    mockApi.transitionRampOperationService.mockRejectedValue(new ElevantApiError({ status: 404 }));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' }))
      .rejects.toMatchObject({ code: 'not_found' });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
  });

  test.each([401, 403])('HTTP %s rejects only the current session and keeps the transition on the device', async status => {
    mockApi.transitionRampOperationService.mockRejectedValue(new ElevantApiError({ status }));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' }))
      .rejects.toMatchObject({ code: status === 401 ? 'unauthenticated' : 'forbidden' });
    expect(mockRejectSession).toHaveBeenCalledWith(SESSION_ID);
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toHaveLength(1);
  });

  test.each([429, 500, 503])('keeps the transition on the device when HTTP %s leaves it uncertain', async status => {
    mockApi.transitionRampOperationService.mockRejectedValue(new ElevantApiError({ status }));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' }))
      .resolves.toMatchObject({ state: 'queued', issue: expect.objectContaining({ code: 'request_failed', status }) });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toHaveLength(1);
    expect(mockRejectSession).not.toHaveBeenCalled();
  });

  test.each([
    ['unavailable', 'network_unavailable'],
    ['timeout', 'request_timeout'],
  ])('keeps the transition on the device when the network is %s', async (reason, code) => {
    mockApi.transitionRampOperationService.mockRejectedValue(offline(reason));
    await expect(transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' }))
      .resolves.toMatchObject({ state: 'queued', issue: expect.objectContaining({ code }) });
    const [queued] = await readFlightReportOutbox(ACCOUNT_ID);
    expect(queued.command).toMatchObject({ kind: 'serviceTransition', targetStatus: 'InProgress', occurredAt: TAPPED_AT });
    expect(mockRejectSession).not.toHaveBeenCalled();
  });

  test('each transition of a service is its own fact: two taps travel in order', async () => {
    mockApi.transitionRampOperationService.mockRejectedValue(offline());
    await transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'InProgress' });
    jest.setSystemTime(new Date('2026-09-17T18:20:00.000Z'));
    await transitionRampOperationService(OPERATION_ID, SERVICE_ID, { targetStatus: 'Completed', executedQuantity: 3 });
    expect((await readFlightReportOutbox(ACCOUNT_ID)).map(item => [item.command.targetStatus, item.command.occurredAt]))
      .toEqual([['InProgress', TAPPED_AT], ['Completed', '2026-09-17T18:20:00.000Z']]);
  });
});
