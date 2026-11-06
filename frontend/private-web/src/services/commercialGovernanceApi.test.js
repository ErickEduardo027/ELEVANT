import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSession, handleUnauthorizedResponse } from '../features/auth/authService';

vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.test');
  readSession.mockReturnValue({ token: 'hr-token' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('preserves a live 403 status so HR forms fail closed without exposing the response body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    title: 'Forbidden', detail: 'private permission trace',
  }), { status: 403, headers: { 'content-type': 'application/problem+json' } })));
  const { getRampProfiles } = await import('./commercialGovernanceApi');
  await expect(getRampProfiles()).rejects.toMatchObject({ status: 403 });
  expect(handleUnauthorizedResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
});

it('classifies a missing current session as unauthorized before requesting profiles', async () => {
  readSession.mockReturnValue(null);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { getRampProfiles } = await import('./commercialGovernanceApi');
  await expect(getRampProfiles()).rejects.toMatchObject({ status: 401 });
  expect(fetch).not.toHaveBeenCalled();
});
it('provisions through the API client with the intent key and the request version (1-N13)', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accountId: '40000000-0000-7000-8000-0000000000e1' }),
    { status: 201, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const { provisionAirline } = await import('./commercialGovernanceApi');
  await expect(provisionAirline('70000000-0000-7000-8000-0000000000e1',
    { email: 'ana@demo.test', temporaryPassword: null, expectedVersion: 'AAAAAAAAB9E=' },
    'a0000000-0000-7000-8000-0000000000e1')).resolves.toEqual({ accountId: '40000000-0000-7000-8000-0000000000e1' });
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe('https://api.example.test/api/v1/governance/provisioning/70000000-0000-7000-8000-0000000000e1');
  expect(new Headers(init.headers).get('idempotency-key')).toBe('a0000000-0000-7000-8000-0000000000e1');
  expect(JSON.parse(init.body)).toEqual({ email: 'ana@demo.test', expectedVersion: 'AAAAAAAAB9E=' });
});

it('saves an airline update with its Idempotency-Key and creates without one (1-N20)', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'p-1' }),
    { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const { saveManagedAirline } = await import('./commercialGovernanceApi');
  await saveManagedAirline('p-1', { displayName: 'Demo' }, 'a0000000-0000-7000-8000-0000000000e2');
  await saveManagedAirline(null, { displayName: 'Demo' }, 'a0000000-0000-7000-8000-0000000000e3');
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('a0000000-0000-7000-8000-0000000000e2');
  expect(fetch.mock.calls[0][1].method).toBe('PUT');
  expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBeUndefined();
});

it('reports an airline identity the api-client refuses as invalid_airline without calling the API (1-N16)', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '70000000-0000-7000-8000-0000000000a1' }),
    { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const { verifyCommercialRequestAirline } = await import('./commercialGovernanceApi');
  const requestId = '70000000-0000-7000-8000-0000000000a1';
  const key = 'a0000000-0000-7000-8000-0000000000e4';
  const identity = { expectedVersion: 'AAAAAAAAB9EAAAAAAAAH0g==', legalName: 'Copa S.A.', countryCode: 'PA', iataCode: '',
    icaoCode: 'CMP', verificationSourceUrl: 'https://www.copaair.com/' };
  for (const verificationSourceUrl of ['www.copaair.com', 'http://www.copaair.com/']) {
    const refused = await verifyCommercialRequestAirline(requestId, { ...identity, verificationSourceUrl }, key)
      .catch(error => error);
    expect(refused).toMatchObject({ code: 'invalid_airline' });
    expect(refused.status).toBeUndefined();
  }
  expect(fetch).not.toHaveBeenCalled();

  await expect(verifyCommercialRequestAirline(requestId, identity, key))
    .resolves.toEqual({ id: '70000000-0000-7000-8000-0000000000a1' });
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe(`https://api.example.test/api/v1/contracts/commercial-requests/${requestId}/airline-verification`);
  expect(new Headers(init.headers).get('idempotency-key')).toBe(key);
  expect(JSON.parse(init.body)).toMatchObject({ expectedVersion: 'AAAAAAAAB9EAAAAAAAAH0g==', iataCode: null });
});
