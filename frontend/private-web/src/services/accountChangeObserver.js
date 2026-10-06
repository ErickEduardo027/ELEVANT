import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';

const HUB_PATHS = ['/hubs/operations', '/hubs/notifications'];

/** The HTTP cursor, not a socket delivery, is the acknowledgement boundary. */
export function createAccountChangeObserver({ api, createHubConnection, onChanges,
  events = window, pollMs = 25_000 }) {
  let cursor;
  let running = false;
  let poll;
  let active;
  let dirty = false;
  const hubs = HUB_PATHS.map(createHubConnection);
  const starting = new Map();

  function ensureHubStarted(hub) {
    if (!running || starting.has(hub) || hub.state !== 'Disconnected') return;
    const task = hub.start().catch(() => {}).finally(() => starting.delete(hub));
    starting.set(hub, task);
  }

  async function reconcile() {
    if (!running) return;
    if (active) {
      dirty = true;
      return active;
    }
    active = (async () => {
      do {
        dirty = false;
        try {
          let page;
          do {
            page = await api.getAccountChanges({ ...(cursor ? { after: cursor } : {}), limit: 100 });
            if (!running) return;
            if (page.changes.length) {
              // A failed consumer must replay this page instead of losing its invalidation.
              onChanges([...new Set(page.changes.map(item => item.resource))]);
              cursor = page.nextCursor;
            }
          } while (page.hasMore && running);
        } catch {
          // Connectivity and authorization failures are retried by the next focus/poll.
          return;
        }
      } while (dirty && running);
    })();
    try { await active; } finally { active = undefined; }
  }

  const onFocus = () => { void reconcile(); };
  const onVisibility = () => {
    if (events.document?.visibilityState === 'visible') void reconcile();
  };

  return {
    reconcile,
    async start() {
      if (running) return;
      running = true;
      events.addEventListener('focus', onFocus);
      events.addEventListener('online', onFocus);
      events.document?.addEventListener('visibilitychange', onVisibility);
      poll = events.setInterval(() => {
        void reconcile();
        hubs.forEach(ensureHubStarted);
      }, pollMs);
      for (const hub of hubs) {
        hub.on('ChangedV1', onFocus);
        hub.onreconnected(onFocus);
        ensureHubStarted(hub);
      }
      await reconcile();
    },
    async stop() {
      if (!running) return;
      running = false;
      events.clearInterval(poll);
      events.removeEventListener('focus', onFocus);
      events.removeEventListener('online', onFocus);
      events.document?.removeEventListener('visibilitychange', onVisibility);
      await Promise.all(starting.values());
      await Promise.all(hubs.map(hub => hub.stop().catch(() => {})));
    },
  };
}

export function createPrivateWebAccountChangeObserver(onChanges) {
  const baseUrl = process.env.NEXT_PUBLIC_ELEVANT_API_URL?.replace(/\/$/, '');
  const api = createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
  return createAccountChangeObserver({ api, onChanges,
    createHubConnection: path => new HubConnectionBuilder()
      .withUrl(`${baseUrl}${path}`, { accessTokenFactory: () => readSession()?.token ?? '' })
      .configureLogging(LogLevel.None)
      .withAutomaticReconnect([0, 2_000, 10_000, 30_000])
      .build() });
}
