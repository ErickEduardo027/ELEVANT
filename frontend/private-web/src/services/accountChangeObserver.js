import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';

const HUB_PATHS = ['/hubs/operations', '/hubs/notifications'];

/**
 * The HTTP cursor, not a socket delivery, is the acknowledgement boundary.
 *
 * `onStatus` (optional) receives `{ hubs: [{ path, state }], lastOkAt, lastErrorAt, failingSince }` whenever a hub
 * start settles, a hub reconnects or closes, and after each reconcile; `state` is SignalR's `HubConnection.state`.
 * A reconcile that does not finish (the request or the consumer failed) sets `lastErrorAt` and, from the first
 * failure of a streak, `failingSince`; the next one that finishes sets `lastOkAt` and clears `failingSince`.
 * Nothing is reported after `stop()`.
 *
 * `hintCoalesceMs` (0 by default: every hint reconciles at once) groups the hubs' `ChangedV1` hints: the first one after
 * a quiet window reconciles at once, and the hints that arrive less than `hintCoalesceMs` after the last reconcile began
 * share one trailing reconcile at the end of that window. A reconcile that begins for any other reason (start, focus,
 * the poll, a reconnect) also counts for the window and satisfies a trailing one that waits. The HTTP cursor still
 * decides what changed, so a grouped hint loses nothing; it only arrives up to `hintCoalesceMs` later.
 */
export function createAccountChangeObserver({ api, createHubConnection, onChanges,
  events = window, pollMs = 25_000, onStatus, now = () => Date.now(), hintCoalesceMs = 0 }) {
  let cursor;
  let running = false;
  let poll;
  let active;
  let dirty = false;
  let lastOkAt = null;
  let lastErrorAt = null;
  let failingSince = null;
  let lastPassAt = null;
  let hintTimer = null;
  const hubs = HUB_PATHS.map(createHubConnection);
  const starting = new Map();

  function emit() {
    if (!running || !onStatus) return;
    onStatus({
      hubs: hubs.map((hub, index) => ({ path: HUB_PATHS[index], state: hub.state })),
      lastOkAt, lastErrorAt, failingSince,
    });
  }

  function ensureHubStarted(hub) {
    if (!running || starting.has(hub) || hub.state !== 'Disconnected') return;
    const task = hub.start().catch(() => {}).finally(() => { starting.delete(hub); emit(); });
    starting.set(hub, task);
  }

  async function reconcile() {
    if (!running) return;
    if (active) {
      dirty = true;
      return active;
    }
    active = (async () => {
      try {
        do {
          dirty = false;
          // This pass sees every change committed before it: a trailing hint read that waits is not needed any more.
          lastPassAt = now();
          clearHintTimer();
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
        } while (dirty && running);
        lastOkAt = now();
        failingSince = null;
      } catch {
        // Connectivity and authorization failures are retried by the next focus/poll.
        lastErrorAt = now();
        failingSince ??= lastErrorAt;
      }
      emit();
    })();
    try { await active; } finally { active = undefined; }
  }

  function clearHintTimer() {
    if (hintTimer === null) return;
    events.clearTimeout(hintTimer);
    hintTimer = null;
  }

  function onHint() {
    if (!running) return;
    if (!(hintCoalesceMs > 0)) {
      void reconcile();
      return;
    }
    if (hintTimer !== null) return;
    const wait = lastPassAt === null ? 0 : lastPassAt + hintCoalesceMs - now();
    if (wait <= 0) {
      void reconcile();
      return;
    }
    hintTimer = events.setTimeout(() => {
      hintTimer = null;
      void reconcile();
    }, wait);
  }

  const onFocus = () => { void reconcile(); };
  // The only reconnected handler: report the hub, then reconcile what the socket may have missed.
  const onReconnected = () => { emit(); onFocus(); };
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
        hub.on('ChangedV1', onHint);
        hub.onreconnecting?.(emit);
        hub.onreconnected(onReconnected);
        hub.onclose?.(emit);
        ensureHubStarted(hub);
      }
      await reconcile();
    },
    async stop() {
      if (!running) return;
      running = false;
      events.clearInterval(poll);
      clearHintTimer();
      events.removeEventListener('focus', onFocus);
      events.removeEventListener('online', onFocus);
      events.document?.removeEventListener('visibilitychange', onVisibility);
      await Promise.all(starting.values());
      await Promise.all(hubs.map(hub => hub.stop().catch(() => {})));
    },
  };
}

export function createPrivateWebAccountChangeObserver(onChanges, { onStatus, hintCoalesceMs = 0 } = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_ELEVANT_API_URL?.replace(/\/$/, '');
  const api = createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
  return createAccountChangeObserver({ api, onChanges, onStatus, hintCoalesceMs,
    createHubConnection: path => new HubConnectionBuilder()
      .withUrl(`${baseUrl}${path}`, { accessTokenFactory: () => readSession()?.token ?? '' })
      .configureLogging(LogLevel.None)
      .withAutomaticReconnect([0, 2_000, 10_000, 30_000])
      .build() });
}
