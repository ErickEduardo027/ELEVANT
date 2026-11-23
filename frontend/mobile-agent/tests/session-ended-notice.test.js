// N6 (D-N6): when the tablet ends a session its agent did not sign out of, every screen says so until the agent is back
// on the access screen, with ENTRAR DE NUEVO; a sign-out on purpose is no news. The root layout, the storage, the
// session service and the server clock are real; ELEVANT's session endpoints are a small fake.
const React = require('react');
const renderer = require('react-test-renderer');

const mockAsyncData = new Map();
const mockSecureData = new Map();
let mockUuidCounter = 0;
let mockPathname = '/home';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockAsyncData.keys()]),
    getItem: jest.fn(async key => mockAsyncData.get(key) ?? null),
    setItem: jest.fn(async (key, value) => { mockAsyncData.set(key, value); }),
    removeItem: jest.fn(async key => { mockAsyncData.delete(key); }),
    multiRemove: jest.fn(async keys => { keys.forEach(key => mockAsyncData.delete(key)); }),
  },
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async key => mockSecureData.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => { mockSecureData.set(key, value); }),
  deleteItemAsync: jest.fn(async key => { mockSecureData.delete(key); }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    mockUuidCounter += 1;
    return `10000000-0000-4000-8000-${String(mockUuidCounter).padStart(12, '0')}`;
  }),
}));
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind = 'http', status, code }) {
      super(`API ${status}`);
      this.kind = kind;
      this.status = status;
      this.code = code;
    }
  },
  SessionPortal: { ramp_mobile_app: 'ramp_mobile_app' },
  SessionOrganizationType: { aviam_operator: 'aviam_operator' },
  SessionMembershipKind: { internal_staff: 'internal_staff' },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(options => mockElevant.client(options ?? {})),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('expo-router', () => {
  const { Fragment, createElement } = require('react');
  const Stack = ({ children }) => createElement(Fragment, null, children);
  Stack.Screen = () => null;
  return {
    Stack,
    usePathname: () => mockPathname,
    router: { back: jest.fn(), canDismiss: jest.fn(() => true), dismissAll: jest.fn(), push: jest.fn(), replace: jest.fn() },
  };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
// The layout's background work is not under test here.
jest.mock('../src/services/mobile-presence', () => ({
  startMobilePresence: jest.fn(), stopMobilePresence: jest.fn(), refreshMobilePresenceSession: jest.fn(async () => {}),
  recordMobilePresenceActivity: jest.fn(),
}));
jest.mock('../src/services/mobile-change-feed', () => ({ startMobileChangeFeed: jest.fn(), stopMobileChangeFeed: jest.fn() }));
jest.mock('../src/components/flight-report/connection-badge', () => ({ startFlightReportSync: jest.fn(() => () => {}) }));
jest.mock('../src/services/flight-report', () => ({ refreshFlightReportQueue: jest.fn(async () => {}) }));

const { router } = require('expo-router');
const { ElevantApiError } = require('@elevant/api-client');
const {
  getMobileSession,
  loginMobileAgent,
  logoutMobileAgent,
  resetMobileSessionRenewalForTests,
} = require('../src/services/mobile-auth');
const { forgetConfirmedMobileDevice } = require('../src/services/mobile-device');
const { getOwnCoverage } = require('../src/services/ramp-coverage');
const { resetServerClockForTests } = require('../src/synchronization/server-clock');
const RootLayout = require('../src/app/_layout').default;

const ACCOUNT = '40000000-0000-4000-8000-000000000002';
const MINUTE = 60_000;
const actor = {
  accountId: ACCOUNT,
  email: 'ramp.agent@dev.elevant.test',
  displayName: 'Riley Ramp',
  roles: [{ roleId: '41000000-0000-4000-8000-000000000002', code: 'RAMP_AGENT', name: 'Agente de rampa',
    portal: 'ramp_mobile_app', userType: 'ramp_agent' }],
  memberships: [{ membershipId: '42000000-0000-4000-8000-000000000002',
    organizationId: '10000000-0000-4000-8000-000000000001', organizationCode: 'AVIAM', organizationName: 'AVIAM',
    organizationType: 'aviam_operator', kind: 'internal_staff' }],
  stationScopes: [{ stationId: '20000000-0000-4000-8000-000000000003', stationCode: 'PUJ' }],
};

const base64Url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => `${base64Url({ alg: 'HS256', typ: 'at+jwt' })}.${base64Url(claims)}.c2lnbmF0dXJl`;

/**
 * ELEVANT's session endpoints. Its access tokens carry no `auth_time` (an API before ADR-0046), so the session ends with
 * its access token after 15 minutes; the account can also lose its access to the app (403).
 */
const mockElevant = {
  reset() {
    Object.assign(this, { accepted: new Set(), sequence: 0, forbidden: false });
  },
  client(options) {
    const authorized = async () => {
      if (!this.accepted.has(await options.getAccessToken?.())) throw new ElevantApiError({ status: 401 });
      if (this.forbidden) throw new ElevantApiError({ status: 403 });
    };
    return {
      createSession: async () => {
        this.sequence += 1;
        const now = Math.floor(Date.now() / 1000);
        const accessToken = jwt({ sub: ACCOUNT, jti: `jti-${this.sequence}`, iat: now, exp: now + 900 });
        this.accepted.add(accessToken);
        return { accessToken, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 15 * MINUTE).toISOString(), actor,
          refreshToken: `refresh-${String(this.sequence).padStart(3, '0')}-${'r'.repeat(32)}`,
          refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * MINUTE).toISOString() };
      },
      getCurrentSession: async () => {
        await authorized();
        return { actor };
      },
      registerMobileDevice: async request => {
        await authorized();
        return { installationId: request.installationId, platform: request.platform, appVersion: '1.0.0',
          lastSeenAt: new Date().toISOString() };
      },
      getOwnRampCoverage: async () => {
        await authorized();
        return { coverages: [] };
      },
      releaseMobileDevice: async () => ({ released: true }),
      endSession: async () => undefined,
    };
  },
};

const advance = milliseconds => jest.setSystemTime(Date.now() + milliseconds);
const signIn = () => loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');

async function renderLayout() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(RootLayout)); });
  return tree;
}

/** The agent moves to another screen: the layout renders again with its path. */
async function navigate(tree, pathname) {
  mockPathname = pathname;
  await renderer.act(async () => { tree.update(React.createElement(RootLayout)); });
}

function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}

const signInAgain = tree =>
  tree.root.findAll(node => node.props?.title === 'ENTRAR DE NUEVO' && typeof node.props.onPress === 'function')[0];

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-16T20:00:00.000Z'),
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  jest.clearAllMocks();
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  mockPathname = '/home';
  mockElevant.reset();
  resetServerClockForTests();
  resetMobileSessionRenewalForTests();
  forgetConfirmedMobileDevice();
});

afterEach(() => { jest.useRealTimers(); });

test('once the session expired every screen says so, until the agent is back on the access screen', async () => {
  await signIn();
  const tree = await renderLayout();
  expect(screenText(tree)).not.toContain('Tu sesión terminó');

  // 16 minutes later the session cannot be renewed (no auth_time): the first read of the tablet ends it.
  advance(16 * MINUTE);
  await renderer.act(async () => { await expect(getMobileSession()).resolves.toBeNull(); });
  expect(screenText(tree)).toContain('Tu sesión terminó');
  expect(screenText(tree)).toContain(
    'Lo que registraste queda guardado en esta tablet. Entra de nuevo con tu cuenta para enviarlo a ELEVANT.');
  expect(signInAgain(tree)).toBeDefined();

  // It stays on every screen: only the access screen hides it, or a screen while it shows its own notice (the
  // checklist; checklist-screen.test.js renders it inside this layout).
  await navigate(tree, '/checklist/70000000-0000-4000-8000-000000000001');
  expect(screenText(tree)).toContain('Tu sesión terminó');
  expect(router.replace).not.toHaveBeenCalled();

  await renderer.act(async () => { signInAgain(tree).props.onPress(); });
  expect(router.dismissAll).toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { notice: 'session_expired' } });
  await navigate(tree, '/');
  expect(screenText(tree)).not.toContain('Tu sesión terminó');

  // The agent signs in again: the notice does not come back.
  await signIn();
  await navigate(tree, '/home');
  expect(screenText(tree)).not.toContain('Tu sesión terminó');
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('an account that lost its access: the notice says so and ENTRAR DE NUEVO explains it on the access screen', async () => {
  await signIn();
  const tree = await renderLayout();

  mockElevant.forbidden = true;
  await renderer.act(async () => { await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'forbidden' }); });
  expect(screenText(tree)).toContain('Tu cuenta ya no tiene acceso a la aplicación de rampa');
  expect(screenText(tree)).toContain('Lo que registraste queda guardado en esta tablet. Contacta a AVIAM antes de volver a entrar.');

  await renderer.act(async () => { signInAgain(tree).props.onPress(); });
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { notice: 'access_revoked' } });
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('a sign-out on purpose, or an end the access screen already shows, is no news', async () => {
  await signIn();
  const tree = await renderLayout();
  await renderer.act(async () => { await logoutMobileAgent(); });
  expect(screenText(tree)).not.toContain('Tu sesión terminó');

  // On the access screen the tablet notices an expired session: that screen explains it, and nothing follows the agent
  // once it signs in again.
  await navigate(tree, '/');
  await signIn();
  advance(16 * MINUTE);
  await renderer.act(async () => { await expect(getMobileSession()).resolves.toBeNull(); });
  expect(screenText(tree)).not.toContain('Tu sesión terminó');
  await signIn();
  await navigate(tree, '/home');
  expect(screenText(tree)).not.toContain('Tu sesión terminó');
  await renderer.act(async () => tree.unmount());
}, 30_000);
