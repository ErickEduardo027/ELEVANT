import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RampAircraftTypeResponse } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getMobileSessionRequestContext, MobileServiceError, rejectMobileSessionRequest } from './mobile-auth';
import { asMobileServiceError } from './mobile-service-error';

/**
 * The active aircraft types the agent may choose in «Datos del vuelo» (3-B). The list is shared reference data read
 * from ELEVANT; the device keeps the last copy only as a cache, per account, to keep offering it without signal.
 * `available: false` means there is no list at all (never read and no signal, or an older server without the
 * catalog): the screen then shows the current type read-only.
 */
export type RampAircraftTypeCatalog = Readonly<{
  types: readonly RampAircraftTypeResponse[];
  available: boolean;
  fromCache: boolean;
}>;

const KEY_PREFIX = 'elevant.rampAircraftTypes.v1.';
const MAX_TYPES = 2000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyFor = (accountId: string) => `${KEY_PREFIX}${accountId.toLowerCase()}`;
const unavailable: RampAircraftTypeCatalog = { types: [], available: false, fromCache: false };

function isType(value: unknown): value is RampAircraftTypeResponse {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && uuid.test(item.id) && typeof item.icaoCode === 'string' && item.icaoCode.length > 0 &&
    (item.iataCode === null || item.iataCode === undefined || typeof item.iataCode === 'string') &&
    typeof item.manufacturer === 'string' && typeof item.model === 'string';
}

async function readCache(accountId: string): Promise<readonly RampAircraftTypeResponse[] | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(accountId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length <= MAX_TYPES && parsed.every(isType) ? parsed : null;
  } catch {
    return null;
  }
}

/** The label the agent reads: manufacturer, model and ICAO designator. */
export const aircraftTypeLabel = (type: Pick<RampAircraftTypeResponse, 'manufacturer' | 'model' | 'icaoCode'>) =>
  `${type.manufacturer} ${type.model} · ${type.icaoCode}`;

/**
 * Reads the catalog; without signal (or a timeout) it answers the last copy saved on the device, and an older server
 * that does not have the endpoint (404) answers no catalog. A revoked session ends here, as every ramp read.
 */
export async function getRampAircraftTypes(options: { signal?: AbortSignal } = {}): Promise<RampAircraftTypeCatalog> {
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  try {
    const response = await createMobileAgentApiClient({ getAccessToken: () => context.accessToken })
      .getRampAircraftTypes({ signal: options.signal });
    const current = await getMobileSessionRequestContext();
    if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    const types = response.aircraftTypes.slice(0, MAX_TYPES);
    await AsyncStorage.setItem(keyFor(accountId), JSON.stringify(types)).catch(() => undefined);
    return { types, available: true, fromCache: false };
  } catch (error) {
    if (error instanceof MobileServiceError && error.code === 'cancelled') throw error;
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
      throw normalized;
    }
    // A server older than the catalog answers 404: the type stays read-only, as before.
    if (normalized.code === 'not_found') return unavailable;
    if (normalized.code !== 'network_unavailable' && normalized.code !== 'request_timeout') throw normalized;
    const cached = await readCache(accountId);
    return cached ? { types: cached, available: true, fromCache: true } : unavailable;
  }
}
