import type { AccountChangeListResponse } from '@elevant/api-client';

export interface MobileChangeContext {
  readonly sessionId: string;
  readonly accountId: string;
  readonly accessToken: string;
}

interface AppStateSource {
  currentState: string;
  addEventListener(event: 'change', listener: (state: string) => void): { remove(): void };
}

/** The part of a SignalR HubConnection the observer uses; the event only says «something changed». */
export interface MobileChangeHub {
  readonly state: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'ChangedV1', listener: () => void): void;
  onreconnected(listener: () => void): void;
}

interface MobileChangeObserverOptions {
  appState: AppStateSource;
  hubs?: readonly MobileChangeHub[];
  getContext(): Promise<MobileChangeContext>;
  getChanges(context: MobileChangeContext, cursor?: string): Promise<AccountChangeListResponse>;
  onChanges(resources: readonly string[]): void;
  pollMs?: number;
}

/**
 * Foreground REST reconciliation, woken at once by SignalR while the app is open; no claim of
 * Android push while closed. The HTTP cursor, not the socket, acknowledges each change.
 */
export function createMobileChangeObserver({ appState, hubs = [], getContext, getChanges,
  onChanges, pollMs = 25_000 }: MobileChangeObserverOptions) {
  let running = false;
  let foreground = appState.currentState !== 'background';
  let identity: string | undefined;
  let cursor: string | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let subscription: { remove(): void } | undefined;
  let active: Promise<void> | undefined;
  let dirty = false;
  const starting = new Set<MobileChangeHub>();

  function connectHubs() {
    for (const hub of hubs) {
      if (!running || !foreground || starting.has(hub) || hub.state !== 'Disconnected') continue;
      starting.add(hub);
      void hub.start().catch(() => {}).finally(() => starting.delete(hub));
    }
  }

  function disconnectHubs() {
    for (const hub of hubs) void hub.stop().catch(() => {});
  }

  async function reconcile(): Promise<void> {
    if (!running || !foreground) return;
    if (active) { dirty = true; return active; }
    active = (async () => {
      do {
        dirty = false;
        try {
          const context = await getContext();
          if (!running || !foreground) return;
          const requestIdentity = `${context.accountId}:${context.sessionId}`;
          if (identity !== requestIdentity) { identity = requestIdentity; cursor = undefined; }
          let page: AccountChangeListResponse;
          do {
            page = await getChanges(context, cursor);
            const current = await getContext();
            if (!running || !foreground ||
                `${current.accountId}:${current.sessionId}` !== requestIdentity) return;
            if (page.changes.length > 0) {
              onChanges([...new Set(page.changes.map(item => item.resource))]);
              cursor = page.nextCursor ?? undefined;
            }
          } while (page.hasMore && running && foreground);
        } catch {
          // A missing session or transient network failure does not acknowledge a page.
          return;
        }
      } while (dirty && running && foreground);
    })();
    try { await active; } finally { active = undefined; }
  }

  return {
    reconcile,
    async start() {
      if (running) return;
      running = true;
      foreground = appState.currentState !== 'background';
      subscription = appState.addEventListener('change', state => {
        const wasForeground = foreground;
        foreground = state === 'active';
        if (foreground && !wasForeground) { connectHubs(); void reconcile(); }
        if (!foreground && wasForeground) disconnectHubs();
      });
      for (const hub of hubs) {
        hub.on('ChangedV1', () => { void reconcile(); });
        hub.onreconnected(() => { void reconcile(); });
      }
      connectHubs();
      interval = setInterval(() => { if (foreground) { connectHubs(); void reconcile(); } }, pollMs);
      await reconcile();
    },
    async stop() {
      running = false;
      if (interval) clearInterval(interval);
      subscription?.remove();
      disconnectHubs();
      identity = undefined;
      cursor = undefined;
    },
  };
}
