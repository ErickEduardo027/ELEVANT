import { normalizedRevokeOccMobileDevice, normalizedUnbindOccMobileDevice } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

/** Who holds each shared tablet (2-N02). */
export const DEVICE_STATUSES = Object.freeze({
  Bound: { label: 'En uso', tone: 'info' },
  Unbound: { label: 'Libre', tone: 'success' },
  Revoked: { label: 'Revocada', tone: 'danger' },
});

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/**
 * Checks the body with the shared client's rules before sending it, so an invalid reason is explained as invalid
 * data (400 with the server's code) and never confused with a network failure.
 */
function validated(normalize, input, code) {
  try { normalize(input); } catch {
    throw Object.assign(new Error(code), { status: 400, code });
  }
}

/** The tablets last used by agents of the station and what the actor may do (`operations.devices.read`). */
export const loadOccDevices = (stationId, { signal } = {}) =>
  guarded(() => client().getOccMobileDevices(stationId, { signal }));

/** Frees a tablet with the binding token on screen and the intent's Idempotency-Key. */
export const unbindOccDevice = async (deviceId, command, idempotencyKey) => {
  validated(normalizedUnbindOccMobileDevice, command, 'reason_required');
  return guarded(() => client().unbindOccMobileDevice(deviceId, command, idempotencyKey));
};

/** Revokes a lost tablet with a reason: it never registers again and its holder's sessions end. */
export const revokeOccDevice = async (deviceId, command, idempotencyKey) => {
  validated(normalizedRevokeOccMobileDevice, command, 'reason_required');
  return guarded(() => client().revokeOccMobileDevice(deviceId, command, idempotencyKey));
};
