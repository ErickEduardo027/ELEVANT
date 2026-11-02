import { createElevantApiClient } from '@elevant/api-client';

/**
 * @typedef {Omit<import('@elevant/api-client').ElevantApiClientOptions, 'baseUrl'> & {
 *   baseUrl?: string
 * }} PrivateWebApiClientOptions
 */

let renewAccessToken = null;

/**
 * Registered by the session store (authService) so every client renews an expiring access
 * token before using it, without importing the session store here (ADR-0021).
 *
 * @param {(() => Promise<unknown>) | null} renewer
 */
export function setAccessTokenRenewer(renewer) {
  renewAccessToken = renewer;
}

/**
 * Creates an API client without coupling it to the prototype session store.
 * A future remote adapter may provide a request-scoped token callback.
 *
 * @param {PrivateWebApiClientOptions} [options]
 */
export function createPrivateWebApiClient(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_ELEVANT_API_URL;
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error('NEXT_PUBLIC_ELEVANT_API_URL is required to create the ELEVANT API client.');
  }

  const getAccessToken = options.getAccessToken;
  return createElevantApiClient({
    ...options,
    baseUrl,
    ...(getAccessToken && {
      // Renew first when the token is about to expire; the getter then reads the new one.
      getAccessToken: async () => {
        if (renewAccessToken) await renewAccessToken();
        return getAccessToken();
      },
    }),
  });
}
