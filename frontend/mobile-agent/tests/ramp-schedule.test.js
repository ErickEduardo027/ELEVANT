const mockApi = { getOwnRampSchedule: jest.fn() };
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
const { getOwnSchedule, scheduleRange } = require('../src/services/ramp-schedule');
const session = { sessionId: 's-1', accessToken: 'token', session: { actor: { accountId: 'a-1' } } };
const schedule = { rampProfileId: 'p-1', agentName: 'Ana Ramp', from: '2026-11-03', to: '2026-11-16', shifts: [], documents: [] };

beforeEach(() => { jest.clearAllMocks(); mockContext.mockResolvedValue(session); mockReject.mockResolvedValue(true); });

test('reads fourteen days from today under the current session', async () => {
  mockApi.getOwnRampSchedule.mockResolvedValue(schedule);
  await expect(getOwnSchedule(undefined, new Date(2026, 10, 3))).resolves.toEqual(schedule);
  expect(mockApi.getOwnRampSchedule).toHaveBeenCalledWith('2026-11-03', '2026-11-16', { signal: undefined });
  expect(scheduleRange(new Date(2026, 11, 25))).toEqual({ from: '2026-12-25', to: '2027-01-07' });
});

test('a revoked session is cleared and reported', async () => {
  mockApi.getOwnRampSchedule.mockRejectedValue(new ElevantApiError({ status: 403 }));
  await expect(getOwnSchedule()).rejects.toMatchObject({ code: 'forbidden' });
  expect(mockReject).toHaveBeenCalledWith('s-1');
});

test('a session that changed mid-request is cancelled', async () => {
  mockApi.getOwnRampSchedule.mockResolvedValue(schedule);
  mockContext.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, sessionId: 's-2' });
  await expect(getOwnSchedule()).rejects.toMatchObject({ code: 'cancelled' });
});
