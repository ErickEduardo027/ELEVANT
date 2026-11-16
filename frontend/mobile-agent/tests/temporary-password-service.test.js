// First sign-in with a temporary password (Gestión Humana): the 409 password_change_required is a typed failure, and
// the change goes to POST auth/password-change through the tablet's client factory and fetch wrapper (base URL,
// timeout, network errors) over a mocked fetch: no network, no password stored. Jest cannot load the shared client's
// TypeScript source from this app (its Babel runtime is outside the package), so a stand-in with the same two calls
// (`changePassword`, `createSession`) and the same ElevantApiError replaces it; packages/api-client tests the real one.
process.env.EXPO_PUBLIC_ELEVANT_API_URL = 'https://api.elevant.test';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@elevant/api-client', () => {
  class ElevantApiError extends Error {
    constructor({ kind = 'http', status, code, traceId }) {
      super(`API ${status}`);
      this.kind = kind;
      this.status = status;
      this.code = code;
      this.traceId = traceId;
    }
  }
  const createElevantApiClient = ({ baseUrl, fetch }) => {
    const post = async (path, body, options) => {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: options?.signal, method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const problem = JSON.parse((await response.text()) || '{}');
        throw new ElevantApiError({ status: response.status, code: problem.code });
      }
      return response;
    };
    return {
      changePassword: async (request, options) => { await post('/api/v1/auth/password-change', request, options); },
      createSession: async (request, options) =>
        JSON.parse(await (await post('/api/v1/auth/session', request, options)).text()),
    };
  };
  return {
    ElevantApiError, createElevantApiClient,
    SessionPortal: { ramp_mobile_app: 'ramp_mobile_app' },
    SessionOrganizationType: { aviam_operator: 'aviam_operator' },
    SessionMembershipKind: { internal_staff: 'internal_staff' },
  };
});
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
  readValidMobileAccessToken: jest.fn(async () => null),
  readStoredMobileSession: jest.fn(async () => ({ kind: 'missing' })),
  clearStoredMobileSession: jest.fn(async () => undefined),
  clearStoredMobileSessionIfCurrent: jest.fn(async () => true),
  updateStoredMobileSessionMetadata: jest.fn(async () => true),
  writeStoredMobileSession: jest.fn(async () => 'session-1'),
  countPendingEvidence: jest.fn(async () => ({ current: 0, others: 0 })),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: jest.fn(async () => undefined),
  releaseCurrentMobileDevice: jest.fn(async () => undefined),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { asMobileServiceError, MobileServiceError } = require('../src/services/mobile-service-error');
const { changeTemporaryPassword, loginMobileAgent } = require('../src/services/mobile-auth');
const storage = require('../src/storage/mobile-session');

const headers = (values = {}) => ({
  get: name => values[name.toLowerCase()] ?? null,
  has: name => name.toLowerCase() in values,
  forEach: callback => Object.entries(values).forEach(([key, value]) => callback(value, key)),
});
function response(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(body === undefined ? {} : { 'content-type': 'application/problem+json' }),
    text: async () => text,
  };
}
const problem = (status, extra = {}) => ({ type: 'about:blank', title: 'Problem', status, ...extra });

const email = 'nuevo.agente@aviam.test';
const temporary = 'Temporal-Clave-2026!';
const next = 'Nueva-Clave-Segura-26';

let fetchMock;
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

describe('error mapping', () => {
  const apiError = (status, code) => new ElevantApiError({ kind: 'http', status, code });

  test('409 password_change_required is its own typed code on sign-in and elsewhere, never retried', () => {
    for (const context of ['login', 'authenticated', 'password_change']) {
      const error = asMobileServiceError(apiError(409, 'password_change_required'), context);
      expect(error).toBeInstanceOf(MobileServiceError);
      expect(error.code).toBe('password_change_required');
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Debes cambiar la contraseña temporal antes de entrar.');
    }
  });

  test('another 409 keeps being a conflict', () => {
    expect(asMobileServiceError(apiError(409, undefined), 'login').code).toBe('conflict');
  });

  test('the password change names policy, invalid temporary password and rate limit', () => {
    expect(asMobileServiceError(apiError(400), 'password_change').code).toBe('password_policy_rejected');
    expect(asMobileServiceError(apiError(401), 'password_change').code).toBe('current_password_invalid');
    expect(asMobileServiceError(apiError(429), 'password_change').code).toBe('rate_limited');
    expect(asMobileServiceError(apiError(429), 'login').code).toBe('rate_limited');
  });

  test('authenticated screens keep their earlier meaning for 401 and 429', () => {
    expect(asMobileServiceError(apiError(401)).code).toBe('unauthenticated');
    const limited = asMobileServiceError(apiError(429));
    expect(limited.code).toBe('request_failed');
    expect(limited.retryable).toBe(true);
    expect(asMobileServiceError(apiError(401), 'login').code).toBe('authentication_failed');
  });
});

describe('changeTemporaryPassword', () => {
  test('204 posts the three fields once to auth/password-change and stores nothing', async () => {
    fetchMock.mockResolvedValueOnce(response(204));
    await expect(changeTemporaryPassword(` ${email} `, temporary, next)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.elevant.test/api/v1/auth/password-change');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email, currentPassword: temporary, newPassword: next });
    expect(Object.keys(init.headers).map(name => name.toLowerCase())).not.toContain('authorization');
    expect(init.signal).toBeDefined();
    expect(storage.writeStoredMobileSession).not.toHaveBeenCalled();
    expect(storage.readValidMobileAccessToken).not.toHaveBeenCalled();
  });

  test.each([
    [400, 'password_policy_rejected', 'La nueva contraseña no cumple la política'],
    [401, 'current_password_invalid', 'La contraseña temporal no es válida'],
    [429, 'rate_limited', 'Demasiados intentos. Espera un minuto'],
  ])('%i becomes %s', async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(response(status, problem(status)));
    const failure = await changeTemporaryPassword(email, temporary, next).catch(error => error);
    expect(failure).toBeInstanceOf(MobileServiceError);
    expect(failure.code).toBe(code);
    expect(failure.message).toContain(message);
    expect(failure.message).not.toContain(temporary);
    expect(failure.message).not.toContain(next);
  });

  test('a network failure is the same unavailable failure as everywhere in the tablet', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(changeTemporaryPassword(email, temporary, next)).rejects.toMatchObject({ code: 'network_unavailable' });
  });

  test('empty fields never reach the network', async () => {
    await expect(changeTemporaryPassword(email, '', next)).rejects.toMatchObject({ code: 'current_password_invalid' });
    await expect(changeTemporaryPassword(email, temporary, '')).rejects.toMatchObject({ code: 'password_policy_rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

test('sign-in with a temporary password rejects with password_change_required and stores no session', async () => {
  fetchMock.mockResolvedValueOnce(response(409, problem(409, { code: 'password_change_required' })));
  const failure = await loginMobileAgent(email, temporary).catch(error => error);
  expect(failure).toBeInstanceOf(MobileServiceError);
  expect(failure.code).toBe('password_change_required');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email, password: temporary });
  expect(storage.writeStoredMobileSession).not.toHaveBeenCalled();
});
