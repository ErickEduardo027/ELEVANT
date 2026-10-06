import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

function staleSessionError() {
  const error = new Error('The session changed during the request.');
  error.name = 'AbortError';
  return error;
}

export async function getHumanResourcesScheduleWarnings(query, { signal } = {}) {
  const token = readSession()?.token;
  if (!token) throw Object.assign(new Error('Authentication is required.'), { status: 401 });

  try {
    const page = await createPrivateWebApiClient({ getAccessToken: () => token })
      .getHumanResourcesScheduleWarnings(query, { signal });
    if (readSession()?.token !== token) throw staleSessionError();
    return page;
  } catch (error) {
    // A late 401 from an old account must not expire a newly opened session.
    if (readSession()?.token !== token) throw staleSessionError();
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}
