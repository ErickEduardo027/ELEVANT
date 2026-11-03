import type { RampAgentScheduleData } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';

/** Days the tablet shows: today and the next 13 (ADR-0026). */
export const SCHEDULE_DAYS = 14;

function dateKey(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Range from today to the next 13 days, in the device's local calendar. */
export function scheduleRange(today: Date = new Date()): { from: string; to: string } {
  const end = new Date(today);
  end.setDate(end.getDate() + SCHEDULE_DAYS - 1);
  return { from: dateKey(today), to: dateKey(end) };
}

/**
 * The signed-in agent's shifts and documents, read from the API under the current session.
 * Read-only: the tablet never stores it as truth, and a revoked session ends here.
 */
export async function getOwnSchedule(signal?: AbortSignal, today?: Date): Promise<RampAgentScheduleData> {
  const context = await getMobileSessionRequestContext();
  const { from, to } = scheduleRange(today);
  try {
    const result = await createMobileAgentApiClient({ getAccessToken: () => context.accessToken })
      .getOwnRampSchedule(from, to, { signal });
    if (signal?.aborted) throw new MobileServiceError('cancelled');
    const current = await getMobileSessionRequestContext();
    if (current.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
    return result;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
      const cleared = await rejectMobileSessionRequest(context.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}
