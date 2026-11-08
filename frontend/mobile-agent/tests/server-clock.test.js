// 3-N18: the tablet corrects its clock with the `Date` header of ELEVANT's answers and keeps the offset on the device,
// so «AHORA», the start, the services, the damages and the incidents carry ELEVANT's time even without signal.
const mockStore = new Map();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async key => { mockStore.delete(key); }),
}));
jest.mock('../src/storage/mobile-session', () => ({ readValidMobileAccessToken: jest.fn(async () => undefined) }));
// The shared client only needs to call the fetch the tablet gives it.
jest.mock('@elevant/api-client', () => ({
  createElevantApiClient: options => ({ getCurrentSession: () => options.fetch('https://elevant.test/api/v1/session', {}) }),
}));

const clock = require('../src/synchronization/server-clock');
const { createMobileAgentApiClient } = require('../src/config/elevant-api');

/** The tablet runs eleven minutes ahead of ELEVANT. */
const DEVICE_NOW = Date.parse('2026-11-07T20:11:00.000Z');
const SERVER_NOW = Date.parse('2026-11-07T20:00:00.000Z');
const header = ms => new Date(ms).toUTCString();
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  mockStore.clear();
  clock.resetServerClockForTests();
  jest.useFakeTimers({ now: DEVICE_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});

afterEach(() => { jest.useRealTimers(); });

test('a tablet eleven minutes ahead captures ELEVANT’s time and is told to check its clock', () => {
  expect(clock.clockSkewWarning()).toBeNull();
  // A 200 ms round trip; the one-second header is read at its middle.
  expect(clock.observeServerDate(header(SERVER_NOW), DEVICE_NOW - 200, DEVICE_NOW)).toBe(true);
  expect(clock.serverNow().toISOString()).toBe(new Date(SERVER_NOW + 600).toISOString());
  expect(clock.clockOffsetMs()).toBe(SERVER_NOW + 600 - DEVICE_NOW);
  expect(clock.clockSkewWarning()).toBe('La hora de esta tablet difiere 11 min de ELEVANT; los registros se corrigen '
    + 'solos. Revisa la hora del equipo.');
});

test('a sample with a slow round trip says too little and is ignored', () => {
  expect(clock.observeServerDate(header(SERVER_NOW), DEVICE_NOW - 8_000, DEVICE_NOW)).toBe(false);
  expect(clock.observeServerDate('not a date', DEVICE_NOW - 100, DEVICE_NOW)).toBe(false);
  expect(clock.observeServerDate(null, DEVICE_NOW - 100, DEVICE_NOW)).toBe(false);
  expect(clock.serverNow().getTime()).toBe(DEVICE_NOW);
});

test('the offset survives a restart without signal', async () => {
  clock.observeServerDate(header(SERVER_NOW), DEVICE_NOW - 200, DEVICE_NOW);
  await settle();
  clock.resetServerClockForTests();
  expect(clock.serverNow().getTime()).toBe(DEVICE_NOW);
  await clock.loadServerClock();
  expect(clock.serverNow().toISOString()).toBe(new Date(SERVER_NOW + 600).toISOString());
});

test('within the server’s two-minute tolerance there is no warning', () => {
  expect(clock.clockSkewWarning(90_000)).toBeNull();
  expect(clock.clockSkewWarning(-120_000)).toBeNull();
  expect(clock.clockSkewWarning(-180_000)).toBe('La hora de esta tablet difiere 3 min de ELEVANT; los registros se '
    + 'corrigen solos. Revisa la hora del equipo.');
});

test('every answer of ELEVANT corrects the clock', async () => {
  const fetch = jest.fn(async () => ({
    ok: true, status: 200,
    headers: { get: name => (name.toLowerCase() === 'date' ? header(SERVER_NOW)
      : name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => '{}',
  }));
  const client = createMobileAgentApiClient({ baseUrl: 'https://elevant.test', fetch, getAccessToken: async () => 'token' });
  await client.getCurrentSession().catch(() => undefined);
  expect(fetch).toHaveBeenCalled();
  expect(clock.serverNow().toISOString()).toBe(new Date(SERVER_NOW + 500).toISOString());
});
