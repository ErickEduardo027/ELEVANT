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

interface MobileChangeObserverOptions {
  appState: AppStateSource;
  getContext(): Promise<MobileChangeContext>;
  getChanges(context: MobileChangeContext, cursor?: string): Promise<AccountChangeListResponse>;
  onChanges(resources: readonly string[]): void;
  pollMs?: number;
}

/** Foreground REST reconciliation; no claim of Android push while closed. */
export function createMobileChangeObserver({ appState, getContext, getChanges,
  onChanges, pollMs = 25_000 }: MobileChangeObserverOptions) {
  let running = false;
  let foreground = appState.currentState !== 'background';
  let identity: string | undefined;
  let cursor: string | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let subscription: { remove(): void } | undefined;
  let active: Promise<void> | undefined;
  let dirty = false;

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
        if (foreground && !wasForeground) void reconcile();
      });
      interval = setInterval(() => { if (foreground) void reconcile(); }, pollMs);
      await reconcile();
    },
    async stop() {
      running = false;
      if (interval) clearInterval(interval);
      subscription?.remove();
      identity = undefined;
      cursor = undefined;
    },
  };
}
