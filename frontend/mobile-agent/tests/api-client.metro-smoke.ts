import { createMobileAgentApiClient } from '../src/config/elevant-api';

export const apiClientBundleSmoke = createMobileAgentApiClient({
  baseUrl: 'https://mobile-api.elevant.test',
  fetch: globalThis.fetch,
});

if (
  typeof apiClientBundleSmoke.createSession !== 'function' ||
  typeof apiClientBundleSmoke.getCurrentSession !== 'function' ||
  typeof apiClientBundleSmoke.getRampAssignedOperations !== 'function' ||
  typeof apiClientBundleSmoke.getSystemPing !== 'function'
) {
  throw new Error('The shared ELEVANT API client was not bundled correctly.');
}
