const mockApi = { getOwnRampCoverage: jest.fn() };
const mockContext = jest.fn();
const mockReject = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ status }) { super(`API ${status}`); this.kind = 'http'; this.status = status; }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: (...args) => mockReject(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { getOwnCoverage } = require('../src/services/ramp-coverage');

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId: 'session-a', accessToken: 'token', session: { actor: { accountId: 'a' } } });
  mockReject.mockResolvedValue(true);
});

test('reads the own coverage through the authenticated API and ends a rejected session', async () => {
  const coverage = { coverages: [{ id: 'c1', stationCode: 'PUJ', terminalCode: 'A', stands: ['A01', 'A02'],
    startsAt: '2026-11-04T10:00:00Z', endsAt: '2026-11-04T18:00:00Z', partner: null, vehicleCode: null, isReinforcement: false }] };
  mockApi.getOwnRampCoverage.mockResolvedValueOnce(coverage);
  await expect(getOwnCoverage()).resolves.toEqual(coverage);
  mockApi.getOwnRampCoverage.mockRejectedValueOnce(new ElevantApiError({ status: 403 }));
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'forbidden' });
  expect(mockReject).toHaveBeenCalledWith('session-a');
});
