import { createMobileAgentApiClient } from '../src/config/elevant-api';

export const apiClientBundleSmoke = createMobileAgentApiClient({
  baseUrl: 'https://mobile-api.elevant.test',
  fetch: globalThis.fetch,
});

if (typeof apiClientBundleSmoke.getSystemPing !== 'function') {
  throw new Error('The shared ELEVANT API client was not bundled correctly.');
}
