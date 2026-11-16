import { createPrivateWebApiClient } from '../../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from './authService';

/** A late response may expire only the account and credential that sent it. */
export async function requestForAuthSession(request, { signal } = {}) {
  const session = readSession();
  const token = session?.token;
  const identity = session?.accountId ?? session?.email;
  const client = createPrivateWebApiClient({ getAccessToken: () => token });
  try { return await request(client); }
  catch (error) {
    const current = readSession();
    if (error?.status === 401 && !signal?.aborted && token &&
        current?.token === token && (current?.accountId ?? current?.email) === identity) {
      handleUnauthorizedResponse({ status: 401 });
    }
    throw error;
  }
}
