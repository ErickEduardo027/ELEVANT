// N7: the access screen. The notice of how the previous session ended lasts until the next attempt, is written in the
// past tense and names the cause the tablet recorded (the marker of N5); a tablet another agent still holds sends the
// agent to OCC without naming who holds it (D-N7); the email placeholder is not a test address; once a session ended,
// only that account's unsent records count; and in portrait the form no longer falls to the lower half. The screen, the
// storage, the session service and the server clock are real; ELEVANT's session endpoints are a small fake, as in
// session-ended-notice.test.js.
const React = require('react');
const renderer = require('react-test-renderer');

const mockAsyncData = new Map();
const mockSecureData = new Map();
let mockUuidCounter = 0;
/** The route's notice: the screen can stay mounted while it changes. */
let mockNotice;

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
jest.mock('expo-router', () => ({
  router: { canDismiss: jest.fn(() => true), dismissAll: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => (mockNotice ? { notice: mockNotice } : {}),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../src/utils/app-exit', () => ({ exitApplication: jest.fn() }));

const { StyleSheet } = require('react-native');
const { router } = require('expo-router');
const { ElevantApiError } = require('@elevant/api-client');
const {
  getMobileSession,
  loginMobileAgent,
  resetMobileSessionRenewalForTests,
} = require('../src/services/mobile-auth');
const { forgetConfirmedMobileDevice } = require('../src/services/mobile-device');
const { getOwnCoverage } = require('../src/services/ramp-coverage');
const { readEndedMobileSession } = require('../src/storage/mobile-session');
const { resetServerClockForTests } = require('../src/synchronization/server-clock');
const LoginScreen = require('../src/app/index').default;

const ACCOUNT_A = '40000000-0000-4000-8000-000000000002';
const ACCOUNT_B = '40000000-0000-4000-8000-000000000003';
const EMAIL_A = 'riley.ramp@dev.elevant.test';
const EMAIL_B = 'blair.baggage@dev.elevant.test';
const PASSWORD = 'Clave-Segura-2026!';
const OPERATION = '70000000-0000-4000-8000-000000000001';
const MINUTE = 60_000;

const actorOf = (accountId, email, displayName) => ({
  accountId,
  email,
  displayName,
  roles: [{ roleId: '41000000-0000-4000-8000-000000000002', code: 'RAMP_AGENT', name: 'Agente de rampa',
    portal: 'ramp_mobile_app', userType: 'ramp_agent' }],
  memberships: [{ membershipId: '42000000-0000-4000-8000-000000000002',
    organizationId: '10000000-0000-4000-8000-000000000001', organizationCode: 'AVIAM', organizationName: 'AVIAM',
    organizationType: 'aviam_operator', kind: 'internal_staff' }],
  stationScopes: [{ stationId: '20000000-0000-4000-8000-000000000003', stationCode: 'PUJ' }],
});
const AGENTS = new Map([
  [EMAIL_A, actorOf(ACCOUNT_A, EMAIL_A, 'Riley Ramp')],
  [EMAIL_B, actorOf(ACCOUNT_B, EMAIL_B, 'Blair Baggage')],
]);

const base64Url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => `${base64Url({ alg: 'HS256', typ: 'at+jwt' })}.${base64Url(claims)}.c2lnbmF0dXJl`;

/**
 * ELEVANT's session endpoints (ADR-0021, ADR-0046): one refresh family per sign-in, which OCC can revoke. `authTime`
 * false is an API before ADR-0046, whose session ends with its access token after 15 minutes; `forbidden` is an account
 * that lost its access to the app (403); `deviceInUse` is a tablet still bound to another agent whose operation is in
 * progress (2-N02).
 */
const mockElevant = {
  reset() {
    Object.assign(this, { accepted: new Map(), families: [], sequence: 0, authTime: true, forbidden: false,
      deviceInUse: false });
  },
  nextRefreshToken() {
    this.sequence += 1;
    return `refresh-${String(this.sequence).padStart(3, '0')}-${'r'.repeat(32)}`;
  },
  issue(family) {
    this.sequence += 1;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = jwt({ sub: family.actor.accountId, jti: `jti-${this.sequence}`, iat: now, exp: now + 900,
      ...(family.authTime ? { auth_time: family.startedAt } : {}) });
    this.accepted.set(accessToken, family.actor);
    return {
      accessToken, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 15 * MINUTE).toISOString(),
      actor: family.actor, refreshToken: family.current,
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * MINUTE).toISOString(),
    };
  },
  /** OCC revokes the session: ELEVANT refuses its access token at once, and its renewal as well (401). */
  revoke() {
    this.accepted.clear();
    this.families.forEach(family => { family.revoked = true; });
  },
  client(options) {
    const authorized = async () => {
      const actor = this.accepted.get(await options.getAccessToken?.());
      if (!actor) throw new ElevantApiError({ status: 401 });
      return actor;
    };
    const familyOf = refreshToken => this.families.find(family => family.current === refreshToken);
    return {
      createSession: async ({ email, password }) => {
        const actor = AGENTS.get(email);
        if (!actor || password !== PASSWORD) throw new ElevantApiError({ status: 401 });
        const family = { actor, startedAt: Math.floor(Date.now() / 1000), current: this.nextRefreshToken(),
          revoked: false, authTime: this.authTime };
        this.families.push(family);
        return this.issue(family);
      },
      getCurrentSession: async () => ({ actor: await authorized() }),
      registerMobileDevice: async request => {
        await authorized();
        if (this.deviceInUse) throw new ElevantApiError({ status: 409, code: 'device_in_use_by_active_agent' });
        return { installationId: request.installationId, platform: request.platform, appVersion: '1.0.0',
          lastSeenAt: new Date().toISOString() };
      },
      refreshSession: async refreshToken => {
        const family = familyOf(refreshToken);
        if (!family || family.revoked) throw new ElevantApiError({ status: 401 });
        family.current = this.nextRefreshToken();
        return this.issue(family);
      },
      releaseMobileDevice: async () => ({ released: true }),
      endSession: async refreshToken => {
        const family = familyOf(refreshToken);
        if (family) family.revoked = true;
      },
      getOwnRampCoverage: async () => {
        await authorized();
        if (this.forbidden) throw new ElevantApiError({ status: 403 });
        return { coverages: [] };
      },
    };
  },
};

const advance = milliseconds => jest.setSystemTime(Date.now() + milliseconds);
const signIn = (email = EMAIL_A) => loginMobileAgent(email, PASSWORD);

/** Ends A's session the way `cause` names; the tablet leaves its marker with that cause (N5). */
async function endSessionOfA(cause) {
  if (cause === 'expired') {
    // An API before ADR-0046: the session cannot renew, and the first read after its access token expired ends it.
    mockElevant.authTime = false;
    await signIn();
    advance(16 * MINUTE);
    await expect(getMobileSession()).resolves.toBeNull();
  } else if (cause === 'refused') {
    // OCC revoked it: the next request finds out and ELEVANT refuses the renewal.
    await signIn();
    mockElevant.revoke();
    await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'unauthenticated' });
  } else {
    await signIn();
    mockElevant.forbidden = true;
    await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'forbidden' });
  }
  await expect(readEndedMobileSession()).resolves.toMatchObject({ accountId: ACCOUNT_A, reason: cause });
}

/** `count` taps of `accountId` that wait in its Flight Report queue (3-N12). */
function queueTaps(accountId, count) {
  mockAsyncData.set(`elevant.flightReportOutbox.v1.${accountId}`, JSON.stringify(Array.from({ length: count },
    (_, index) => ({
      idempotencyKey: `91000000-0000-4000-8000-${accountId.slice(-4)}${String(index).padStart(8, '0')}`,
      command: { kind: 'milestone', operationId: OPERATION, code: 'BLOCK_ON', occurredAt: '2026-11-16T19:40:00.000Z' },
      createdAt: '2026-11-16T19:40:00.000Z',
      state: 'pending',
      attempts: 0,
    }))));
}

/** The sign-in and the screen's reads only wait on promises: one turn of the event loop lets them finish. */
const settle = () => renderer.act(() => new Promise(resolve => setTimeout(resolve, 0)));

async function renderLogin() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(LoginScreen)); });
  await settle();
  return tree;
}

/** The route's notice changed while the screen stayed mounted. */
async function rerender(tree) {
  await renderer.act(async () => { tree.update(React.createElement(LoginScreen)); });
  await settle();
}

function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}

const input = (tree, label) => tree.root.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === label);
const button = (tree, title) => tree.root.find(node => node.props?.title === title && typeof node.props.onPress === 'function');

async function type(tree, label, value) {
  await renderer.act(async () => { input(tree, label).props.onChangeText(value); });
}

async function attemptSignIn(tree, email, password) {
  await type(tree, 'Correo de la cuenta AVIAM', email);
  await type(tree, 'Contraseña de la cuenta AVIAM', password);
  await renderer.act(async () => { button(tree, 'INICIAR SESIÓN').props.onPress(); });
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-16T20:00:00.000Z'),
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  jest.clearAllMocks();
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  mockNotice = undefined;
  mockElevant.reset();
  resetServerClockForTests();
  resetMobileSessionRenewalForTests();
  forgetConfirmedMobileDevice();
});

afterEach(() => { jest.useRealTimers(); });

test('the notice of how the session ended goes at the next attempt and comes back with a new notice', async () => {
  await endSessionOfA('refused');
  mockNotice = 'session_expired';
  const tree = await renderLogin();
  expect(screenText(tree)).toContain('ELEVANT cerró la sesión anterior.');

  await attemptSignIn(tree, EMAIL_A, 'Clave-Equivocada-2026!');
  expect(screenText(tree)).toContain('El correo o la contraseña no son válidos.');
  expect(screenText(tree)).not.toContain('sesión anterior');

  // Nothing else brings it back while the route keeps the same notice…
  await rerender(tree);
  expect(screenText(tree)).not.toContain('sesión anterior');

  // …but a new notice does.
  mockNotice = 'access_revoked';
  await rerender(tree);
  expect(screenText(tree)).toContain('La cuenta de la sesión anterior perdió el acceso a la aplicación de rampa.');
  await renderer.act(async () => tree.unmount());
}, 30_000);

test.each([
  ['expired', 'session_expired', 'La sesión anterior venció. Inicia sesión de nuevo para continuar.'],
  ['refused', 'session_expired', 'ELEVANT cerró la sesión anterior. Inicia sesión de nuevo; si no puedes entrar, avisa a OCC.'],
  ['forbidden', 'access_revoked',
    'La cuenta de la sesión anterior perdió el acceso a la aplicación de rampa. Contacta a AVIAM antes de volver a entrar.'],
])('a session that ended as %s is told in the past tense, with its cause', async (cause, notice, message) => {
  await endSessionOfA(cause);
  mockNotice = notice;
  const tree = await renderLogin();
  expect(screenText(tree)).toContain(message);
  expect(screenText(tree)).not.toContain('Tu sesión terminó');
  // D-N7: the email of the account that ended is not filled in.
  expect(input(tree, 'Correo de la cuenta AVIAM').props.value).toBe('');
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('without a marker the route notice still says the previous session ended', async () => {
  mockNotice = 'session_expired';
  const tree = await renderLogin();
  expect(screenText(tree)).toContain('La sesión anterior terminó. Inicia sesión de nuevo para continuar.');
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('the access screen explains an end it notices itself, without a route notice', async () => {
  mockElevant.authTime = false;
  await signIn();
  advance(16 * MINUTE);

  const tree = await renderLogin();
  expect(router.replace).not.toHaveBeenCalled();
  expect(screenText(tree)).toContain('La sesión anterior venció. Inicia sesión de nuevo para continuar.');
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('the email field asks for the AVIAM account without a test address', async () => {
  const tree = await renderLogin();
  const email = input(tree, 'Correo de la cuenta AVIAM');
  expect(email.props.placeholder).toBe('Correo de tu cuenta AVIAM');
  expect(email.props.placeholder).not.toMatch(/@|\.test/);
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('a tablet another agent still holds sends the agent to OCC, without naming who holds it', async () => {
  mockElevant.deviceInUse = true;
  const tree = await renderLogin();
  await attemptSignIn(tree, EMAIL_A, PASSWORD);

  expect(screenText(tree)).toContain('Esta tablet sigue a nombre de otro agente con una operación en curso. '
    + 'Pide a OCC que la libere en «Tablets» y vuelve a intentarlo.');
  expect(screenText(tree)).not.toMatch(/cierre sesión|Pídele/);
  expect(router.replace).not.toHaveBeenCalled();
  await expect(getMobileSession()).resolves.toBeNull();
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('once a session ended only its own unsent records count, never another account’s', async () => {
  queueTaps(ACCOUNT_A, 2);
  queueTaps(ACCOUNT_B, 3);
  await endSessionOfA('refused');
  mockNotice = 'session_expired';

  const tree = await renderLogin();
  expect(screenText(tree)).toContain('Inicia sesión de nuevo para enviar 2 registros guardados en esta tablet.');
  expect(screenText(tree)).not.toMatch(/\b[35] registros\b/);
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('in portrait the form no longer falls to the lower half: the logo and the form are one centered block', async () => {
  const tree = await renderLogin();
  const scroll = tree.root.find(node => node.type === 'RCTScrollView' || node.props?.contentContainerStyle);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).justifyContent).not.toBe('space-between');

  const pushedDown = tree.root.findAll(node => node.type === 'View'
    && StyleSheet.flatten(node.props.style)?.marginTop === 'auto');
  const block = pushedDown.find(node => node.findAll(child => child.props?.accessibilityLabel === 'ELEVANT').length > 0);
  expect(block).toBeDefined();
  expect(block.findAll(child => child.props?.children === 'Acceso operativo').length).toBeGreaterThan(0);
  const footer = pushedDown.find(node => node.findAll(child => child.props?.children === 'ELEVANDO LA GESTIÓN DE').length > 0);
  expect(footer).toBeDefined();
  expect(footer).not.toBe(block);
  await renderer.act(async () => tree.unmount());
}, 30_000);
