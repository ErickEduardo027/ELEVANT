import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export async function getHumanResourcesPermits(query, { signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesPermits(query, { signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function recordHumanResourcesPermit(id, request, options = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).recordHumanResourcesPermit(id, request, options);
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function getHumanResourcesPermitSummary(query, { signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesPermitSummary(query, { signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function getHumanResourcesPermitHistory(id, { signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesPermitHistory(id, { signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}
