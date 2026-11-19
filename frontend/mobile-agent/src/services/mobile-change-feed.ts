import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { AppState } from 'react-native';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';
import { createMobileChangeObserver } from './mobile-change-observer';
import { readOrCreateMobileInstallationId } from '../storage/mobile-session';

type ChangeListener = (resources: readonly string[]) => void;
const listeners = new Set<ChangeListener>();

// Same hubs as the web; native clients send no Origin and authenticate with the session JWT. Each connection and
// reconnection asks the session for its token, so a hub takes the renewed one (S3).
const hubBase = process.env.EXPO_PUBLIC_ELEVANT_API_URL?.trim().replace(/\/$/, '');
const hubs = hubBase ? ['/hubs/operations', '/hubs/notifications'].map(path => new HubConnectionBuilder()
  .withUrl(`${hubBase}${path}`, {
    accessTokenFactory: async () => (await getMobileSessionRequestContext()).accessToken,
  })
  .configureLogging(LogLevel.None)
  .withAutomaticReconnect([0, 2_000, 10_000, 30_000])
  .build()) : [];

async function readAccountChanges(accessToken: string, after: string | undefined) {
  const installationId = await readOrCreateMobileInstallationId();
  return createMobileAgentApiClient({ getAccessToken: () => accessToken })
    .getAccountChanges({ ...(after ? { after } : {}), limit: 100 }, { installationId });
}

const observer = createMobileChangeObserver({
  appState: AppState,
  hubs,
  getContext: async () => {
    const context = await getMobileSessionRequestContext();
    return { sessionId: context.sessionId, accountId: context.session.actor.accountId,
      accessToken: context.accessToken };
  },
  getChanges: async (context, after) => {
    try {
      return await readAccountChanges(context.accessToken, after);
    } catch (error) {
      const normalized = asMobileServiceError(error);
      if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
        const cleared = await rejectMobileSessionRequest(context, normalized);
        if (cleared === 'retry') {
          // The same session renewed its credential: the page is read once more with it; another refusal waits for
          // the next reconciliation.
          const renewed = await getMobileSessionRequestContext();
          if (renewed.sessionId !== context.sessionId) throw new MobileServiceError('cancelled');
          return readAccountChanges(renewed.accessToken, after);
        }
        if (!cleared) throw new MobileServiceError('cancelled');
      }
      throw normalized;
    }
  },
  onChanges: resources => {
    for (const listener of listeners) listener(resources);
  },
});

export function startMobileChangeFeed() { void observer.start(); }
export function stopMobileChangeFeed() { void observer.stop(); }
export function subscribeMobileChanges(listener: ChangeListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
