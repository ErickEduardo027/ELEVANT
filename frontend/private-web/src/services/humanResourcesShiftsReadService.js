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

/**
 * Removes a shift of today or later in its station's calendar (ADR-0026, 2-N31) with the shift's `version` and the
 * intent's Idempotency-Key. A shift whose agent covers stands or carries operations in it stays (`shift_in_use`,
 * 2-N11); a past one is history (`shift_in_past`).
 */
export const removeHumanResourcesShift = (id, version, idempotencyKey) =>
  authenticated(client => client.removeHumanResourcesShift(id, version, idempotencyKey));

/**
 * «Ajustar horario» (3-E): Gestión Humana and OCC change the local hours of a shift of today or later with the reason,
 * the shift's `version` (`expectedVersion`) and the intent's Idempotency-Key. The adjusted shift keeps covering the
 * agent's coverages and operations (`shift_uncovers_work`); a past shift (`shift_in_past`) or one whose attendance was
 * validated (`attendance_validated`) stays as it is. The error keeps its status and code for the screen.
 */
export const adjustHumanResourcesShift = (id, command, idempotencyKey) =>
  authenticated(client => client.adjustHumanResourcesShift(id, command, idempotencyKey));

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
