// Reads keep a cached copy; since 3-I each mark travels through the device's queue with its stable key.
const mockStore = new Map();
const mockApi = { getRampOperationCharges: jest.fn(), applyRampServiceCharge: jest.fn() };
const mockContext = jest.fn();
const mockRegisterDevice = jest.fn();
const mockReadCache = jest.fn();
const mockWriteCache = jest.fn();
const mockRejectSession = jest.fn();
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
    constructor(status, code) {
      super(`API ${status}`);
      this.kind = 'http';
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readRampOperationChargesCacheIfCurrent: (...args) => mockReadCache(...args),
  writeRampOperationChargesCacheIfCurrent: (...args) => mockWriteCache(...args),
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
const { changeRampServiceCharge, getRampOperationCharges } = require('../src/services/ramp-service-charges');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '50000000-0000-4000-8000-000000000001';
const RECEIPT_ID = '60000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const SERVICE_ID = '73000000-0000-4000-8000-000000000001';
const CHARGE_ID = '74000000-0000-4000-8000-000000000001';
const SERVICE = { serviceId: SERVICE_ID, canEdit: true,
  available: [{ id: CHARGE_ID, code: 'NIGHT', name: 'Recargo nocturno', description: null, category: 'Surcharge', allowMultiple: false }],
  applied: [] };
const CHARGES = { operationId: OPERATION_ID, services: [SERVICE] };

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockUuid = 0;
  resetFlightReportForTests();
  mockContext.mockResolvedValue({ sessionId: SESSION_ID, accessToken: 'header.payload.signature',
    session: { actor: { accountId: ACCOUNT_ID } } });
  mockRegisterDevice.mockResolvedValue({ installationId: INSTALLATION_ID });
  mockWriteCache.mockResolvedValue('written');
  mockReadCache.mockResolvedValue({ kind: 'current', value: null });
  mockRejectSession.mockResolvedValue(true);
});

describe('ramp service charges', () => {
  it('reads the charges and keeps a cached copy for offline use', async () => {
    mockApi.getRampOperationCharges.mockResolvedValue(CHARGES);
    await expect(getRampOperationCharges(OPERATION_ID)).resolves.toEqual({ charges: CHARGES, fromCache: false });
    expect(mockWriteCache).toHaveBeenCalledWith(SESSION_ID, ACCOUNT_ID, OPERATION_ID, JSON.stringify(CHARGES));
    expect(mockApi.getRampOperationCharges).toHaveBeenCalledWith(OPERATION_ID, INSTALLATION_ID, { signal: undefined });
  });

  it('falls back to the cached copy only when the network is unavailable', async () => {
    mockApi.getRampOperationCharges.mockRejectedValue({ mockNetwork: true });
    mockReadCache.mockResolvedValue({ kind: 'current', value: JSON.stringify(CHARGES) });
    await expect(getRampOperationCharges(OPERATION_ID)).resolves.toEqual({ charges: CHARGES, fromCache: true });

    mockApi.getRampOperationCharges.mockRejectedValue(new ElevantApiError(404));
    await expect(getRampOperationCharges(OPERATION_ID)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('saves the mark in the queue, sends it with its key and device and answers the confirmed charges', async () => {
    const applied = { ...SERVICE, applied: [{ id: '75000000-0000-4000-8000-000000000001', chargeId: CHARGE_ID,
      code: 'NIGHT', name: 'Recargo nocturno', appliedAt: '2026-10-08T03:10:00.000+00:00' }] };
    mockApi.applyRampServiceCharge.mockResolvedValue({ receiptId: RECEIPT_ID, service: applied });
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply', { chargeName: 'Recargo nocturno' }))
      .resolves.toEqual(applied);
    expect(mockApi.applyRampServiceCharge).toHaveBeenCalledWith(OPERATION_ID, SERVICE_ID,
      { chargeId: CHARGE_ID, action: 'Apply' }, INSTALLATION_ID, IDEMPOTENCY_KEY);
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
  });

  it('without signal the mark waits on the device (null) and goes out later with the same key', async () => {
    mockApi.applyRampServiceCharge.mockRejectedValue({ mockNetwork: true });
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply')).resolves.toBeNull();
    const [queued] = await readFlightReportOutbox(ACCOUNT_ID);
    expect(queued).toMatchObject({ idempotencyKey: IDEMPOTENCY_KEY, state: 'pending',
      command: { kind: 'serviceCharge', serviceId: SERVICE_ID, chargeId: CHARGE_ID, action: 'Apply' } });

    mockApi.applyRampServiceCharge.mockRejectedValue(new ElevantApiError(409));
    // The waiting mark goes first; this one is refused by ELEVANT and leaves the queue with its error.
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Remove'))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(mockApi.applyRampServiceCharge.mock.calls.map(call => call[4]))
      .toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY, '50000000-0000-4000-8000-000000000002']);
  });

  it('rejects invalid ids or actions before touching storage', async () => {
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, 'nope', 'Apply')).rejects.toMatchObject({ code: 'request_failed' });
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Delete')).rejects.toMatchObject({ code: 'request_failed' });
    expect(await readFlightReportOutbox(ACCOUNT_ID)).toEqual([]);
  });
});
