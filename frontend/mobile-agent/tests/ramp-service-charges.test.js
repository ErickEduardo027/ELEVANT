const mockApi = { getRampOperationCharges: jest.fn(), applyRampServiceCharge: jest.fn() };
const mockContext = jest.fn();
const mockRegisterDevice = jest.fn();
const mockGetCommand = jest.fn();
const mockRemoveCommand = jest.fn();
const mockReadCache = jest.fn();
const mockWriteCache = jest.fn();
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
  getOrCreateRampServiceChargeCommandIfCurrent: (...args) => mockGetCommand(...args),
  removeRampServiceChargeCommandIfCurrent: (...args) => mockRemoveCommand(...args),
  readRampOperationChargesCacheIfCurrent: (...args) => mockReadCache(...args),
  writeRampOperationChargesCacheIfCurrent: (...args) => mockWriteCache(...args),
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

const { ElevantApiError } = require('@elevant/api-client');
const { changeRampServiceCharge, getRampOperationCharges } = require('../src/services/ramp-service-charges');

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '30000000-0000-4000-8000-000000000001';
const INSTALLATION_ID = '40000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '50000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const SERVICE_ID = '73000000-0000-4000-8000-000000000001';
const CHARGE_ID = '74000000-0000-4000-8000-000000000001';
const SERVICE = { serviceId: SERVICE_ID, canEdit: true,
  available: [{ id: CHARGE_ID, code: 'NIGHT', name: 'Recargo nocturno', description: null, category: 'Surcharge', allowMultiple: false }],
  applied: [] };
const CHARGES = { operationId: OPERATION_ID, services: [SERVICE] };

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId: SESSION_ID, accessToken: 'header.payload.signature',
    session: { actor: { accountId: ACCOUNT_ID } } });
  mockGetCommand.mockResolvedValue({ kind: 'current', idempotencyKey: IDEMPOTENCY_KEY, payload: '{}' });
  mockRemoveCommand.mockResolvedValue('removed');
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
  });

  it('falls back to the cached copy only when the network is unavailable', async () => {
    mockApi.getRampOperationCharges.mockRejectedValue({ mockNetwork: true });
    mockReadCache.mockResolvedValue({ kind: 'current', value: JSON.stringify(CHARGES) });
    await expect(getRampOperationCharges(OPERATION_ID)).resolves.toEqual({ charges: CHARGES, fromCache: true });

    mockApi.getRampOperationCharges.mockRejectedValue(new ElevantApiError(404));
    await expect(getRampOperationCharges(OPERATION_ID)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('sends a charge with the reserved key and device, then clears the command', async () => {
    const applied = { ...SERVICE, applied: [{ id: '75000000-0000-4000-8000-000000000001', chargeId: CHARGE_ID,
      code: 'NIGHT', name: 'Recargo nocturno', appliedAt: '2026-10-08T03:10:00.000+00:00' }] };
    mockApi.applyRampServiceCharge.mockResolvedValue({ receiptId: IDEMPOTENCY_KEY, service: applied });
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply')).resolves.toEqual(applied);
    expect(mockGetCommand).toHaveBeenCalledWith(SESSION_ID, ACCOUNT_ID, OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply',
      JSON.stringify({ chargeId: CHARGE_ID, action: 'Apply' }));
    expect(mockApi.applyRampServiceCharge).toHaveBeenCalledWith(OPERATION_ID, SERVICE_ID,
      { chargeId: CHARGE_ID, action: 'Apply' }, INSTALLATION_ID, IDEMPOTENCY_KEY, { signal: undefined });
    expect(mockRemoveCommand).toHaveBeenCalledWith(SESSION_ID, ACCOUNT_ID, OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply', IDEMPOTENCY_KEY);
  });

  it('keeps the key after a lost response so a retry replays the same command', async () => {
    mockApi.applyRampServiceCharge.mockRejectedValue({ mockNetwork: true });
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply'))
      .rejects.toMatchObject({ code: 'network_unavailable' });
    expect(mockRemoveCommand).not.toHaveBeenCalled();

    mockApi.applyRampServiceCharge.mockRejectedValue(new ElevantApiError(409));
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply'))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(mockRemoveCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid ids or actions before touching storage', async () => {
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, 'nope', 'Apply')).rejects.toMatchObject({ code: 'request_failed' });
    await expect(changeRampServiceCharge(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Delete')).rejects.toMatchObject({ code: 'request_failed' });
    expect(mockGetCommand).not.toHaveBeenCalled();
  });
});
