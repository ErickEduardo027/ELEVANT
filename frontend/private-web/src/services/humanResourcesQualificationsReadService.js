import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export async function getHumanResourcesQualifications(query, { signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesQualifications(query, { signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function getHumanResourcesQualificationEquipmentTypes({ signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesQualificationEquipmentTypes({ signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function recordHumanResourcesQualification(id, request, options = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).recordHumanResourcesQualification(id, request, options);
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}
