import {
  createElevantApiClient,
  type ElevantApiClient,
  type ElevantApiClientOptions,
} from '@elevant/api-client';
import { readValidMobileAccessToken } from '../storage/mobile-session';

export const MOBILE_REQUEST_TIMEOUT_MS = 15_000;

export type MobileAgentApiClientOptions = Omit<
  ElevantApiClientOptions,
  'baseUrl'
> & {
  readonly baseUrl?: string;
};

export class MobileAgentNetworkError extends Error {
  constructor() {
    super('The ELEVANT API network is unavailable.');
    this.name = 'MobileAgentNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export function isMobileAgentNetworkError(
  error: unknown,
): error is MobileAgentNetworkError {
  return error instanceof MobileAgentNetworkError;
}

function networkAwareFetch(
  fetchImplementation: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const callerSignal = init?.signal;
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MOBILE_REQUEST_TIMEOUT_MS);

    try {
      return await fetchImplementation(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new MobileAgentNetworkError();
      if (callerSignal?.aborted || isAbortError(error)) throw error;
      throw new MobileAgentNetworkError();
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  };
}

function validateBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('EXPO_PUBLIC_ELEVANT_API_URL must be an absolute URL.');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(
      'EXPO_PUBLIC_ELEVANT_API_URL cannot contain credentials, query parameters, or fragments.',
    );
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2']);
  const developmentLoopback =
    __DEV__ && parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !developmentLoopback) {
    throw new TypeError('EXPO_PUBLIC_ELEVANT_API_URL must use HTTPS.');
  }

  return value.replace(/\/$/, '');
}

/**
 * Creates the shared OpenAPI client for Mobile Agent. Authenticated operations
 * read the short-lived bearer token from SecureStore immediately before each
 * request; the client never retains or logs it.
 */
export function createMobileAgentApiClient(
  options: MobileAgentApiClientOptions = {},
): ElevantApiClient {
  const baseUrl = options.baseUrl ?? process.env.EXPO_PUBLIC_ELEVANT_API_URL;
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new TypeError(
      'EXPO_PUBLIC_ELEVANT_API_URL is required to create the ELEVANT API client.',
    );
  }

  const validatedBaseUrl = validateBaseUrl(baseUrl.trim());
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }

  return createElevantApiClient({
    ...options,
    baseUrl: validatedBaseUrl,
    fetch: networkAwareFetch(fetchImplementation),
    getAccessToken: options.getAccessToken ?? readValidMobileAccessToken,
  });
}
