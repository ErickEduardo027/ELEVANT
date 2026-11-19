// Phase 2, block E (2-N02): a shared tablet is freed at sign-out and explains why it cannot be used. Since S3
// (ADR-0046) the sign-out also ends the session at ELEVANT, and what the release names belongs to the session.
const mockApi = {
  registerMobileDevice: jest.fn(), releaseMobileDevice: jest.fn(), endSession: jest.fn(), refreshSession: jest.fn(),
};
const mockStorage = {
  installationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  session: null,
  cleared: 0,
};

// The session service reads ELEVANT's clock (3-N18), which keeps its offset in AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined),
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
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '82000000-0000-4000-8000-0000000000E1') }));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
  readOrCreateMobileInstallationId: jest.fn(async () => mockStorage.installationId),
  readMobileInstallationId: jest.fn(async () => mockStorage.installationId),
  readStoredMobileSession: jest.fn(async () => mockStorage.session ?? { kind: 'missing' }),
  clearStoredMobileSession: jest.fn(async () => { mockStorage.cleared += 1; mockStorage.session = null; }),
  clearStoredMobileSessionIfCurrent: jest.fn(async () => true),
  updateStoredMobileSessionMetadata: jest.fn(async () => true),
  writeStoredMobileSession: jest.fn(async () => 'session-1'),
}));

const { Platform } = require('react-native');
const { ElevantApiError } = require('@elevant/api-client');
const { createMobileAgentApiClient } = require('../src/config/elevant-api');
const { registerCurrentMobileDevice, releaseCurrentMobileDevice } = require('../src/services/mobile-device');
const {
  logoutMobileAgent,
  MOBILE_END_SESSION_TIMEOUT_MS,
  resetMobileSessionRenewalForTests,
} = require('../src/services/mobile-auth');

const platform = () => (Platform.OS === 'ios' ? 'Ios' : 'Android');
const REFRESH_TOKEN = 'refresh-token-of-the-session-0123456789';
const base64Url = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function activeSession(accessToken = 'token-a', refreshToken = REFRESH_TOKEN) {
  return {
    kind: 'active',
    sessionId: 'session-1',
    accessToken,
    refreshToken,
    metadata: {
      schemaVersion: 1,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      actor: {
        accountId: '40000000-0000-4000-8000-000000000002',
        email: 'ramp.agent@dev.elevant.test',
        displayName: 'Riley Ramp',
        role: {
          roleId: '41000000-0000-4000-8000-000000000002', code: 'RAMP_AGENT', name: 'Agente de rampa',
          portal: 'ramp_mobile_app', userType: 'ramp_agent',
        },
        membership: {
          membershipId: '42000000-0000-4000-8000-000000000002',
          organizationId: '10000000-0000-4000-8000-000000000001',
          organizationCode: 'AVIAM', organizationName: 'AVIAM', organizationType: 'aviam_operator', kind: 'internal_staff',
        },
        stationScopes: [{ stationId: '20000000-0000-4000-8000-000000000003', stationCode: 'PUJ' }],
      },
    },
  };
}

/** A session that renews (S3): its access token carries `auth_time` and expired a minute ago, its refresh token is in force. */
function sessionWaitingForItsRenewal() {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = `${base64Url({ alg: 'HS256', typ: 'at+jwt' })}.${base64Url({
    sub: '40000000-0000-4000-8000-000000000002', iat: now - 960, exp: now - 60, auth_time: now - 960,
  })}.c2lnbmF0dXJl`;
  const session = activeSession(accessToken);
  return {
    ...session,
    metadata: {
      ...session.metadata,
      schemaVersion: 2,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    },
  };
}

beforeEach(() => {
  mockApi.registerMobileDevice.mockReset();
  mockApi.releaseMobileDevice.mockReset();
  mockApi.endSession.mockReset();
  mockApi.refreshSession.mockReset();
  resetMobileSessionRenewalForTests();
  mockStorage.installationId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  mockStorage.session = null;
  mockStorage.cleared = 0;
});

describe('tablet registration refusals', () => {
  test.each([
    ['device_in_use_by_active_agent', 409, 'device_in_use'],
    ['device_revoked', 403, 'device_revoked'],
    [undefined, 409, 'device_conflict'],
    [undefined, 403, 'forbidden'],
  ])('a %s answer (%i) becomes %s', async (code, status, expected) => {
    mockApi.registerMobileDevice.mockRejectedValue(new ElevantApiError({ status, code }));
    await expect(registerCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' })).rejects.toMatchObject({ code: expected });
  });

  test('a tablet another agent holds or OCC revoked is not retried silently', async () => {
    mockApi.registerMobileDevice.mockRejectedValue(new ElevantApiError({ status: 409, code: 'device_in_use_by_active_agent' }));
    const error = await registerCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' }).catch(failure => failure);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Otro agente usa esta tablet en una operación en curso.');
  });
});

describe('release at sign-out', () => {
  test('frees the stored installation with a new key and the session token', async () => {
    mockApi.releaseMobileDevice.mockResolvedValue(undefined);
    await expect(releaseCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' })).resolves.toBe(true);
    const [command, key, options] = mockApi.releaseMobileDevice.mock.calls[0];
    expect(command).toEqual({ installationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' });
    expect(key).toBe('82000000-0000-4000-8000-0000000000e1');
    expect(options.signal).toBeDefined();
    expect(createMobileAgentApiClient.mock.calls.at(-1)[0].getAccessToken()).toBe('token-a');
  });

  test('never creates an installation nor fails the sign-out', async () => {
    mockStorage.installationId = null;
    await expect(releaseCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' })).resolves.toBe(false);
    expect(mockApi.releaseMobileDevice).not.toHaveBeenCalled();
    mockStorage.installationId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    mockApi.releaseMobileDevice.mockRejectedValue(new ElevantApiError({ status: 409, code: 'device_not_bound' }));
    await expect(releaseCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' })).resolves.toBe(false);
  });

  test('signing out releases the tablet first and clears the session even when ELEVANT is unreachable', async () => {
    mockStorage.session = activeSession('token-b');
    mockApi.releaseMobileDevice.mockResolvedValue(undefined);
    await logoutMobileAgent();
    expect(mockApi.releaseMobileDevice).toHaveBeenCalledTimes(1);
    expect(mockStorage.cleared).toBe(1);

    mockStorage.session = activeSession('token-c');
    mockApi.releaseMobileDevice.mockRejectedValue(Object.assign(new Error('offline'), { mockNetwork: true }));
    await expect(logoutMobileAgent()).resolves.toBeUndefined();
    expect(mockStorage.cleared).toBe(2);

    // Without a session there is nothing to release: the sign-out only clears.
    await logoutMobileAgent();
    expect(mockApi.releaseMobileDevice).toHaveBeenCalledTimes(2);
    expect(mockStorage.cleared).toBe(3);
  });

  test('a registration after a release asks the server again instead of reusing the old confirmation', async () => {
    mockApi.registerMobileDevice.mockImplementation(async request => ({
      installationId: request.installationId, platform: platform(),
    }));
    mockApi.releaseMobileDevice.mockResolvedValue(undefined);
    await registerCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' });
    await releaseCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' });
    await registerCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' }, { reuseForSession: true });
    expect(mockApi.registerMobileDevice).toHaveBeenCalledTimes(2);
  });

  test('names the newest registration of the session, so a late release never frees a new sign-in', async () => {
    const answers = ['2026-11-07T10:30:00.125+00:00', '2026-11-07T10:31:00.000+00:00', '2026-11-07T10:30:30.000+00:00'];
    mockApi.registerMobileDevice.mockImplementation(async request => ({
      installationId: request.installationId, platform: platform(), appVersion: '1.0.0', lastSeenAt: answers.shift(),
    }));
    mockApi.releaseMobileDevice.mockResolvedValue(undefined);
    // A write and a periodic read registered at once: the older answer arrived last.
    const session = { accessToken: 'token-v', sessionId: 'session-v' };
    for (let index = 0; index < 3; index += 1) await registerCurrentMobileDevice(session);
    await expect(releaseCurrentMobileDevice(session)).resolves.toBe(true);
    expect(mockApi.releaseMobileDevice.mock.calls[0][0]).toEqual({
      installationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', expectedVersion: '2026-11-07T10:31:00.000+00:00',
    });
    // The confirmation ends with the session: a second release has no registration to name.
    await releaseCurrentMobileDevice({ accessToken: 'token-v', sessionId: 'session-v' });
    expect(mockApi.releaseMobileDevice.mock.calls[1][0]).toEqual({ installationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' });
  });

  test('never names the registration of another session and treats a refused late release as not released', async () => {
    mockApi.registerMobileDevice.mockImplementation(async request => ({
      installationId: request.installationId, platform: platform(), appVersion: '1.0.0',
      lastSeenAt: '2026-11-07T10:35:00.000+00:00',
    }));
    mockApi.releaseMobileDevice.mockRejectedValue(new ElevantApiError({ status: 409, code: 'version_conflict' }));
    await registerCurrentMobileDevice({ accessToken: 'token-x', sessionId: 'session-x' });
    await expect(releaseCurrentMobileDevice({ accessToken: 'token-y', sessionId: 'session-y' })).resolves.toBe(false);
    expect(mockApi.releaseMobileDevice.mock.calls[0][0]).toEqual({ installationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' });
  });

  test('the release still names the registration of the session after a renewal (S3)', async () => {
    mockApi.registerMobileDevice.mockImplementation(async request => ({
      installationId: request.installationId, platform: platform(), appVersion: '1.0.0',
      lastSeenAt: '2026-11-16T20:00:00.125+00:00',
    }));
    mockApi.releaseMobileDevice.mockResolvedValue(undefined);
    await registerCurrentMobileDevice({ accessToken: 'token-a', sessionId: 'session-1' });
    // The session renewed its access token: the same session reuses the registration it confirmed.
    await registerCurrentMobileDevice({ accessToken: 'token-a2', sessionId: 'session-1' }, { reuseForSession: true });
    expect(mockApi.registerMobileDevice).toHaveBeenCalledTimes(1);

    await expect(releaseCurrentMobileDevice({ accessToken: 'token-a2', sessionId: 'session-1' })).resolves.toBe(true);
    expect(mockApi.releaseMobileDevice.mock.calls[0][0]).toEqual({
      installationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', expectedVersion: '2026-11-16T20:00:00.125+00:00',
    });
    expect(createMobileAgentApiClient.mock.calls.at(-1)[0].getAccessToken()).toBe('token-a2');
  });

  test('signing out ends the session at ELEVANT and waits for it 5 seconds at most (S3)', async () => {
    jest.useFakeTimers();
    try {
      mockStorage.session = activeSession('token-b');
      mockApi.releaseMobileDevice.mockResolvedValue(undefined);
      let signal;
      mockApi.endSession.mockImplementation((_refreshToken, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The request was aborted.'), { name: 'AbortError' }))));
      });

      const signingOut = logoutMobileAgent();
      await jest.advanceTimersByTimeAsync(MOBILE_END_SESSION_TIMEOUT_MS);
      await expect(signingOut).resolves.toBeUndefined();

      expect(MOBILE_END_SESSION_TIMEOUT_MS).toBe(5_000);
      expect(mockApi.endSession).toHaveBeenCalledWith(REFRESH_TOKEN, expect.objectContaining({ signal }));
      expect(signal.aborted).toBe(true);
      expect(mockApi.releaseMobileDevice).toHaveBeenCalledTimes(1);
      expect(mockStorage.cleared).toBe(1);

      // A session the deployed APK opened has no refresh token: there is nothing to end at ELEVANT.
      mockStorage.session = activeSession('token-c', null);
      await logoutMobileAgent();
      expect(mockApi.endSession).toHaveBeenCalledTimes(1);
      expect(mockStorage.cleared).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('signing out renews an expired token first and waits for that renewal 5 seconds at most (S3)', async () => {
    jest.useFakeTimers();
    try {
      const session = sessionWaitingForItsRenewal();
      mockStorage.session = session;
      mockApi.releaseMobileDevice.mockResolvedValue(undefined);
      mockApi.endSession.mockResolvedValue(undefined);
      let signal;
      mockApi.refreshSession.mockImplementation((_refreshToken, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The request was aborted.'), { name: 'AbortError' }))));
      });

      const signingOut = logoutMobileAgent();
      await jest.advanceTimersByTimeAsync(MOBILE_END_SESSION_TIMEOUT_MS - 1);
      expect(mockApi.refreshSession).toHaveBeenCalledWith(REFRESH_TOKEN, expect.objectContaining({ signal }));
      // Ending the family while the renewal is on its way would refuse it: the release and the end wait for it.
      expect(mockApi.releaseMobileDevice).not.toHaveBeenCalled();
      expect(mockApi.endSession).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await expect(signingOut).resolves.toBeUndefined();
      expect(signal.aborted).toBe(true);
      // Without a renewed token the release goes with what the tablet holds, and the family still ends.
      expect(mockApi.releaseMobileDevice).toHaveBeenCalledTimes(1);
      expect(createMobileAgentApiClient.mock.calls.some(([options]) =>
        options?.getAccessToken?.() === session.accessToken)).toBe(true);
      expect(mockApi.endSession).toHaveBeenCalledWith(REFRESH_TOKEN, expect.anything());
      expect(mockStorage.cleared).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
