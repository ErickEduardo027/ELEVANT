const mockRegisterMobileDevice = jest.fn();
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {},
}));

jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => ({ registerMobileDevice: (...args) => mockRegisterMobileDevice(...args) })),
}));
jest.mock('../src/storage/mobile-session', () => ({
  readOrCreateMobileInstallationId: jest.fn(async () => '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'),
}));

const { AppState, Platform } = require('react-native');
const { layoutClassFor } = require('../src/utils/layout-class');
const { dateTimeFormat, formatLocalDateTime } = require('../src/utils/date-format');
const { startForegroundInterval } = require('../src/utils/foreground-interval');
const { registerCurrentMobileDevice } = require('../src/services/mobile-device');

test('classifies widths like Android window size classes', () => {
  expect(layoutClassFor(390)).toBe('compact');
  expect(layoutClassFor(600)).toBe('medium');
  expect(layoutClassFor(899)).toBe('medium');
  expect(layoutClassFor(900)).toBe('expanded');
  expect(layoutClassFor(1280)).toBe('expanded');
});

test('reuses one formatter per locale and options', () => {
  const first = dateTimeFormat({ hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const second = dateTimeFormat({ hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  expect(second).toBe(first);
  expect(dateTimeFormat({ hour: '2-digit', timeZone: 'UTC' })).not.toBe(first);
  expect(formatLocalDateTime('invalid')).toBe('—');
  expect(formatLocalDateTime(null)).toBe('—');
});

describe('foreground polling', () => {
  let listener;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
      listener = handler;
      return { remove: jest.fn() };
    });
    Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => 'active' });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('pauses in background and refreshes once when the app returns', () => {
    const task = jest.fn();
    const stop = startForegroundInterval(task, 1_000);
    jest.advanceTimersByTime(2_000);
    expect(task).toHaveBeenCalledTimes(2);

    listener('background');
    jest.advanceTimersByTime(5_000);
    expect(task).toHaveBeenCalledTimes(2);

    listener('active');
    expect(task).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1_000);
    expect(task).toHaveBeenCalledTimes(4);

    stop();
    jest.advanceTimersByTime(5_000);
    expect(task).toHaveBeenCalledTimes(4);
  });
});

describe('device registration reuse', () => {
  beforeEach(() => {
    mockRegisterMobileDevice.mockReset();
    mockRegisterMobileDevice.mockImplementation(async (request) => ({
      installationId: request.installationId, platform: Platform.OS === 'ios' ? 'Ios' : 'Android',
    }));
  });

  test('reuses a confirmed registration only for opted-in reads of the same session', async () => {
    await registerCurrentMobileDevice({ accessToken: 'token-a' });
    await registerCurrentMobileDevice({ accessToken: 'token-a' }, { reuseForSession: true });
    expect(mockRegisterMobileDevice).toHaveBeenCalledTimes(1);

    await registerCurrentMobileDevice({ accessToken: 'token-a' });
    expect(mockRegisterMobileDevice).toHaveBeenCalledTimes(2);

    await registerCurrentMobileDevice({ accessToken: 'token-b' }, { reuseForSession: true });
    expect(mockRegisterMobileDevice).toHaveBeenCalledTimes(3);
  });
});
