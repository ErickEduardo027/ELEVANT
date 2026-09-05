import {
  createElevantApiClient,
  type ElevantApiClientOptions,
} from '@elevant/api-client';

export type MobileAgentApiClientOptions = Omit<
  ElevantApiClientOptions,
  'baseUrl'
> & {
  readonly baseUrl?: string;
};

/**
 * Creates an API client without reading or persisting the prototype token.
 * A future authentication adapter may provide a secure token callback.
 */
export function createMobileAgentApiClient(
  options: MobileAgentApiClientOptions = {},
) {
  const baseUrl = options.baseUrl ?? process.env.EXPO_PUBLIC_ELEVANT_API_URL;
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error(
      'EXPO_PUBLIC_ELEVANT_API_URL is required to create the ELEVANT API client.',
    );
  }

  return createElevantApiClient({
    ...options,
    baseUrl,
  });
}
