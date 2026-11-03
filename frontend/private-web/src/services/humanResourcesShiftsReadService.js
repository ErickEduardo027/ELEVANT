import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export async function getHumanResourcesShifts(query, { signal } = {}) {
  const token = readSession()?.token;
  const staleSessionError = () => {
    const error = new Error('The session changed during the request.');
    error.name = 'AbortError';
    return error;
  };
  try {
    const page = await createPrivateWebApiClient({ getAccessToken: () => token })
      .getHumanResourcesShifts(query, { signal });
    if (readSession()?.token !== token) throw staleSessionError();
    return page;
  } catch (error) {
    if (readSession()?.token !== token) throw staleSessionError();
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function getHumanResourcesShiftAssignmentOptions(query, { signal } = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getHumanResourcesShiftAssignmentOptions(query, { signal });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export async function recordHumanResourcesShift(id, request, options = {}) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).recordHumanResourcesShift(id, request, options);
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

async function authenticated(call) {
  try {
    return await call(createPrivateWebApiClient({ getAccessToken: () => readSession()?.token }));
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** Removes a shift of today or later (ADR-0026). */
export const removeHumanResourcesShift = id => authenticated(client => client.removeHumanResourcesShift(id));

/** «¿Puede operar?» of every active ramp agent (ADR-0026). */
export const listRampAgentReadiness = () => authenticated(client => client.listRampAgentReadiness());

/** Every shift of a range (the editor needs the whole week, not one page). */
export async function getAllHumanResourcesShifts(from, to, { signal } = {}) {
  const shifts = [];
  for (let page = 1; page <= 20; page++) {
    const result = await getHumanResourcesShifts({ from, to, page, limit: 100 }, { signal });
    shifts.push(...result.shifts);
    if (!result.hasMore) break;
  }
  return shifts;
}
