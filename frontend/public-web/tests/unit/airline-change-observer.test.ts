import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { createAirlineChangeObserver, createPublicAirlineChangeObserver } from "@/lib/airline-change-observer";

const eventId = "10000000-0000-0000-0000-000000000001";
const change = (cursor: string) => ({ eventId, cursor, resource: "airline_operations",
  resourceId: eventId, occurredAt: "2026-09-26T00:00:00Z" });

function fixture() {
  const api = { getAccountChanges: vi.fn().mockResolvedValue({ changes: [], nextCursor: null, hasMore: false }) };
  const handlers: Record<string, () => void> = {};
  const hub = { state: "Disconnected", on: vi.fn((name: string, callback: () => void) => { handlers[name] = callback; }),
    onreconnected: vi.fn((callback: () => void) => { handlers.reconnected = callback; }),
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
  const onChanges = vi.fn();
  const observer = createAirlineChangeObserver({ api, createHubConnection: () => hub,
    onChanges, events: window });
  return { api, hub, handlers, onChanges, observer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("does not write a bearer-token WebSocket URL to the browser console", () => {
  const originalBuild = HubConnectionBuilder.prototype.build;
  let connection: ReturnType<HubConnectionBuilder["build"]> | undefined;
  vi.spyOn(HubConnectionBuilder.prototype, "build").mockImplementation(function (this: HubConnectionBuilder) {
    connection = originalBuild.call(this);
    return connection;
  });
  const info = vi.spyOn(console, "info").mockImplementation(() => {});

  createPublicAirlineChangeObserver({
    baseUrl: "https://api.test",
    getAccessToken: () => "secret-canary",
    onChanges: () => {},
  });

  const logger = (connection as unknown as { connection: { _logger: { log(level: number, message: string): void } } })
    .connection._logger;
  logger.log(LogLevel.Information, "WebSocket connected to wss://api.test/hubs/operations?access_token=secret-canary.");
  expect(info).not.toHaveBeenCalled();
});

it("drains authorized pages and resumes from the last cursor on a socket hint", async () => {
  const f = fixture();
  f.api.getAccountChanges.mockResolvedValueOnce({ changes: [change("c1")], nextCursor: "c1", hasMore: true });
  f.api.getAccountChanges.mockResolvedValueOnce({ changes: [change("c2")], nextCursor: "c2", hasMore: false });
  await f.observer.start();
  expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(1, { limit: 100 });
  expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(2, { after: "c1", limit: 100 });
  expect(f.onChanges).toHaveBeenCalledWith(["airline_operations"]);
  f.handlers.ChangedV1();
  await f.observer.reconcile();
  expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(3, { after: "c2", limit: 100 });
  await f.observer.stop();
});

it("reconciles on reconnect and bounded poll after a failed page", async () => {
  const f = fixture();
  f.api.getAccountChanges.mockRejectedValueOnce(new Error("offline"));
  await f.observer.start();
  f.handlers.reconnected();
  await f.observer.reconcile();
  await vi.advanceTimersByTimeAsync(25_000);
  expect(f.api.getAccountChanges.mock.calls.length).toBeGreaterThanOrEqual(3);
  await f.observer.stop();
});

it("stops the hub and ignores late pages after sign-out", async () => {
  const f = fixture();
  let resolvePage: (page: { changes: ReturnType<typeof change>[]; nextCursor: string; hasMore: boolean }) => void = () => {};
  f.api.getAccountChanges.mockReturnValue(new Promise(resolve => { resolvePage = resolve; }));
  const started = f.observer.start();
  await f.observer.stop();
  resolvePage({ changes: [change("c1")], nextCursor: "c1", hasMore: false });
  await started;
  f.handlers.ChangedV1();
  expect(f.onChanges).not.toHaveBeenCalled();
  expect(f.hub.stop).toHaveBeenCalledOnce();
});
