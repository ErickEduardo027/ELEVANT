const mockLeases = [];
const mockOptions = [];
const mockListeners = [];
const mockContext = jest.fn();
const mockPut = jest.fn().mockResolvedValue(undefined);
const mockClient = jest.fn(() => ({ putOperationalPresence: mockPut }));
jest.mock('@elevant/api-client', () => ({ createPresenceLease: jest.fn(options => {
  mockOptions.push(options);
  const lease = { start: jest.fn(), pause: jest.fn().mockResolvedValue(undefined), resume: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined), activity: jest.fn() };
  mockLeases.push(lease);
  return lease;
}) }), { virtual: true });
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'presence-client-' + mockOptions.length) }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn((_, listener) => {
  mockListeners.push(listener); return { remove: jest.fn() };
}) } }));
jest.mock('../src/services/mobile-auth', () => ({ getMobileSessionRequestContext: () => mockContext() }));
jest.mock('../src/config/elevant-api', () => ({ createMobileAgentApiClient: (...args) => mockClient(...args) }));
jest.mock('../src/services/mobile-service-error', () => ({ MobileServiceError: class extends Error {
  constructor(code) { super(code); this.code = code; }
} }));

const { AppState } = require('react-native');
const { MobileServiceError } = require('../src/services/mobile-service-error');
const service = require('../src/services/mobile-presence');
const context = (id = 'a') => ({ sessionId: 'session-' + id, accessToken: 'token-' + id,
  session: { actor: { accountId: 'account-' + id } } });

beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockLeases.length = 0; mockOptions.length = 0; mockListeners.length = 0;
  AppState.currentState = 'active';
  mockContext.mockResolvedValue(context());
});
afterEach(() => { service.stopMobilePresence(); jest.useRealTimers(); });

test('uses real input and suspends/restarts the same lease with AppState', async () => {
  service.startMobilePresence();
  await service.refreshMobilePresenceSession();
  const lease = mockLeases[0];
  expect(lease.start).toHaveBeenCalledTimes(1);
  service.recordMobilePresenceActivity();
  expect(lease.activity).toHaveBeenCalledTimes(1);
  AppState.currentState = 'background'; mockListeners[0]('background');
  expect(lease.pause).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(90_000);
  expect(mockLeases).toHaveLength(1);
  AppState.currentState = 'active'; mockListeners[0]('active');
  await service.refreshMobilePresenceSession();
  expect(lease.resume).toHaveBeenCalled();
  expect(mockLeases).toHaveLength(1);
});

test('does not attribute activity during uncertain storage and isolates a replacement account', async () => {
  service.startMobilePresence();
  await service.refreshMobilePresenceSession();
  const old = mockLeases[0];
  mockContext.mockRejectedValueOnce(new MobileServiceError('storage_unavailable'));
  await service.refreshMobilePresenceSession();
  service.recordMobilePresenceActivity();
  expect(old.activity).not.toHaveBeenCalled();
  expect(old.close).not.toHaveBeenCalled();
  mockContext.mockResolvedValue(context());
  await service.refreshMobilePresenceSession();
  mockContext.mockResolvedValue(context('b'));
  await expect(mockOptions[0].write({ mode: 'foreground', sequence: 1, activityObserved: true }))
    .rejects.toMatchObject({ status: 409 });
  expect(mockPut).not.toHaveBeenCalled();
  await service.refreshMobilePresenceSession();
  expect(old.close).toHaveBeenCalledTimes(1);
  expect(mockLeases).toHaveLength(2);
  expect(mockClient.mock.calls[1][0].getAccessToken()).toBe('token-b');
  service.recordMobilePresenceActivity();
  expect(mockLeases[1].activity).toHaveBeenCalledTimes(1);
  mockContext.mockRejectedValueOnce(new MobileServiceError('unauthenticated'));
  await service.refreshMobilePresenceSession();
  expect(mockLeases[1].close).toHaveBeenCalledTimes(1);
});
