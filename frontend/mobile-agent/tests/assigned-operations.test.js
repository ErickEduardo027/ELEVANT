const mockApi = { getRampAssignedOperations: jest.fn() };
const mockContext = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {},
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('../src/storage/mobile-session', () => ({
  assignedOperationsCacheKey: accountId => `cache.${accountId}`,
  readAssignedOperationsCacheIfCurrent: jest.fn(async () => ({ kind: 'current', value: null })),
  removeAssignedOperationsCacheIfCurrent: jest.fn(async () => 'current'),
  writeAssignedOperationsCacheIfCurrent: jest.fn(async () => 'current'),
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: jest.fn(async () => true),
  MobileServiceError: class MobileServiceError extends Error {
    constructor(code) { super(code); this.code = code; }
  },
}));

const { getAssignedOperations } = require('../src/services/assigned-operations');

const stationId = '20000000-0000-4000-8000-000000000003';
const operationId = '70000000-0000-4000-8000-000000000005';
const operation = {
  assignment: { id: '71000000-0000-4000-8000-000000000001', agentId: '72000000-0000-4000-8000-000000000001',
    position: null, assignmentRole: 'primary', assignedAt: '2026-11-04T12:00:00.000Z' },
  operation: { id: operationId, status: 'InProgress', plannedStartAt: null, plannedEndAt: null,
    actualStartAt: '2026-11-04T15:00:00.000Z', actualEndAt: null, passengersIn: 152, passengersOut: 149, mtowKg: 77000 },
  turnaround: { id: '73000000-0000-4000-8000-000000000001', operationCode: 'DEV-TAT-0001', operationDate: '2026-11-04',
    status: 'InProgress', station: { id: stationId, code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
    airline: { id: '74000000-0000-4000-8000-000000000001', iataCode: 'DM', icaoCode: 'DMA', name: 'Demo Airlines' },
    aircraft: null, stand: null, arrival: null, departure: null },
  services: [],
  review: null,
  milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-04T15:05:00.000Z' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId: 's1', accessToken: 'token',
    session: { actor: { accountId: 'a1', stationScopes: [{ stationId }] } } });
});

test('accepts the Flight Report fields the API now returns (ADR-0031)', async () => {
  mockApi.getRampAssignedOperations.mockResolvedValue({ operations: [operation] });
  const snapshot = await getAssignedOperations();
  expect(snapshot.source).toBe('network');
  expect(snapshot.operations[0].milestones).toEqual([{ code: 'BLOCK_ON', actualAt: '2026-11-04T15:05:00.000Z' }]);
  expect(snapshot.operations[0].operation.passengersIn).toBe(152);
});

test('still rejects impossible flight data', async () => {
  mockApi.getRampAssignedOperations.mockResolvedValue({ operations: [{ ...operation,
    operation: { ...operation.operation, passengersIn: 5000 } }] });
  await expect(getAssignedOperations()).rejects.toThrow();
});
