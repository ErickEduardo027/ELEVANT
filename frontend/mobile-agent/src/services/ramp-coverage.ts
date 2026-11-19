import type { RampOwnCoverageListResponse } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';

/**
 * «Mis posiciones de hoy» (ADR-0030): the stands OCC handed this agent for the next hours.
 * Read-only from the API; a revoked session ends here like every other read, and a credential the session renewed
 * reads once more (S3).
 */
export function getOwnCoverage(signal?: AbortSignal): Promise<RampOwnCoverageListResponse> {
  return readOwnCoverage(signal, false);
}

async function readOwnCoverage(signal: AbortSignal | undefined, retried: boolean): Promise<RampOwnCoverageListResponse> {
  const context = await getMobileSessionRequestContext();
  try {
    const result = await createMobileAgentApiClient({ getAccessToken: () => context.accessToken })
      .getOwnRampCoverage({ signal });
    if (signal?.aborted) throw new MobileServiceError('cancelled');
    const current = await getMobileSessionRequestContext();
    if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    return result;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context, normalized);
      if (cleared === 'retry' && !retried) return readOwnCoverage(signal, true);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}
