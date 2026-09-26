import { HubConnectionBuilder } from "@microsoft/signalr";
import type { AccountChangeListResponse } from "@elevant/api-client";
import { createPublicWebApiClient } from "./elevant-api";

interface Hub {
  state: string;
  on(name: string, callback: () => void): void;
  onreconnected(callback: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ObserverOptions {
  api: { getAccountChanges(parameters: { after?: string; limit: number }): Promise<AccountChangeListResponse> };
  createHubConnection(): Hub;
  onChanges(resources: readonly string[]): void;
  events?: Window;
  pollMs?: number;
}

/** Signals are hints; only the authorized HTTP feed acknowledges a change. */
export function createAirlineChangeObserver({ api, createHubConnection, onChanges,
  events = window, pollMs = 25_000 }: ObserverOptions) {
  const hub = createHubConnection();
  let running = false;
  let cursor: string | undefined;
  let interval: number | undefined;
  let active: Promise<void> | undefined;
  let starting: Promise<void> | undefined;
  let dirty = false;

  async function reconcile(): Promise<void> {
    if (!running) return;
    if (active) { dirty = true; return active; }
    active = (async () => {
      do {
        dirty = false;
        try {
          let page: AccountChangeListResponse;
          do {
            page = await api.getAccountChanges({ ...(cursor ? { after: cursor } : {}), limit: 100 });
            if (!running) return;
            if (page.changes.length > 0) {
              onChanges([...new Set(page.changes.map(item => item.resource))]);
              cursor = page.nextCursor ?? undefined;
            }
          } while (page.hasMore && running);
        } catch {
          return; // Keep the cursor for the next connection/focus/poll.
        }
      } while (dirty && running);
    })();
    try { await active; } finally { active = undefined; }
  }

  const changed = () => { void reconcile(); };
  const visibility = () => { if (events.document.visibilityState === "visible") changed(); };
  const ensureHubStarted = () => {
    if (!running || starting || hub.state !== "Disconnected") return;
    starting = hub.start().catch(() => {}).finally(() => { starting = undefined; });
  };

  return {
    reconcile,
    async start() {
      if (running) return;
      running = true;
      hub.on("ChangedV1", changed);
      hub.onreconnected(changed);
      events.addEventListener("focus", changed);
      events.addEventListener("online", changed);
      events.document.addEventListener("visibilitychange", visibility);
      interval = events.setInterval(() => { changed(); ensureHubStarted(); }, pollMs);
      ensureHubStarted();
      await reconcile();
    },
    async stop() {
      running = false;
      if (interval !== undefined) events.clearInterval(interval);
      events.removeEventListener("focus", changed);
      events.removeEventListener("online", changed);
      events.document.removeEventListener("visibilitychange", visibility);
      await starting;
      await hub.stop().catch(() => {});
    },
  };
}

export function createPublicAirlineChangeObserver({ baseUrl, getAccessToken, onChanges }:
  { baseUrl?: string; getAccessToken(): string; onChanges(resources: readonly string[]): void }) {
  const origin = baseUrl ?? process.env.NEXT_PUBLIC_ELEVANT_API_URL;
  if (!origin) throw new Error("NEXT_PUBLIC_ELEVANT_API_URL is required for the airline feed.");
  const api = createPublicWebApiClient({ baseUrl: origin, getAccessToken });
  return createAirlineChangeObserver({ api, onChanges,
    createHubConnection: () => new HubConnectionBuilder()
      .withUrl(`${origin.replace(/\/$/, "")}/hubs/operations`, { accessTokenFactory: getAccessToken })
      .withAutomaticReconnect([0, 2_000, 10_000, 30_000]).build() });
}
