import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPrivateWebApiClient } from '../src/config/elevantApiClient';

const ping = {
  application: 'Elevant.Api',
  status: 'ok',
  environment: 'Testing',
  timestampUtc: '2026-09-05T12:00:00Z',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('private web API client seam', () => {
  it('uses the literal Next.js API URL without consulting the prototype adapter', async () => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://private-api.elevant.test');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(ping), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createPrivateWebApiClient({ fetch: fetchMock });

    await expect(client.getSystemPing()).resolves.toEqual(ping);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toEqual(
      new URL('https://private-api.elevant.test/api/v1/system/ping')
    );
  });

  it('fails visibly when the Next.js API URL is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', '');

    expect(() => createPrivateWebApiClient()).toThrow(/NEXT_PUBLIC_ELEVANT_API_URL/);
  });
});
