const mockApi = { getRampIncidents: jest.fn(), reportRampIncident: jest.fn() };
const mockContext = jest.fn();
const mockRegister = jest.fn();
const mockReject = jest.fn();
let mockItems = [];

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind = 'http', status }) {
      super(`API ${status}`);
      this.kind = kind;
      this.status = status;
    }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readRampIncidentOutboxIfCurrent: jest.fn(async () => ({ kind: 'current', items: mockItems })),
  reserveRampIncidentOutboxItemIfCurrent: jest.fn(async (_session, _account, _operation, payload) => {
    mockItems.push({
      idempotencyKey: '82000000-0000-4000-8000-000000000031',
      payload,
      createdAt: '2026-09-23T12:00:00Z',
      state: 'pending',
    });
    return { kind: 'current', items: mockItems };
  }),
  updateRampIncidentOutboxItemIfCurrent: jest.fn(async (_session, _account, _operation, key, action) => {
    mockItems = action === 'remove'
      ? mockItems.filter(item => item.idempotencyKey !== key)
      : mockItems.map(item => item.idempotencyKey === key ? { ...item, state: 'blocked' } : item);
    return { kind: 'current', items: mockItems };
  }),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: (...args) => mockReject(...args),
  MobileServiceError: jest.requireActual('../src/services/mobile-service-error').MobileServiceError,
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegister(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { loadRampIncidentCenter, reserveRampIncident } = require('../src/services/ramp-incidents');
const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const OPERATION = '70000000-0000-4000-8000-000000000005';
const KEY = '82000000-0000-4000-8000-000000000031';
const report = {
  incidentType: 'Safety',
  severity: 'High',
  description: 'Equipo inmovilizado',
  occurredAt: '2026-09-23T12:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockItems = [];
  mockContext.mockResolvedValue({
    sessionId: '30000000-0000-4000-8000-000000000001',
    accessToken: 'test-token',
    session: { actor: { accountId: ACCOUNT } },
  });
  mockReject.mockResolvedValue(true);
  mockRegister.mockResolvedValue({ installationId: '81000000-0000-4000-8000-000000000001' });
  mockApi.getRampIncidents.mockResolvedValue({ operationId: OPERATION, incidents: [] });
  mockApi.reportRampIncident.mockResolvedValue({
    receiptId: '83000000-0000-4000-8000-000000000031',
    operationId: OPERATION,
    incidentId: KEY,
    status: 'Open',
    occurredAt: report.occurredAt,
    reportedAt: '2026-09-23T12:01:00Z',
  });
});

test('reserves the complete report before any network request', async () => {
  await expect(reserveRampIncident(OPERATION, report)).resolves.toMatchObject([
    { idempotencyKey: KEY, request: report, state: 'pending' },
  ]);
  expect(mockRegister).not.toHaveBeenCalled();
  expect(mockApi.reportRampIncident).not.toHaveBeenCalled();
});

test('offline load preserves the report without registering or sending', async () => {
  await reserveRampIncident(OPERATION, report);
  mockApi.getRampIncidents.mockRejectedValue({ mockNetwork: true });
  const result = await loadRampIncidentCenter(OPERATION);
  expect(result.online).toBe(false);
  expect(result.outbox).toHaveLength(1);
  expect(mockRegister).not.toHaveBeenCalled();
  expect(mockApi.reportRampIncident).not.toHaveBeenCalled();
});

test('replays the frozen key and removes only the confirmed report', async () => {
  await reserveRampIncident(OPERATION, report);
  const result = await loadRampIncidentCenter(OPERATION);
  expect(result.sent).toBe(1);
  expect(result.outbox).toEqual([]);
  expect(mockApi.reportRampIncident).toHaveBeenCalledWith(
    OPERATION,
    report,
    '81000000-0000-4000-8000-000000000001',
    KEY,
    { signal: undefined },
  );
});

test('reconciles a persisted report before replaying an uncertain response', async () => {
  await reserveRampIncident(OPERATION, report);
  mockApi.getRampIncidents.mockResolvedValue({ operationId: OPERATION, incidents: [{
    id: KEY, ...report, status: 'Open', reportedAt: '2026-09-23T12:01:00Z',
  }] });
  const result = await loadRampIncidentCenter(OPERATION);
  expect(result.outbox).toEqual([]);
  expect(mockApi.reportRampIncident).not.toHaveBeenCalled();
});

test('keeps a deterministically rejected safety report visible as blocked', async () => {
  await reserveRampIncident(OPERATION, report);
  mockApi.reportRampIncident.mockRejectedValue(new ElevantApiError({ status: 409 }));
  const result = await loadRampIncidentCenter(OPERATION);
  expect(result.outbox).toMatchObject([{ idempotencyKey: KEY, state: 'blocked' }]);
  expect(result.issue.code).toBe('conflict');
});

test('keeps the exact command pending after an uncertain server failure', async () => {
  await reserveRampIncident(OPERATION, report);
  mockApi.reportRampIncident.mockRejectedValue(new ElevantApiError({ status: 503 }));
  const result = await loadRampIncidentCenter(OPERATION);
  expect(result.outbox).toMatchObject([{ idempotencyKey: KEY, state: 'pending', request: report }]);
  expect(result.issue.retryable).toBe(true);
});

test('revoked session cannot expose queued reports to a new account', async () => {
  await reserveRampIncident(OPERATION, report);
  mockApi.getRampIncidents.mockRejectedValue(new ElevantApiError({ status: 403 }));
  await expect(loadRampIncidentCenter(OPERATION)).rejects.toMatchObject({ code: 'forbidden' });
  expect(mockReject).toHaveBeenCalled();
  expect(mockApi.reportRampIncident).not.toHaveBeenCalled();
});
