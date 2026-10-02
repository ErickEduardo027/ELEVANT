import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountChangeObserver } from './accountChangeObserver';

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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
