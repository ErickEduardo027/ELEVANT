// «Checklist operativo» (N5): the answers marked after the session ended stay on the tablet for the account that opened
// the checklist, and the screen shows them again once that account signs in. The screen, its services, the storage
// and the session service are real; ELEVANT is a small fake, as in ramp-operation-checklist-draft.test.js.
const React = require('react');
const renderer = require('react-test-renderer');

const mockAsyncData = new Map();
const mockSecureData = new Map();
let mockUuidCounter = 0;

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
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: jest.fn(), readWalkaroundPhoto: jest.fn(), forgetWalkaroundPhoto: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), dismissAll: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: '70000000-0000-4000-8000-000000000001' }),
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));

const { ElevantApiError } = require('@elevant/api-client');
const { loginMobileAgent, resetMobileSessionRenewalForTests } = require('../src/services/mobile-auth');
const { forgetConfirmedMobileDevice } = require('../src/services/mobile-device');
const { getOwnCoverage } = require('../src/services/ramp-coverage');
const { resetFlightReportForTests } = require('../src/services/flight-report');
const { resetServerClockForTests } = require('../src/synchronization/server-clock');
const ChecklistScreen = require('../src/app/checklist/[id]').default;

const ACCOUNT = '40000000-0000-4000-8000-000000000002';
const OPERATION = '70000000-0000-4000-8000-000000000001';
const CHECKLIST = '71000000-0000-4000-8000-000000000001';
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

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

/** AVIAM's checklist: 21 controls in three sections of seven, none answered on ELEVANT yet. */
const checklist = {
  operationId: OPERATION,
  checklist: {
    id: CHECKLIST, status: 'InProgress', startedAt: '2026-11-16T19:40:00.000Z', submittedAt: null,
    template: { code: 'RAMP-AC', name: 'Checklist operativo', version: 1 },
    sections: [0, 1, 2].map(section => ({
      name: `Sección ${section + 1}`,
      items: range(section * 7 + 1, section * 7 + 7).map(number => ({
        id: `72000000-0000-4000-8000-${String(number).padStart(12, '0')}`, code: `RAMP-${number}`,
        label: `Control ${number}`, sortOrder: number, isRequired: true, requiresNoteWhenNotOk: false,
      })),
    })),
  },
};

const base64Url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => `${base64Url({ alg: 'HS256', typ: 'at+jwt' })}.${base64Url(claims)}.c2lnbmF0dXJl`;

/** ELEVANT's session endpoints (ADR-0021, ADR-0046) and the operation's checklist; OCC can revoke the tablet. */
const mockElevant = {
  reset() {
    Object.assign(this, { accepted: new Set(), families: [], sequence: 0 });
  },
  nextRefreshToken() {
    this.sequence += 1;
    return `refresh-${String(this.sequence).padStart(3, '0')}-${'r'.repeat(32)}`;
  },
  issue(family) {
    this.sequence += 1;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = jwt({ sub: ACCOUNT, jti: `jti-${this.sequence}`, iat: now, exp: now + 900,
      auth_time: family.startedAt });
    this.accepted.add(accessToken);
    return {
      accessToken, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), actor,
      refreshToken: family.current, refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    };
  },
  /** OCC revokes the tablet: ELEVANT refuses the access token at once, and its renewal as well (401). */
  revoke() {
    this.accepted.clear();
    this.families.forEach(family => { family.revoked = true; });
  },
  client(options) {
    const authorized = async () => {
      if (!this.accepted.has(await options.getAccessToken?.())) throw new ElevantApiError({ status: 401 });
    };
    return {
      createSession: async () => {
        const family = { startedAt: Math.floor(Date.now() / 1000), current: this.nextRefreshToken(), revoked: false };
        this.families.push(family);
        return this.issue(family);
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
      refreshSession: async refreshToken => {
        const family = this.families.find(candidate => candidate.current === refreshToken);
        if (!family || family.revoked) throw new ElevantApiError({ status: 401 });
        family.current = this.nextRefreshToken();
        return this.issue(family);
      },
      getOwnRampCoverage: async () => {
        await authorized();
        return { coverages: [] };
      },
      getRampOperationChecklist: async () => {
        await authorized();
        return checklist;
      },
    };
  },
};

/** Lets the screen's work finish: the draft is saved 250 ms after the last answer. */
const settle = (milliseconds = 50) =>
  renderer.act(() => new Promise(resolve => { setTimeout(resolve, milliseconds); }));

async function mount() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(ChecklistScreen)); });
  await settle();
  return tree;
}

async function answerOk(tree, numbers) {
  for (const number of numbers) {
    const [choice] = tree.root.findAll(node => node.props?.label === 'OK' &&
      node.props?.context === `Control ${number}` && typeof node.props.onPress === 'function');
    await renderer.act(async () => { choice.props.onPress(); });
  }
}

async function press(tree, title) {
  const [button] = tree.root.findAll(node => node.props?.title === title && typeof node.props.onPress === 'function');
  await renderer.act(async () => { button.props.onPress(); });
}

const progress = tree =>
  tree.root.findAll(node => node.props?.accessibilityRole === 'progressbar')[0].props.accessibilityLabel;

beforeEach(() => {
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  mockElevant.reset();
  resetServerClockForTests();
  resetMobileSessionRenewalForTests();
  resetFlightReportForTests();
  forgetConfirmedMobileDevice();
});

test('the answers marked after the session ended come back, 21 of 21, when the agent signs in again', async () => {
  await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
  let tree = await mount();
  expect(progress(tree)).toBe('0 de 21 controles respondidos');

  await answerOk(tree, range(1, 7));
  await press(tree, 'SIGUIENTE');
  await answerOk(tree, range(8, 10));
  await settle(400);

  // OCC revokes the tablet and another request finds out: ELEVANT refuses the renewal and the session ends (S3).
  mockElevant.revoke();
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'unauthenticated' });

  // The agent goes on with the checklist: 11 more answers after the end of the session.
  await answerOk(tree, range(11, 14));
  await press(tree, 'SIGUIENTE');
  await answerOk(tree, range(15, 21));
  expect(progress(tree)).toBe('21 de 21 controles respondidos');
  // Leaving the screen saves what was still waiting.
  await renderer.act(async () => { tree.unmount(); });
  await settle(100);

  await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
  tree = await mount();
  expect(progress(tree)).toBe('21 de 21 controles respondidos');
  await renderer.act(async () => { tree.unmount(); });
}, 30_000);
