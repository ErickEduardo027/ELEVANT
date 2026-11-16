const mockStore = new Map();
const mockApi = { getRampAircraftTypes: jest.fn() };
const mockContext = jest.fn();
const mockReject = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async key => { mockStore.delete(key); }),
}));
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ status }) { super(`API ${status}`); this.kind = 'http'; this.status = status; }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.message === 'offline'),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => {
  class MobileServiceError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  return {
    MobileServiceError,
    getMobileSessionRequestContext: (...args) => mockContext(...args),
    rejectMobileSessionRequest: (...args) => mockReject(...args),
  };
});

const { ElevantApiError } = require('@elevant/api-client');
const { aircraftTypeLabel, getRampAircraftTypes } = require('../src/services/aircraft-types');

const accountId = '20000000-0000-4000-8000-000000000001';
const types = [
  { id: '60000000-0000-4000-8000-000000000001', icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320-200' },
  { id: '60000000-0000-4000-8000-000000000002', icaoCode: 'B738', iataCode: null, manufacturer: 'Boeing', model: '737-800' },
];

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId: 's1', accessToken: 'token', session: { actor: { accountId } } });
  mockReject.mockResolvedValue(true);
});

test('reads the active types and keeps a copy per account for the ramp without signal (3-B)', async () => {
  mockApi.getRampAircraftTypes.mockResolvedValueOnce({ aircraftTypes: types });
  await expect(getRampAircraftTypes()).resolves.toEqual({ types, available: true, fromCache: false });
  expect(JSON.parse(mockStore.get(`elevant.rampAircraftTypes.v1.${accountId}`))).toEqual(types);

  mockApi.getRampAircraftTypes.mockRejectedValueOnce(new Error('offline'));
  await expect(getRampAircraftTypes()).resolves.toEqual({ types, available: true, fromCache: true });
  expect(aircraftTypeLabel(types[0])).toBe('Airbus A320-200 · A320');
});

test('without a copy and without signal, or against an older server, there is no catalog', async () => {
  mockApi.getRampAircraftTypes.mockRejectedValueOnce(new Error('offline'));
  await expect(getRampAircraftTypes()).resolves.toEqual({ types: [], available: false, fromCache: false });
  // A server before 3-B has no endpoint: the type stays read-only as it always was.
  mockApi.getRampAircraftTypes.mockRejectedValueOnce(new ElevantApiError({ status: 404 }));
  await expect(getRampAircraftTypes()).resolves.toEqual({ types: [], available: false, fromCache: false });
  // A corrupted copy is never offered.
  mockStore.set(`elevant.rampAircraftTypes.v1.${accountId}`, JSON.stringify([{ id: 'x' }]));
  mockApi.getRampAircraftTypes.mockRejectedValueOnce(new Error('offline'));
  await expect(getRampAircraftTypes()).resolves.toMatchObject({ available: false });
});

test('a revoked session ends the read and an unexpected failure is not hidden by the copy', async () => {
  mockApi.getRampAircraftTypes.mockRejectedValueOnce(new ElevantApiError({ status: 401 }));
  await expect(getRampAircraftTypes()).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockReject).toHaveBeenCalledWith('s1');
  mockApi.getRampAircraftTypes.mockRejectedValueOnce(new ElevantApiError({ status: 500 }));
  await expect(getRampAircraftTypes()).rejects.toBeTruthy();
});
