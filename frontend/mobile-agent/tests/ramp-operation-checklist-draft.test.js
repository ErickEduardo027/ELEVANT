// N5: what the agent marks in the checklist after the session ended is not lost. The screen pins the account it loaded
// the draft with, and the service answers 'saved' or 'kept-until-sign-in'; it throws only when the device's storage
// fails. The queue still needs a session (D-N5). The storage, the session service and the server clock are real;
// ELEVANT's session endpoints are a small fake, as in mobile-session-renewal.test.js.
const mockAsyncData = new Map();
const mockSecureData = new Map();
let mockUuidCounter = 0;
/** Runs once, when the storage next removes keys: the session is being cleared right then. */
let mockWhileRemoving = null;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockAsyncData.keys()]),
    getItem: jest.fn(async key => mockAsyncData.get(key) ?? null),
    setItem: jest.fn(async (key, value) => { mockAsyncData.set(key, value); }),
    removeItem: jest.fn(async key => { mockAsyncData.delete(key); }),
    multiRemove: jest.fn(async keys => {
      const hook = mockWhileRemoving;
      mockWhileRemoving = null;
      hook?.();
      keys.forEach(key => mockAsyncData.delete(key));
    }),
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

const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const SecureStore = require('expo-secure-store');
const { ElevantApiError } = require('@elevant/api-client');
const {
  getMobileSession,
  loginMobileAgent,
  logoutMobileAgent,
  resetMobileSessionRenewalForTests,
} = require('../src/services/mobile-auth');
const { forgetConfirmedMobileDevice } = require('../src/services/mobile-device');
const { getOwnCoverage } = require('../src/services/ramp-coverage');
const { resetFlightReportForTests } = require('../src/services/flight-report');
const {
  readRampOperationChecklistDraft,
  saveRampOperationChecklistDraft,
  submitRampOperationChecklist,
} = require('../src/services/ramp-operation-checklist');
const { readEndedMobileSession } = require('../src/storage/mobile-session');
const { resetServerClockForTests } = require('../src/synchronization/server-clock');

const ACCOUNT = '40000000-0000-4000-8000-000000000002';
const OPERATION = '70000000-0000-4000-8000-000000000001';
const CHECKLIST = '71000000-0000-4000-8000-000000000001';
const ITEMS = ['72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000003'];
const OUTBOX_PREFIX = 'elevant.flightReportOutbox.v1.';

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

/** ELEVANT's session endpoints (ADR-0021, ADR-0046): one refresh family per sign-in, which OCC can revoke. */
const mockElevant = {
  reset() {
    Object.assign(this, { accepted: new Set(), families: [], sequence: 0, registration: null, forbidden: false });
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
    const familyOf = refreshToken => this.families.find(family => family.current === refreshToken);
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
        if (this.registration) throw this.registration;
        return { installationId: request.installationId, platform: request.platform, appVersion: '1.0.0',
          lastSeenAt: new Date().toISOString() };
      },
      releaseMobileDevice: async () => { await authorized(); },
      refreshSession: async refreshToken => {
        const family = familyOf(refreshToken);
        if (!family || family.revoked) throw new ElevantApiError({ status: 401 });
        family.current = this.nextRefreshToken();
        return this.issue(family);
      },
      endSession: async refreshToken => {
        const family = familyOf(refreshToken);
        if (family) family.revoked = true;
      },
      getOwnRampCoverage: async () => {
        await authorized();
        // The account no longer qualifies for the app (its role or membership ended): 403.
        if (this.forbidden) throw new ElevantApiError({ status: 403 });
        return { coverages: [] };
      },
    };
  },
};

const draftWith = (...values) => ({
  schemaVersion: 1,
  checklistId: CHECKLIST,
  answers: Object.fromEntries(values.map((value, index) => [ITEMS[index], { value }])),
});

async function signIn() {
  await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
}

/** OCC revokes the tablet and the next request finds out: ELEVANT refuses the renewal and the session ends (S3). */
async function endSessionThroughItsRenewal() {
  mockElevant.revoke();
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(getMobileSession()).resolves.toBeNull();
}

beforeEach(() => {
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  mockWhileRemoving = null;
  mockElevant.reset();
  resetServerClockForTests();
  resetMobileSessionRenewalForTests();
  resetFlightReportForTests();
  forgetConfirmedMobileDevice();
});

test('what the agent marks after the session ended is kept until the same account signs in again', async () => {
  await signIn();
  // The screen loads the draft: the account it belongs to is pinned for every later save.
  const loaded = await readRampOperationChecklistDraft(OPERATION, CHECKLIST);
  expect(loaded).toEqual({ accountId: ACCOUNT, draft: null });
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok'), loaded.accountId)).resolves.toBe('saved');

  await endSessionThroughItsRenewal();
  await expect(readEndedMobileSession())
    .resolves.toEqual({ accountId: ACCOUNT, reason: 'refused', endedAt: expect.any(String) });
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok', 'NotOk', 'NotApplicable'),
    loaded.accountId)).resolves.toBe('kept-until-sign-in');

  // The queue still needs a session (D-N5): the checklist is neither sent nor queued.
  await expect(submitRampOperationChecklist(OPERATION, { checklistId: CHECKLIST,
    answers: [{ itemId: ITEMS[0], value: 'Ok' }] })).rejects.toMatchObject({ code: 'unauthenticated' });
  expect([...mockAsyncData.keys()].some(key => key.startsWith(OUTBOX_PREFIX))).toBe(false);

  // The same agent signs in again and finds every answer.
  await signIn();
  await expect(readRampOperationChecklistDraft(OPERATION, CHECKLIST)).resolves.toEqual({
    accountId: ACCOUNT, draft: draftWith('Ok', 'NotOk', 'NotApplicable'),
  });
});

test('a save on its way when the session ends answers kept-until-sign-in, never cancelled', async () => {
  await signIn();
  const { accountId } = await readRampOperationChecklistDraft(OPERATION, CHECKLIST);
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok'), accountId)).resolves.toBe('saved');

  // The agent taps while the tablet is ending the session: the save waits for the storage behind the end.
  let saving;
  mockWhileRemoving = () => {
    saving = saveRampOperationChecklistDraft(OPERATION, draftWith('Ok', 'Ok'), accountId);
  };
  await endSessionThroughItsRenewal();

  await expect(saving).resolves.toBe('kept-until-sign-in');
  await signIn();
  await expect(readRampOperationChecklistDraft(OPERATION, CHECKLIST))
    .resolves.toEqual({ accountId: ACCOUNT, draft: draftWith('Ok', 'Ok') });
});

test('only a real storage failure is thrown, as storage_unavailable', async () => {
  await signIn();
  const { accountId } = await readRampOperationChecklistDraft(OPERATION, CHECKLIST);
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok'), accountId)).resolves.toBe('saved');

  AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok', 'NotOk'), accountId))
    .rejects.toMatchObject({ code: 'storage_unavailable' });

  await endSessionThroughItsRenewal();
  SecureStore.isAvailableAsync.mockResolvedValueOnce(false);
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok', 'Ok'), accountId))
    .rejects.toMatchObject({ code: 'storage_unavailable' });
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok', 'Ok'), accountId))
    .resolves.toBe('kept-until-sign-in');
});

test('a failed sign-in keeps what the ended session may still save; a confirmed one or signing out ends it', async () => {
  await signIn();
  const { accountId } = await readRampOperationChecklistDraft(OPERATION, CHECKLIST);
  await endSessionThroughItsRenewal();

  // Another sign-in on the tablet fails: its registration is refused.
  mockElevant.registration = new ElevantApiError({ status: 409, code: 'device_in_use_by_active_agent' });
  await expect(signIn()).rejects.toMatchObject({ code: 'device_in_use' });
  await expect(readEndedMobileSession()).resolves.toMatchObject({ accountId: ACCOUNT, reason: 'refused' });
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok'), accountId))
    .resolves.toBe('kept-until-sign-in');

  mockElevant.registration = null;
  await signIn();
  await expect(readEndedMobileSession()).resolves.toBeNull();
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('Ok', 'Ok'), accountId)).resolves.toBe('saved');

  // The agent signs out on purpose: nothing marked afterwards is kept, and the screen is told so.
  await logoutMobileAgent();
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('NotOk', 'NotOk'), accountId))
    .rejects.toMatchObject({ code: 'session_expired' });
  await signIn();
  await expect(readRampOperationChecklistDraft(OPERATION, CHECKLIST))
    .resolves.toEqual({ accountId: ACCOUNT, draft: draftWith('Ok', 'Ok') });
});

test('a session ELEVANT no longer allows (403) is marked forbidden, and its account still keeps its answers', async () => {
  await signIn();
  const { accountId } = await readRampOperationChecklistDraft(OPERATION, CHECKLIST);

  mockElevant.forbidden = true;
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'forbidden' });
  await expect(getMobileSession()).resolves.toBeNull();
  await expect(readEndedMobileSession())
    .resolves.toEqual({ accountId: ACCOUNT, reason: 'forbidden', endedAt: expect.any(String) });
  await expect(saveRampOperationChecklistDraft(OPERATION, draftWith('NotOk'), accountId))
    .resolves.toBe('kept-until-sign-in');
});
