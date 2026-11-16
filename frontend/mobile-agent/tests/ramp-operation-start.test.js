// 3-I: «Iniciar» goes through the device's queue. The tap is stamped with ELEVANT's clock and saved before anything is
// sent, so a tablet without signal starts the operation; the server keeps the tapped time.
const mockStore = new Map();
const mockApi = {
  registerMobileDevice: jest.fn(),
  startRampOperation: jest.fn(),
};
const mockReadOrCreateMobileInstallationId = jest.fn();
const mockGetMobileSessionRequestContext = jest.fn();
const mockRejectMobileSessionRequest = jest.fn();
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
    constructor({ kind, status, traceId, code }) {
      super(`Elevant API error ${status}`);
      this.name = 'ElevantApiError';
      this.kind = kind;
      this.status = status;
      this.traceId = traceId;
      this.code = code;
    }
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readOrCreateMobileInstallationId: (...args) => mockReadOrCreateMobileInstallationId(...args),
  readLegacyRampCommandsIfCurrent: jest.fn(async () => ({ kind: 'current', commands: [] })),
  removeLegacyRampCommandIfCurrent: jest.fn(),
  removeRampChecklistDraftIfCurrent: jest.fn(),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: jest.fn(), readWalkaroundPhoto: jest.fn(), forgetWalkaroundPhoto: jest.fn(),
}));
jest.mock('../src/services/mobile-auth', () => {
  const { MobileServiceError } = jest.requireActual('../src/services/mobile-service-error');
  return {
    getMobileSessionRequestContext: (...args) => mockGetMobileSessionRequestContext(...args),
    rejectMobileSessionRequest: (...args) => mockRejectMobileSessionRequest(...args),
    MobileServiceError,
  };
});

const { ElevantApiError } = require('@elevant/api-client');
const { Platform } = require('react-native');
const { readFlightReportOutbox } = require('../src/synchronization/flight-report-outbox');
const { resetFlightReportForTests } = require('../src/services/flight-report');
const { startAssignedRampOperation } = require('../src/services/ramp-operation-start');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const TEST_PLATFORM = Platform.OS === 'android' ? 'Android' : 'Ios';
const TAPPED_AT = '2026-09-17T18:00:00.000Z';

function startedResponse() {
  return {
    receiptId: '60000000-0000-4000-8000-000000000001',
    operation: {
      id: OPERATION_ID,
      status: 'InProgress',
      plannedStartAt: null,
      plannedEndAt: null,
      actualStartAt: TAPPED_AT,
      actualEndAt: null,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(TAPPED_AT),
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  mockStore.clear();
  resetFlightReportForTests();
  mockReadOrCreateMobileInstallationId.mockResolvedValue(INSTALLATION_ID);
  mockGetMobileSessionRequestContext.mockResolvedValue({
    accessToken: 'header.payload.signature',
    sessionId: SESSION_ID,
    session: { actor: { accountId: ACCOUNT_ID } },
  });
  mockRejectMobileSessionRequest.mockResolvedValue(true);
  mockApi.registerMobileDevice.mockResolvedValue({
    installationId: INSTALLATION_ID,
    platform: TEST_PLATFORM,
    appVersion: '1.0.0',
    lastSeenAt: TAPPED_AT,
  });
  mockApi.startRampOperation.mockResolvedValue(startedResponse());
});

afterEach(() => { jest.useRealTimers(); });

test('saves the tap in the queue first, registers the installation and sends the tapped time', async () => {
  await expect(startAssignedRampOperation(OPERATION_ID, { timeZone: 'America/Santo_Domingo' }))
    .resolves.toEqual({ state: 'confirmed', response: startedResponse() });

  expect(mockApi.registerMobileDevice).toHaveBeenCalledWith(
    expect.objectContaining({ installationId: INSTALLATION_ID, appVersion: '1.0.0' }), { signal: undefined });
  expect(mockApi.startRampOperation).toHaveBeenCalledWith(OPERATION_ID, INSTALLATION_ID,
    '50000000-0000-4000-8000-000000000001', undefined, { startedAt: TAPPED_AT });
  expect(mockApi.registerMobileDevice.mock.invocationCallOrder[0])
    .toBeLessThan(mockApi.startRampOperation.mock.invocationCallOrder[0]);
  expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
});

test('without signal the start waits on the device with its time; a second tap resends the same command', async () => {
  mockApi.startRampOperation.mockRejectedValue({ mockNetwork: true });
  await expect(startAssignedRampOperation(OPERATION_ID)).resolves.toEqual({ state: 'queued', startedAt: TAPPED_AT,
    issue: expect.objectContaining({ code: 'network_unavailable' }) });
  const [waiting] = await readFlightReportOutbox(ACCOUNT_ID);
  expect(waiting).toMatchObject({ state: 'pending',
    command: { kind: 'start', operationId: OPERATION_ID, occurredAt: TAPPED_AT } });

  jest.setSystemTime(new Date('2026-09-17T18:04:00.000Z'));
  mockApi.startRampOperation.mockResolvedValue(startedResponse());
  await expect(startAssignedRampOperation(OPERATION_ID)).resolves.toMatchObject({ state: 'confirmed' });
  // The same key and the same tapped time: ELEVANT replays one start, never a second one.
  expect(mockApi.startRampOperation).toHaveBeenLastCalledWith(OPERATION_ID, INSTALLATION_ID, waiting.idempotencyKey,
    undefined, { startedAt: TAPPED_AT });
  expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
});

test('clears only the rejected session after an unauthorized start and keeps the start on the device', async () => {
  mockApi.startRampOperation.mockRejectedValue(new ElevantApiError({ kind: 'http', status: 401 }));

  await expect(startAssignedRampOperation(OPERATION_ID)).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  expect(mockRejectMobileSessionRequest).toHaveBeenCalledWith(SESSION_ID);
  expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([
    expect.objectContaining({ state: 'pending', command: expect.objectContaining({ kind: 'start' }) })]);
});

test('a refusal keeps its code; the next tap takes its turn with a new key and a new time', async () => {
  mockApi.startRampOperation.mockRejectedValue(
    new ElevantApiError({ kind: 'http', status: 409, code: 'contract_not_in_force' }));

  await expect(startAssignedRampOperation(OPERATION_ID)).rejects.toMatchObject({
    code: 'conflict', status: 409, retryable: false, problemCode: 'contract_not_in_force',
  });
  expect(mockRejectMobileSessionRequest).not.toHaveBeenCalled();
  const [refused] = await readFlightReportOutbox(ACCOUNT_ID);
  expect(refused).toMatchObject({ state: 'blocked', lastCode: 'contract_not_in_force' });

  jest.setSystemTime(new Date('2026-09-17T18:10:00.000Z'));
  mockApi.startRampOperation.mockResolvedValue(startedResponse());
  await expect(startAssignedRampOperation(OPERATION_ID)).resolves.toMatchObject({ state: 'confirmed' });
  const [, , key, , body] = mockApi.startRampOperation.mock.calls.at(-1);
  expect(key).not.toBe(refused.idempotencyKey);
  expect(body).toEqual({ startedAt: '2026-09-17T18:10:00.000Z' });
  expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
});

test('a device binding conflict is reported and the start waits for the device to be sorted out', async () => {
  mockApi.registerMobileDevice.mockRejectedValue(new ElevantApiError({ kind: 'http', status: 409 }));

  await expect(startAssignedRampOperation(OPERATION_ID)).resolves.toMatchObject({
    state: 'queued', issue: expect.objectContaining({ code: 'device_conflict', status: 409 }),
  });
  expect(mockApi.startRampOperation).not.toHaveBeenCalled();
  expect(mockRejectMobileSessionRequest).not.toHaveBeenCalled();
  expect(await readFlightReportOutbox(ACCOUNT_ID)).toHaveLength(1);
});

test('rejects an operation id that is not a UUID before touching the queue', async () => {
  await expect(startAssignedRampOperation('nope')).rejects.toMatchObject({ code: 'request_failed' });
  expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
});
