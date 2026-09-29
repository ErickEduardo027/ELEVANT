import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export async function getHumanResourcesShifts(query, { signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesShifts(query, { signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}
