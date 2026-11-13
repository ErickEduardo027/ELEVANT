import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { createAccountChangeObserver, createPrivateWebAccountChangeObserver } from './accountChangeObserver';

const ID = '10000000-0000-0000-0000-000000000001';
const change = (resource, cursor) => ({ eventId: ID, resource, resourceId: ID,
  cursor, occurredAt: '2026-09-26T00:00:00Z' });

function fixture(responses = []) {
  const api = { getAccountChanges: vi.fn() };
  for (const response of responses) api.getAccountChanges.mockResolvedValueOnce(response);
  const connections = [];
  const createHubConnection = vi.fn(path => {
    const handlers = {};
    const connection = {
      path, handlers, state: 'Disconnected', start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((name, handler) => { handlers[name] = handler; }),
      onreconnected: vi.fn(handler => { handlers.reconnected = handler; }),
      onclose: vi.fn(handler => { handlers.closed = handler; }),
    };
    connections.push(connection);
    return connection;
  });
  const onChanges = vi.fn();
  const observer = createAccountChangeObserver({ api, createHubConnection,
    onChanges, events: window, pollMs: 25_000 });
  return { api, observer, connections, createHubConnection, onChanges };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('does not write authenticated WebSocket URLs to the browser console', () => {
  vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.test');
  const originalBuild = HubConnectionBuilder.prototype.build;
  const connections = [];
  vi.spyOn(HubConnectionBuilder.prototype, 'build').mockImplementation(function () {
    const connection = originalBuild.call(this);
    connections.push(connection);
    return connection;
  });
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});

  createPrivateWebAccountChangeObserver(() => {});

  expect(connections).toHaveLength(2);
  for (const connection of connections) {
    connection.connection._logger.log(LogLevel.Information,
      'WebSocket connected to wss://api.test/hubs/operations?access_token=secret-canary.');
  }
  expect(info).not.toHaveBeenCalled();
});

describe('account change observer', () => {
  it('drains pages on start and resumes from the last acknowledged cursor', async () => {
    const f = fixture([
      { changes: [change('notifications', 'c1')], nextCursor: 'c1', hasMore: true },
      { changes: [change('operation_messages', 'c2')], nextCursor: 'c2', hasMore: false },
      { changes: [], nextCursor: 'c2', hasMore: false },
    ]);
    await f.observer.start();
    expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(2, { after: 'c1', limit: 100 });
    expect(f.onChanges).toHaveBeenCalledWith(['notifications']);
    expect(f.onChanges).toHaveBeenCalledWith(['operation_messages']);
    expect(f.connections).toHaveLength(2);
    f.connections[0].handlers.ChangedV1({ eventId: ID });
    await f.observer.reconcile();
    expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(3, { after: 'c2', limit: 100 });
    await f.observer.stop();
  });

  it('reconciles on reconnect, focus, online and bounded poll even without hints', async () => {
    const f = fixture();
    f.api.getAccountChanges.mockResolvedValue({ changes: [], nextCursor: null, hasMore: false });
    await f.observer.start();
    f.connections[1].handlers.reconnected();
    await f.observer.reconcile();
    window.dispatchEvent(new Event('focus'));
    await f.observer.reconcile();
    window.dispatchEvent(new Event('online'));
    await f.observer.reconcile();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.api.getAccountChanges.mock.calls.length).toBeGreaterThanOrEqual(5);
    await f.observer.stop();
  });

  it('retains the cursor on failed requests and retries on the next poll', async () => {
    const f = fixture([{ changes: [change('notifications', 'c1')],
      nextCursor: 'c1', hasMore: false }]);
    f.api.getAccountChanges.mockRejectedValueOnce(new Error('offline'));
    f.api.getAccountChanges.mockResolvedValueOnce({ changes: [change('notifications', 'c2')],
      nextCursor: 'c2', hasMore: false });
    await f.observer.start();
    await f.observer.reconcile();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(2, { after: 'c1', limit: 100 });
    expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(3, { after: 'c1', limit: 100 });
    expect(f.onChanges).toHaveBeenCalledTimes(2);
    await f.observer.stop();
  });

  it('retries a failed hub start while REST reconciliation continues', async () => {
    const f = fixture();
    f.api.getAccountChanges.mockResolvedValue({ changes: [], nextCursor: null, hasMore: false });
    f.connections[0].start.mockRejectedValueOnce(new Error('socket offline'));
    await f.observer.start();
    expect(f.api.getAccountChanges).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.connections[0].start).toHaveBeenCalledTimes(2);
    expect(f.api.getAccountChanges.mock.calls.length).toBeGreaterThanOrEqual(2);
    await f.observer.stop();
  });

  it('replays a page if its consumer fails before acknowledgement', async () => {
    const f = fixture();
    f.api.getAccountChanges.mockResolvedValue({ changes: [change('notifications', 'c1')],
      nextCursor: 'c1', hasMore: false });
    f.onChanges.mockImplementationOnce(() => { throw new Error('render failed'); });
    await f.observer.start();
    await f.observer.reconcile();
    expect(f.api.getAccountChanges).toHaveBeenNthCalledWith(2, { limit: 100 });
    expect(f.onChanges).toHaveBeenCalledTimes(2);
    await f.observer.stop();
  });

  it('cancels listeners, poll and both hubs on stop', async () => {
    const f = fixture([{ changes: [], nextCursor: null, hasMore: false }]);
    await f.observer.start();
    await f.observer.stop();
    f.connections[0].handlers.ChangedV1({ eventId: ID });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.api.getAccountChanges).toHaveBeenCalledTimes(1);
    for (const connection of f.connections) expect(connection.stop).toHaveBeenCalledOnce();
  });

  it('does not deliver a late response after the account observer is stopped', async () => {
    let resolvePage;
    const f = fixture();
    f.api.getAccountChanges.mockReturnValue(new Promise(resolve => { resolvePage = resolve; }));
    const started = f.observer.start();
    await f.observer.stop();
    resolvePage({ changes: [change('notifications', 'c1')], nextCursor: 'c1', hasMore: false });
    await started;
    expect(f.onChanges).not.toHaveBeenCalled();
  });
});

// Hubs that move through SignalR's states and keep every lifecycle handler, for the status reports.
function statusFixture({ onStatus = vi.fn(), withReconnecting = true } = {}) {
  const api = { getAccountChanges: vi.fn().mockResolvedValue({ changes: [], nextCursor: null, hasMore: false }) };
  const connections = [];
  const createHubConnection = vi.fn(path => {
    const handlers = {};
    const connection = {
      path, handlers, state: 'Disconnected',
      start: vi.fn(async () => { connection.state = 'Connected'; }),
      stop: vi.fn(async () => { connection.state = 'Disconnected'; }),
      on: vi.fn((name, handler) => { handlers[name] = handler; }),
      onreconnected: vi.fn(handler => { handlers.reconnected = handler; }),
      onclose: vi.fn(handler => { handlers.closed = handler; }),
      ...(withReconnecting ? { onreconnecting: vi.fn(handler => { handlers.reconnecting = handler; }) } : {}),
    };
    connections.push(connection);
    return connection;
  });
  const observer = createAccountChangeObserver({ api, createHubConnection, onChanges: vi.fn(),
    events: window, pollMs: 25_000, onStatus });
  return { api, observer, connections, onStatus };
}

const lastStatus = onStatus => onStatus.mock.calls.at(-1)?.[0];
const hubStates = status => status.hubs.map(hub => `${hub.path}:${hub.state}`);

describe('account change observer status', () => {
  it('reports connected hubs and the last successful reconcile through onStatus', async () => {
    vi.setSystemTime(new Date('2026-11-12T14:00:00Z'));
    const f = statusFixture();
    await f.observer.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(hubStates(lastStatus(f.onStatus))).toEqual(['/hubs/operations:Connected', '/hubs/notifications:Connected']);
    expect(lastStatus(f.onStatus)).toMatchObject({
      lastOkAt: Date.parse('2026-11-12T14:00:00Z'), lastErrorAt: null, failingSince: null,
    });

    // The bounded poll reconciles again and moves lastOkAt.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(lastStatus(f.onStatus).lastOkAt).toBe(Date.parse('2026-11-12T14:00:25Z'));
    await f.observer.stop();
  });

  it('reports reconnecting and closed hubs, and still reconciles once on reconnect', async () => {
    const f = statusFixture();
    await f.observer.start();
    await vi.advanceTimersByTimeAsync(0);
    const [operations] = f.connections;
    expect(operations.onreconnected).toHaveBeenCalledOnce();

    operations.state = 'Reconnecting';
    operations.handlers.reconnecting(new Error('socket dropped'));
    expect(hubStates(lastStatus(f.onStatus))).toEqual(['/hubs/operations:Reconnecting', '/hubs/notifications:Connected']);

    const reads = f.api.getAccountChanges.mock.calls.length;
    operations.state = 'Connected';
    operations.handlers.reconnected('connection-2');
    expect(hubStates(lastStatus(f.onStatus))).toEqual(['/hubs/operations:Connected', '/hubs/notifications:Connected']);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.api.getAccountChanges).toHaveBeenCalledTimes(reads + 1);

    operations.state = 'Disconnected';
    operations.handlers.closed(new Error('gave up'));
    expect(hubStates(lastStatus(f.onStatus))).toEqual(['/hubs/operations:Disconnected', '/hubs/notifications:Connected']);
    await f.observer.stop();
  });

  it('marks failingSince on a failed reconcile and clears it on the next success', async () => {
    vi.setSystemTime(new Date('2026-11-12T14:00:00Z'));
    const f = statusFixture();
    f.api.getAccountChanges
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    await f.observer.start();
    expect(lastStatus(f.onStatus)).toMatchObject({ lastOkAt: null,
      lastErrorAt: Date.parse('2026-11-12T14:00:00Z'), failingSince: Date.parse('2026-11-12T14:00:00Z') });

    // A second failure moves lastErrorAt and keeps the start of the streak.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(lastStatus(f.onStatus)).toMatchObject({ lastOkAt: null,
      lastErrorAt: Date.parse('2026-11-12T14:00:25Z'), failingSince: Date.parse('2026-11-12T14:00:00Z') });

    await vi.advanceTimersByTimeAsync(25_000);
    expect(lastStatus(f.onStatus)).toMatchObject({ lastOkAt: Date.parse('2026-11-12T14:00:50Z'),
      lastErrorAt: Date.parse('2026-11-12T14:00:25Z'), failingSince: null });
    await f.observer.stop();
  });

  it('reports nothing after stop', async () => {
    const f = statusFixture();
    let finishStart;
    f.connections[1].start.mockImplementation(() => new Promise(resolve => { finishStart = () => {
      f.connections[1].state = 'Connected';
      resolve();
    }; }));
    let answer;
    f.api.getAccountChanges.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    const started = f.observer.start();
    const calls = f.onStatus.mock.calls.length;

    const stopped = f.observer.stop();
    finishStart();
    answer({ changes: [], nextCursor: null, hasMore: false });
    await Promise.all([started, stopped]);
    f.connections[0].handlers.reconnecting?.();
    f.connections[0].handlers.reconnected?.();
    f.connections[0].handlers.closed?.();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.onStatus).toHaveBeenCalledTimes(calls);
  });

  it('works without onStatus and with hubs that lack onreconnecting', async () => {
    const quiet = statusFixture({ onStatus: undefined, withReconnecting: false });
    await quiet.observer.start();
    quiet.connections[0].handlers.reconnected();
    quiet.connections[1].handlers.closed();
    await vi.advanceTimersByTimeAsync(0);
    expect(quiet.api.getAccountChanges).toHaveBeenCalledTimes(2);
    await quiet.observer.stop();

    const reporting = statusFixture({ withReconnecting: false });
    await reporting.observer.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(reporting.connections[0].onreconnecting).toBeUndefined();
    expect(hubStates(lastStatus(reporting.onStatus))).toEqual(['/hubs/operations:Connected', '/hubs/notifications:Connected']);
    await reporting.observer.stop();
  });
});
