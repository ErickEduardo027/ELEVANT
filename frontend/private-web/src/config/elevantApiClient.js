import { createElevantApiClient } from '@elevant/api-client';

/**
 * @typedef {Omit<import('@elevant/api-client').ElevantApiClientOptions, 'baseUrl'> & {
 *   baseUrl?: string
 * }} PrivateWebApiClientOptions
 */

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

  return createElevantApiClient({
    ...options,
    baseUrl,
  });
}
