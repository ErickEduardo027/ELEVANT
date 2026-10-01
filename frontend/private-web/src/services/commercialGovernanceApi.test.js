import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSession, handleUnauthorizedResponse } from '../features/auth/authService';

vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_ELEVANT_API_URL', 'https://api.example.test');
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
