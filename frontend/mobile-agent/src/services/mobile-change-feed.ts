import { AppState } from 'react-native';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';
import { createMobileChangeObserver } from './mobile-change-observer';
import { readOrCreateMobileInstallationId } from '../storage/mobile-session';

type ChangeListener = (resources: readonly string[]) => void;
const listeners = new Set<ChangeListener>();

const observer = createMobileChangeObserver({
  appState: AppState,
  getContext: async () => {
    const context = await getMobileSessionRequestContext();
    return { sessionId: context.sessionId, accountId: context.session.actor.accountId,
      accessToken: context.accessToken };
  },
  getChanges: async (context, after) => {
    try {
      const installationId = await readOrCreateMobileInstallationId();
      return await createMobileAgentApiClient({ getAccessToken: () => context.accessToken })
        .getAccountChanges({ ...(after ? { after } : {}), limit: 100 },
          { installationId });
    } catch (error) {
      const normalized = asMobileServiceError(error);
      if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
        const cleared = await rejectMobileSessionRequest(context.sessionId);
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
