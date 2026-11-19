// S3 (ADR-0046): the tablet keeps the refresh token of its sign-in and renews the session as AVIAM Web does. A small fake
// of ELEVANT's session endpoints (ADR-0021: rotation, its 60-second margin and reuse detection) answers through a mocked
// client factory, as in mobile-device-release.test.js; the storage, the session service and the server clock are real.
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

const { ElevantApiError } = require('@elevant/api-client');
const {
  getMobileSession,
  getMobileSessionIdentity,
  loginMobileAgent,
  logoutMobileAgent,
  resetMobileSessionRenewalForTests,
  subscribeMobileSessionEnd,
} = require('../src/services/mobile-auth');
const { forgetConfirmedMobileDevice } = require('../src/services/mobile-device');
const { getOwnCoverage } = require('../src/services/ramp-coverage');
const { flushFlightReport, recordMilestone, resetFlightReportForTests } = require('../src/services/flight-report');
const { readStoredMobileSession, replaceStoredMobileCredentialIfCurrent } = require('../src/storage/mobile-session');
const { loadServerClock, observeServerDate, resetServerClockForTests } =
  require('../src/synchronization/server-clock');

const ACCOUNT = '40000000-0000-4000-8000-000000000002';
const OPERATION = '70000000-0000-4000-8000-000000000001';
const CREDENTIAL_KEY = 'elevant.mobile.session-credential.v1';
const METADATA_KEY = 'elevant:mobile:session-metadata:v1';
const ENDED_SESSION_KEY = 'elevant:mobile:ended-session:v1';
const OUTBOX_KEY = `elevant.flightReportOutbox.v1.${ACCOUNT}`;
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
const offline = () => Object.assign(new Error('offline'), { mockNetwork: true });

/** ELEVANT's session endpoints as ADR-0021 and ADR-0046 describe them, on ELEVANT's own clock. */
const mockElevant = {
  reset() {
    Object.assign(this, {
      skewMs: 0, offline: false, authTime: true, issuesRefresh: true, refreshStatus: null,
      loseNextRefreshAnswer: false, beforeRefresh: null, refuseAccessTokens: false, registration: null,
      accepted: new Map(), families: [], calls: [], refused: [], sequence: 0,
    });
  },
  /** ELEVANT's clock: the tablet's minus how far ahead the tablet runs. */
  now() { return Date.now() - this.skewMs; },
  count(name) { return this.calls.filter(call => call.name === name).length; },
  tokensFor(name) { return this.calls.filter(call => call.name === name).map(call => call.token); },
  newFamily() {
    const family = { startedAt: this.now(), current: this.nextRefreshToken(), rotated: new Map(), revoked: false };
    this.families.push(family);
    return family;
  },
  nextRefreshToken() {
    this.sequence += 1;
    return `refresh-${String(this.sequence).padStart(3, '0')}-${'r'.repeat(32)}`;
  },
  issue(family) {
    const now = this.now();
    this.sequence += 1;
    const claims = {
      sub: ACCOUNT, jti: `jti-${this.sequence}`, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 900,
      ...(this.authTime ? { auth_time: Math.floor(family.startedAt / 1000) } : {}),
    };
    const accessToken = jwt(claims);
    this.accepted.set(accessToken, now + 15 * MINUTE);
    return {
      accessToken, tokenType: 'Bearer', expiresAt: new Date(now + 15 * MINUTE).toISOString(), actor,
      ...(this.issuesRefresh
        ? { refreshToken: family.current, refreshExpiresAt: new Date(now + 30 * 24 * 60 * MINUTE).toISOString() }
        : {}),
    };
  },
  rotate(family) {
    family.rotated.set(family.current, this.now());
    family.current = this.nextRefreshToken();
    return this.issue(family);
  },
  /** The family a refresh token belongs to, current or already replaced. */
  familyOf(token) {
    return this.families.find(family => family.current === token || family.rotated.has(token));
  },
  client(options) {
    const answer = async (name, token) => {
      this.calls.push({ name, token });
      if (this.offline) throw offline();
      // What the tablet's fetch wrapper does with the Date header of every answer (3-N18).
      observeServerDate(new Date(this.now()).toUTCString(), Date.now(), Date.now());
    };
    const authorized = async name => {
      const token = await options.getAccessToken?.();
      await answer(name, token);
      const expiry = this.accepted.get(token);
      // The API takes a token until its expiry plus 30 seconds of clock skew.
      if (this.refuseAccessTokens || expiry === undefined || this.now() > expiry + 30_000) {
        this.refused.push(name);
        throw new ElevantApiError({ status: 401 });
      }
    };
    return {
      createSession: async () => {
        await answer('createSession');
        return this.issue(this.newFamily());
      },
      getCurrentSession: async () => {
        await authorized('getCurrentSession');
        return { actor };
      },
      registerMobileDevice: async request => {
        await authorized('registerMobileDevice');
        if (this.registration) throw this.registration;
        return { installationId: request.installationId, platform: request.platform, appVersion: '1.0.0',
          lastSeenAt: new Date(this.now()).toISOString() };
      },
      releaseMobileDevice: async () => { await authorized('releaseMobileDevice'); },
      getOwnRampCoverage: async () => {
        await authorized('getOwnRampCoverage');
        return { coverages: [] };
      },
      recordRampMilestone: async () => {
        await authorized('recordRampMilestone');
        throw new ElevantApiError({ status: 503 });
      },
      refreshSession: async refreshToken => {
        if (this.beforeRefresh) await this.beforeRefresh();
        await answer('refreshSession');
        if (this.refreshStatus) throw new ElevantApiError({ status: this.refreshStatus });
        const family = this.familyOf(refreshToken);
        if (!family || family.revoked) throw new ElevantApiError({ status: 401 });
        if (family.current !== refreshToken) {
          if (this.now() - family.rotated.get(refreshToken) < MINUTE) {
            throw new ElevantApiError({ status: 409, code: 'refresh_rotated' });
          }
          family.revoked = true;
          throw new ElevantApiError({ status: 401 });
        }
        const renewed = this.rotate(family);
        if (this.loseNextRefreshAnswer) {
          // ELEVANT rotated the token, but its answer never reaches the tablet (D-S3b).
          this.loseNextRefreshAnswer = false;
          throw offline();
        }
        return renewed;
      },
      endSession: async refreshToken => {
        await answer('endSession');
        const family = this.familyOf(refreshToken);
        if (family) family.revoked = true;
      },
    };
  },
};

const advance = milliseconds => jest.setSystemTime(Date.now() + milliseconds);
const storedCredential = () => JSON.parse(mockSecureData.get(CREDENTIAL_KEY));
const storedMetadata = () => JSON.parse(mockAsyncData.get(METADATA_KEY)).metadata;

async function signIn() {
  await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
  return (await readStoredMobileSession()).sessionId;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-16T20:00:00.000Z'),
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  mockElevant.reset();
  resetServerClockForTests();
  resetMobileSessionRenewalForTests();
  resetFlightReportForTests();
  forgetConfirmedMobileDevice();
});

afterEach(() => { jest.useRealTimers(); });

test('at minute 16 the session renews once, even for two requests at the same time', async () => {
  const sessionId = await signIn();
  const first = storedCredential();

  advance(16 * MINUTE);
  await expect(Promise.all([getOwnCoverage(), getOwnCoverage()])).resolves.toHaveLength(2);

  expect(mockElevant.count('refreshSession')).toBe(1);
  const renewed = storedCredential();
  // The same revision of the session: its caches, drafts and the tablet's binding stay.
  expect(renewed.sessionId).toBe(sessionId);
  expect(renewed.accessToken).not.toBe(first.accessToken);
  expect(renewed.refreshToken).not.toBe(first.refreshToken);
  expect(mockElevant.tokensFor('getOwnRampCoverage')).toEqual([renewed.accessToken, renewed.accessToken]);

  // The next renewal waits for the last minute of the new token.
  advance(13 * MINUTE);
  await getOwnCoverage();
  expect(mockElevant.count('refreshSession')).toBe(1);
  advance(MINUTE);
  await getOwnCoverage();
  expect(mockElevant.count('refreshSession')).toBe(2);
});

test('without signal the session is not closed: the request fails as offline and a tap is still queued', async () => {
  const sessionId = await signIn();
  advance(16 * MINUTE);
  mockElevant.offline = true;

  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'network_unavailable' });
  await expect(getMobileSession()).resolves.not.toBeNull();
  await expect(getMobileSessionIdentity()).resolves.toMatchObject({ sessionId, session: { actor: { accountId: ACCOUNT } } });
  await recordMilestone(OPERATION, 'BLOCK_ON', new Date());
  await flushFlightReport();
  expect(JSON.parse(mockAsyncData.get(OUTBOX_KEY))).toEqual([
    expect.objectContaining({ state: 'pending', command: expect.objectContaining({ code: 'BLOCK_ON' }) })]);

  // After a renewal without signal the tablet waits 30 seconds before the next one.
  const attempts = mockElevant.count('refreshSession');
  expect(attempts).toBe(1);
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'network_unavailable' });
  expect(mockElevant.count('refreshSession')).toBe(attempts);

  advance(30_000);
  mockElevant.offline = false;
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(attempts + 1);
  expect(storedCredential().sessionId).toBe(sessionId);
});

test('a refused renewal (401) ends the session with its cause and keeps what the agent recorded', async () => {
  await signIn();
  const queued = JSON.stringify([{ idempotencyKey: '91000000-0000-4000-8000-000000000001',
    command: { kind: 'milestone', operationId: OPERATION, code: 'BLOCK_ON', occurredAt: '2026-11-16T20:05:00.000Z' },
    createdAt: '2026-11-16T20:05:00.000Z', state: 'pending', attempts: 0 }]);
  mockAsyncData.set(OUTBOX_KEY, queued);
  // OCC revoked the tablet, or the password changed: ELEVANT refuses the family.
  mockElevant.families[0].revoked = true;

  advance(16 * MINUTE);
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'session_expired', status: 401 });

  await expect(getMobileSession()).resolves.toBeNull();
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
  expect(mockElevant.count('getOwnRampCoverage')).toBe(0);
  expect(mockAsyncData.get(OUTBOX_KEY)).toBe(queued);
});

test('429 and 503 keep the session; a 409 re-reads the tokens another renewal stored', async () => {
  const sessionId = await signIn();
  advance(16 * MINUTE);

  for (const status of [429, 503]) {
    mockElevant.refreshStatus = status;
    await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'request_failed', status, retryable: true });
    await expect(getMobileSession()).resolves.not.toBeNull();
    advance(30_000);
  }
  expect(mockElevant.count('refreshSession')).toBe(2);

  mockElevant.refreshStatus = null;
  mockElevant.beforeRefresh = async () => {
    // Another renewal of this session got there first and stored its tokens: this one answers 409.
    mockElevant.beforeRefresh = null;
    const stored = await readStoredMobileSession();
    const renewed = mockElevant.rotate(mockElevant.families[0]);
    await replaceStoredMobileCredentialIfCurrent(stored.sessionId, stored.accessToken, renewed.accessToken,
      renewed.refreshToken, { ...stored.metadata, expiresAt: renewed.expiresAt, refreshExpiresAt: renewed.refreshExpiresAt });
  };
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(3);
  expect(mockElevant.tokensFor('getOwnRampCoverage').at(-1)).toBe(storedCredential().accessToken);
  expect(storedCredential().sessionId).toBe(sessionId);
});

test('a 401 from a call forces one renewal and sends the call once more', async () => {
  await signIn();
  const first = storedCredential().accessToken;
  // Ten minutes are left by the tablet's clock, but ELEVANT no longer takes the token.
  advance(5 * MINUTE);
  mockElevant.accepted.delete(first);

  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(1);
  expect(mockElevant.tokensFor('getOwnRampCoverage')).toEqual([first, storedCredential().accessToken]);

  // A renewed credential that ELEVANT refuses as well ends the session: one renewal per refusal, never a loop.
  advance(2 * MINUTE);
  mockElevant.refuseAccessTokens = true;
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockElevant.count('refreshSession')).toBe(2);
  expect(mockElevant.count('getOwnRampCoverage')).toBe(4);
  await expect(getMobileSession()).resolves.toBeNull();
});

test('signing in keeps the refresh token; a sign-in without one still ends with its access token', async () => {
  const sessionId = await signIn();
  expect(storedCredential()).toEqual({ schemaVersion: 2, sessionId, accessToken: expect.any(String),
    refreshToken: mockElevant.families[0].current });
  expect(storedMetadata()).toMatchObject({ schemaVersion: 2, refreshExpiresAt: expect.any(String) });

  mockAsyncData.clear();
  mockSecureData.clear();
  mockElevant.issuesRefresh = false;
  await signIn();
  expect(storedCredential().refreshToken).toBeNull();
  expect(storedMetadata().refreshExpiresAt).toBeNull();

  advance(16 * MINUTE);
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'session_expired' });
  expect(mockElevant.count('refreshSession')).toBe(0);
  await expect(getMobileSession()).resolves.toBeNull();
});

test('signs in with the tablet’s clock 20 minutes ahead of ELEVANT’s', async () => {
  mockElevant.skewMs = 20 * MINUTE;

  await expect(signIn()).resolves.toEqual(expect.any(String));
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(0);
});

test('an obsolete offset of 102 minutes only brings the renewal forward', async () => {
  await signIn();
  const first = storedCredential().accessToken;
  // The app starts again with an offset an earlier sample left: ELEVANT 102 minutes ahead of the tablet.
  resetServerClockForTests();
  mockAsyncData.set('elevant:mobile:server-clock:v1', JSON.stringify({ offsetMs: 102 * MINUTE }));
  await loadServerClock();

  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(1);
  expect(storedCredential().accessToken).not.toBe(first);
  // ELEVANT's answer corrected the clock: no other renewal, and the session goes on.
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(1);
  await expect(getMobileSession()).resolves.not.toBeNull();
});

test('a lost renewal answer (D-S3b) keeps the session until ELEVANT sees the old refresh token as reused', async () => {
  await signIn();
  const queued = JSON.stringify([{ idempotencyKey: '91000000-0000-4000-8000-000000000002',
    command: { kind: 'milestone', operationId: OPERATION, code: 'PUSHBACK', occurredAt: '2026-11-16T20:14:00.000Z' },
    createdAt: '2026-11-16T20:14:00.000Z', state: 'pending', attempts: 0 }]);
  mockAsyncData.set(OUTBOX_KEY, queued);

  // 50 seconds before the token expires the renewal goes out; ELEVANT rotates it and the answer is lost.
  advance(14 * MINUTE + 10_000);
  mockElevant.loseNextRefreshAnswer = true;
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(1);

  // Within ELEVANT's 60-second margin the old refresh token answers 409: nothing new to store, the session stays.
  advance(35_000);
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
  expect(mockElevant.count('refreshSession')).toBe(2);
  await expect(getMobileSession()).resolves.not.toBeNull();

  // After the margin it counts as reuse: ELEVANT revokes the family and the session ends.
  advance(35_000);
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'session_expired', status: 401 });
  expect(mockElevant.count('refreshSession')).toBe(3);
  expect(mockElevant.families[0].revoked).toBe(true);
  await expect(getMobileSession()).resolves.toBeNull();

  // What the agent recorded stays on the tablet, and the agent signs in again.
  expect(mockAsyncData.get(OUTBOX_KEY)).toBe(queued);
  await expect(signIn()).resolves.toEqual(expect.any(String));
  await expect(getOwnCoverage()).resolves.toEqual({ coverages: [] });
});

test('a token without auth_time (an API older than ADR-0046) is never renewed', async () => {
  mockElevant.authTime = false;
  await signIn();
  // Kept only to end the session at ELEVANT when the agent signs out.
  expect(storedCredential().refreshToken).toBe(mockElevant.families[0].current);
  expect(storedMetadata().refreshExpiresAt).toBeNull();

  advance(16 * MINUTE);
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'session_expired' });
  expect(mockElevant.count('refreshSession')).toBe(0);
  await expect(getMobileSession()).resolves.toBeNull();
});

test('a sign-in whose tablet registration fails ends the family it was just issued', async () => {
  mockElevant.registration = new ElevantApiError({ status: 409, code: 'device_in_use_by_active_agent' });

  await expect(signIn()).rejects.toMatchObject({ code: 'device_in_use' });
  expect(mockElevant.count('endSession')).toBe(1);
  expect(mockElevant.families[0].revoked).toBe(true);
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
  await expect(getMobileSession()).resolves.toBeNull();
});

test('signing out with an expired token renews it first, also in the pause after a failed renewal, so ELEVANT frees the tablet', async () => {
  await signIn();
  // More than 15 minutes in a dead zone: the renewal without signal starts the 30-second pause.
  advance(16 * MINUTE);
  mockElevant.offline = true;
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'network_unavailable' });
  const renewals = mockElevant.count('refreshSession');

  // Back on Wi-Fi, the agent signs out within the pause.
  mockElevant.offline = false;
  advance(10_000);
  const ends = [];
  const stopListening = subscribeMobileSessionEnd(ended => ends.push(ended));
  try {
    await logoutMobileAgent();
  } finally {
    stopListening();
  }

  expect(mockElevant.count('refreshSession')).toBe(renewals + 1);
  // ELEVANT takes the renewed token and frees the tablet; the family ends after the renewal, never while it is on its way.
  const names = mockElevant.calls.map(call => call.name);
  expect(names.indexOf('releaseMobileDevice')).toBeGreaterThan(names.lastIndexOf('refreshSession'));
  expect(names.indexOf('endSession')).toBeGreaterThan(names.lastIndexOf('refreshSession'));
  expect(mockElevant.refused).toEqual([]);
  expect(mockElevant.families[0].revoked).toBe(true);
  // A sign-out on purpose: nothing is announced, no marker of an ended session stays and the credential is gone.
  expect(ends).toEqual([]);
  expect(mockAsyncData.has(ENDED_SESSION_KEY)).toBe(false);
  expect(mockSecureData.has(CREDENTIAL_KEY)).toBe(false);
});

test('signing out 20 minutes after signing in renews the token once before the release', async () => {
  await signIn();
  advance(20 * MINUTE);

  await logoutMobileAgent();

  expect(mockElevant.count('refreshSession')).toBe(1);
  expect(mockElevant.count('releaseMobileDevice')).toBe(1);
  expect(mockElevant.refused).toEqual([]);
  expect(mockElevant.families[0].revoked).toBe(true);
});
