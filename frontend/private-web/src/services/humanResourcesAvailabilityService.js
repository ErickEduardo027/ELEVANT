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

/**
 * Approves, rejects or cancels a pending request: `request` is `{ decision, note, expectedVersion }` with the
 * `version` on screen, and it travels with the intent's Idempotency-Key. Approving a day off or a restriction
 * releases the agent's work of those days (2-N08) or fails with `agent_has_operation_in_progress`.
 */
export function resolveHumanResourcesAvailabilityRequest(id, request, idempotencyKey) {
  return withCurrentSession(client =>
    client.resolveHumanResourcesAvailabilityRequest(id, request, idempotencyKey));
}

/**
 * Cancels an approved absence that has not started or shortens one that has not ended (2-N22): `command` is
 * `{ action: 'Cancel' | 'Shorten', endsOn, reason, expectedVersion }` and travels with its Idempotency-Key.
 */
export function amendHumanResourcesAvailabilityRequest(id, command, idempotencyKey) {
  return withCurrentSession(client =>
    client.amendHumanResourcesAvailabilityRequest(id, command, idempotencyKey));
}

const ABSENCE_TYPES = new Set(['DayOff', 'Restriction']);

/**
 * The approved days off and restrictions that overlap `from`–`to` (up to 31 days), every page: the weekly editor
 * marks those days and «Copiar semana anterior» skips them (2-N24). The server refuses a shift on them anyway.
 */
export async function getApprovedAbsences(from, to, { signal } = {}) {
  const absences = [];
  for (let page = 1; page <= 20; page++) {
    const result = await getHumanResourcesAvailabilityRequests({ from, to, page, limit: 100 }, { signal });
    absences.push(...result.requests.filter(item => item.status === 'Approved' && ABSENCE_TYPES.has(item.type)));
    if (!result.hasMore) break;
  }
  return absences;
}
