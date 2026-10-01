import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

async function withCurrentSession(action) {
  try {
    return await action(createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }));
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export function getHumanResourcesAvailabilityRequests(query, { signal } = {}) {
  return withCurrentSession(client =>
    client.getHumanResourcesAvailabilityRequests(query, { signal }));
}

export function recordHumanResourcesAvailabilityRequest(id, request, options = {}) {
  return withCurrentSession(client =>
    client.recordHumanResourcesAvailabilityRequest(id, request, options));
}

export function resolveHumanResourcesAvailabilityRequest(id, request, options = {}) {
  return withCurrentSession(client =>
    client.resolveHumanResourcesAvailabilityRequest(id, request, options));
}
