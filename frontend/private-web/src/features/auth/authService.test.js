import { ElevantApiError } from '@elevant/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const refreshApi = vi.hoisted(() => ({ refreshSession: vi.fn(), endSession: vi.fn() }));
vi.mock('../../config/elevantApiClient', () => ({
  createPrivateWebApiClient: () => refreshApi,
  setAccessTokenRenewer: () => {},
}));

import {
  AUTH_STORAGE_KEY,
  AUTH_EXPIRED_EVENT,
  RENEW_BEFORE_MS,
  handleUnauthorizedResponse,
  renewSession,
  PasswordChangeRequiredError,
  changePassword,
  clearSession,
  getMockUsers,
  login,
  logout,
  readSession,
} from './authService';

function apiSession(overrides = {}) {
  return {
    accessToken: 'real-access-token',
    tokenType: 'Bearer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    actor: {
      accountId: '40000000-0000-0000-0000-000000000001',
      email: 'admin.occ@dev.elevant.test',
      displayName: 'Alex Operations',
      roles: [
        {
          roleId: '50000000-0000-0000-0000-000000000001',
          code: 'ADMIN_OCC',
          name: 'Administrador OCC',
          portal: 'back_office',
          userType: 'admin_occ',
        },
      ],
      memberships: [
        {
          membershipId: '42000000-0000-0000-0000-000000000001',
          organizationId: '30000000-0000-0000-0000-000000000001',
          organizationCode: 'AVIAM',
          organizationName: 'AVIAM',
          organizationType: 'aviam_operator',
          kind: 'internal_staff',
        },
      ],
      stationScopes: [
        {
          stationId: '20000000-0000-0000-0000-000000000001',
          stationCode: 'PUJ',
        },
      ],
    },
    ...overrides,
  };
}

afterEach(() => {
  clearSession();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('session renewal (ADR-0021)', () => {
  const refreshToken = 'aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1';
  const renewable = (expiresAt) => apiSession({ expiresAt, refreshToken, refreshExpiresAt: '2099-01-01T00:00:00.000Z' });

  async function signIn(expiresAt, remember = false) {
    await login({ email: 'admin.occ@dev.elevant.test', password: 'IndividualPassword!2026', remember },
      { createSession: vi.fn().mockResolvedValue(renewable(expiresAt)) });
  }

  it('renews the access token before it expires instead of logging out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'));
    refreshApi.refreshSession.mockResolvedValue({ ...renewable('2026-09-16T12:30:00.000Z'),
      accessToken: 'renewed-access-token', refreshToken: 'zZ9-yY8_xX7wW6vV5uU4tT3sS2rR1qQ0' });
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    try {
      await signIn('2026-09-16T12:15:00.000Z', true);
      await vi.advanceTimersByTimeAsync(15 * 60_000 - RENEW_BEFORE_MS - 1);
      expect(refreshApi.refreshSession).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(refreshApi.refreshSession).toHaveBeenCalledWith(refreshToken);
      expect(readSession()).toMatchObject({ token: 'renewed-access-token', refreshToken: 'zZ9-yY8_xX7wW6vV5uU4tT3sS2rR1qQ0' });
      // Far beyond the original 15 minutes the person is still signed in.
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      expect(expired).not.toHaveBeenCalled();
      expect(readSession()).not.toBeNull();
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
    }
  });

  it('keeps the session another tab renewed and ends it only when the server refuses', async () => {
    await signIn('2099-01-01T00:00:00.000Z');
    refreshApi.refreshSession.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status: 409, title: 'Conflict' }));
    expect(await renewSession({ force: true })).toMatchObject({ refreshToken });
    expect(readSession()).not.toBeNull();

    refreshApi.refreshSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await renewSession({ force: true })).not.toBeNull();

    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    refreshApi.refreshSession.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status: 401, title: 'Unauthorized' }));
    try {
      expect(handleUnauthorizedResponse({ status: 401 })).toBe(true);
      await vi.waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
      expect(readSession()).toBeNull();
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
    }
  });

  it('revokes the refresh chain on logout', async () => {
    await signIn('2099-01-01T00:00:00.000Z');
    vi.stubEnv('NODE_ENV', 'development');
    refreshApi.endSession.mockResolvedValue(undefined);
    try {
      logout();
      expect(refreshApi.endSession).toHaveBeenCalledWith(refreshToken);
      expect(readSession()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('authService', () => {
  it('exposes the four mock back-office users only to tests', () => {
    expect(getMockUsers().map(user => user.email)).toEqual([
      'admin@elevant.test',
      'gestionhumana@elevant.test',
      'contratos@elevant.test',
      'finanzas@elevant.test',
    ]);
  });

  it('keeps the test-only mock login for existing UI tests', async () => {
    const session = await login({
      email: 'gestionhumana@elevant.test',
      password: 'Elevant2026!',
      remember: true,
    });

    expect(session).toMatchObject({
      email: 'gestionhumana@elevant.test',
      role: 'GESTION_HUMANA',
      homePath: '/gestion-humana',
    });
    expect(readSession()).toMatchObject({ email: 'gestionhumana@elevant.test' });
  });

  it('rejects invalid mock credentials', async () => {
    await expect(login({ email: 'admin@elevant.test', password: 'bad-password' })).rejects.toThrow(
      /credenciales inválidas/i
    );
  });

  it('creates and maps a real back-office session through an injected API client', async () => {
    const client = { createSession: vi.fn().mockResolvedValue(apiSession()) };

    const session = await login(
      {
        email: '  admin.occ@dev.elevant.test  ',
        password: 'IndividualPassword!2026',
        remember: true,
      },
      client
    );

    expect(client.createSession).toHaveBeenCalledWith({
      email: 'admin.occ@dev.elevant.test',
      password: 'IndividualPassword!2026',
    });
    expect(session).toMatchObject({
      token: 'real-access-token',
      accountId: '40000000-0000-0000-0000-000000000001',
      email: 'admin.occ@dev.elevant.test',
      name: 'Alex Operations',
      role: 'ADMIN_OCC',
      roleLabel: 'Administrador OCC',
      homePath: '/admin-occ',
    });
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('rejects ramp and airline roles without persisting a session', async () => {
    const client = {
      createSession: vi.fn().mockResolvedValue(
        apiSession({
          actor: {
            ...apiSession().actor,
            roles: [
              {
                roleId: '50000000-0000-0000-0000-000000000002',
                code: 'RAMP_AGENT',
                name: 'Ramp Agent',
                portal: 'ramp_mobile_app',
                userType: 'ramp_agent',
              },
              {
                roleId: '50000000-0000-0000-0000-000000000003',
                code: 'AIRLINE_CLIENT',
                name: 'Airline Client',
                portal: 'airline_portal',
                userType: 'airline_client',
              },
            ],
          },
        })
      ),
    };

    await expect(
      login({ email: 'external@dev.elevant.test', password: 'IndividualPassword!2026' }, client)
    ).rejects.toThrow(/no tiene acceso a AVIAM Web/i);
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('routes a legacy custom role to the Contracts shell scoped by its permissions', async () => {
    const client = { createSession: vi.fn().mockResolvedValue(apiSession({
      actor: { ...apiSession().actor, roles: [{
        roleId: '50000000-0000-0000-0000-000000000099',
        code: 'CUSTOM_ABCD1234EF56', name: 'Revisor comercial',
        portal: 'back_office', userType: 'custom',
      }] },
    })) };
    const session = await login({ email: 'reviewer@example.test', password: 'IndividualPassword!2026' }, client);
    expect(session).toMatchObject({ role: 'CUSTOM_ABCD1234EF56', homePath: '/contratos' });
    expect(readSession()?.homePath).toBe('/contratos');
  });

  it('removes an expired session when it is read', () => {
    window.sessionStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        token: 'expired-token',
        expiresAt: '2020-01-01T00:00:00.000Z',
        email: 'admin.occ@dev.elevant.test',
        name: 'Alex Operations',
        role: 'ADMIN_OCC',
        roleLabel: 'Administrador OCC',
        homePath: '/admin-occ',
      })
    );

    expect(readSession()).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('expires the active session once at expiresAt and dispatches the auth event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'));
    const expiresAt = '2026-09-16T12:00:02.000Z';
    const client = { createSession: vi.fn().mockResolvedValue(apiSession({ expiresAt })) };
    const expiredListener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expiredListener);

    try {
      await login(
        { email: 'admin.occ@dev.elevant.test', password: 'IndividualPassword!2026' },
        client
      );
      readSession();
      readSession();

      await vi.advanceTimersByTimeAsync(1_999);
      expect(expiredListener).not.toHaveBeenCalled();
      expect(readSession()).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(expiredListener).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(expiredListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, expiredListener);
    }
  });

  it('does not persist an already expired API session', async () => {
    const client = {
      createSession: vi.fn().mockResolvedValue(apiSession({ expiresAt: '2020-01-01T00:00:00.000Z' })),
    };

    await expect(
      login({ email: 'admin.occ@dev.elevant.test', password: 'IndividualPassword!2026' }, client)
    ).rejects.toThrow(/no fue posible completar la autenticación/i);
    expect(readSession()).toBeNull();
  });

  it('maps an API 401 to a generic credential error without exposing server metadata', async () => {
    const client = {
      createSession: vi.fn().mockRejectedValue(
        new ElevantApiError({
          kind: 'http',
          status: 401,
          title: 'Account detail that must not reach the login form',
          traceId: 'trace-auth-test',
        })
      ),
    };

    const error = await login(
      { email: 'admin.occ@dev.elevant.test', password: 'wrong-password' },
      client
    ).catch(reason => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Credenciales inválidas.');
    expect(error.message).not.toContain('Account detail');
    expect(readSession()).toBeNull();
  });

  it('routes a valid temporary credential to activation without persisting a session', async () => {
    const client = { createSession: vi.fn().mockRejectedValue(new ElevantApiError({
      kind: 'http', status: 409, title: 'Sensitive server metadata',
    })) };
    const error = await login({ email: 'contratos@dev.elevant.test', password: 'temporary' }, client)
      .catch(reason => reason);

    expect(error).toBeInstanceOf(PasswordChangeRequiredError);
    expect(error.message).not.toContain('Sensitive');
    expect(readSession()).toBeNull();
  });

  it('changes a temporary password through the API without persisting it', async () => {
    const client = { changePassword: vi.fn().mockResolvedValue(undefined) };
    await changePassword({
      email: ' contratos@dev.elevant.test ',
      currentPassword: 'Temporary-Development!2026',
      newPassword: 'New-Development-Password!2026',
    }, client);

    expect(client.changePassword).toHaveBeenCalledWith({
      email: 'contratos@dev.elevant.test',
      currentPassword: 'Temporary-Development!2026',
      newPassword: 'New-Development-Password!2026',
    });
    expect(readSession()).toBeNull();
  });

  it('uses a generic message for network and unexpected failures', async () => {
    const client = { createSession: vi.fn().mockRejectedValue(new Error('socket and host details')) };

    await expect(
      login({ email: 'admin.occ@dev.elevant.test', password: 'IndividualPassword!2026' }, client)
    ).rejects.toThrow('No fue posible completar la autenticación.');
    expect(readSession()).toBeNull();
  });

  it('logs out by clearing local state without calling a nonexistent endpoint', async () => {
    const client = { createSession: vi.fn().mockResolvedValue(apiSession()) };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await login({ email: 'admin.occ@dev.elevant.test', password: 'IndividualPassword!2026' }, client);

    logout();

    expect(readSession()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});