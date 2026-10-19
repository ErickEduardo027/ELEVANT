import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

export class TrafficServiceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TrafficServiceError';
    this.code = code;
  }
}

export async function loadRegionalTraffic(stationId, { signal } = {}) {
  try {
    const client = createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
    return await client.getOccAircraftTraffic({ stationId }, { signal });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    if (error instanceof ElevantApiError && error.status === 401) {
      handleUnauthorizedResponse({ status: 401 });
      throw new TrafficServiceError('unauthorized');
    }
    if (error instanceof ElevantApiError && error.status === 403) {
      throw new TrafficServiceError('forbidden');
    }
    throw new TrafficServiceError('unavailable');
  }
}
