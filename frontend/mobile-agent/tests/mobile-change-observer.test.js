const { createMobileChangeObserver } = require('../src/services/mobile-change-observer');

const context = (sessionId = 'session-a', accountId = 'account-a') => ({ sessionId, accountId, accessToken: 'secret' });
const change = (resource, cursor) => ({ eventId: 'event-a', resource, resourceId: 'resource-a', cursor });

function fixture() {
  const listeners = [];
  const appState = { currentState: 'active', addEventListener: jest.fn((name, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }) };
  const getContext = jest.fn().mockResolvedValue(context());
  const getChanges = jest.fn().mockResolvedValue({ changes: [], nextCursor: null, hasMore: false });
  const onChanges = jest.fn();
  const observer = createMobileChangeObserver({ appState, getContext, getChanges, onChanges });
  return { observer, appState, listeners, getContext, getChanges, onChanges };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('drains the account feed, reconciles on foreground and polls only while active', async () => {
  const f = fixture();
  f.getChanges.mockResolvedValueOnce({ changes: [change('notifications', 'c1')], nextCursor: 'c1', hasMore: true });
  f.getChanges.mockResolvedValueOnce({ changes: [change('operation_messages', 'c2')], nextCursor: 'c2', hasMore: false });
  await f.observer.start();
  expect(f.getChanges).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionId: 'session-a' }), undefined);
  expect(f.getChanges).toHaveBeenNthCalledWith(2, expect.anything(), 'c1');
  expect(f.onChanges).toHaveBeenCalledWith(['notifications']);
  expect(f.onChanges).toHaveBeenCalledWith(['operation_messages']);
  f.listeners[0]('background');
  await jest.advanceTimersByTimeAsync(25_000);
  expect(f.getChanges).toHaveBeenCalledTimes(2);
  f.listeners[0]('active');
  await f.observer.reconcile();
  expect(f.getChanges).toHaveBeenNthCalledWith(3, expect.anything(), 'c2');
  await f.observer.stop();
});

test('resets the cursor when a different account logs in', async () => {
  const f = fixture();
  f.getChanges.mockResolvedValueOnce({ changes: [change('notifications', 'c1')], nextCursor: 'c1', hasMore: false });
  await f.observer.start();
  f.getContext.mockResolvedValue(context('session-b', 'account-b'));
  await f.observer.reconcile();
  expect(f.getChanges).toHaveBeenNthCalledWith(2, expect.objectContaining({ accountId: 'account-b' }), undefined);
  await f.observer.stop();
});

test('does not advance on offline failure and retries with the same cursor', async () => {
  const f = fixture();
  f.getChanges.mockResolvedValueOnce({ changes: [change('notifications', 'c1')], nextCursor: 'c1', hasMore: false });
  await f.observer.start();
  f.getChanges.mockRejectedValueOnce(new Error('offline'));
  await f.observer.reconcile();
  await jest.advanceTimersByTimeAsync(25_000);
  expect(f.getChanges).toHaveBeenNthCalledWith(2, expect.anything(), 'c1');
  expect(f.getChanges).toHaveBeenNthCalledWith(3, expect.anything(), 'c1');
  await f.observer.stop();
});

test('does not publish a response from a session that was replaced in flight', async () => {
  const f = fixture();
  let resolve;
  f.getChanges.mockReturnValue(new Promise(done => { resolve = done; }));
  const started = f.observer.start();
  await Promise.resolve();
  f.getContext.mockResolvedValue(context('session-b', 'account-b'));
  resolve({ changes: [change('notifications', 'c1')], nextCursor: 'c1', hasMore: false });
  await started;
  expect(f.onChanges).not.toHaveBeenCalled();
  await f.observer.stop();
});

function hub() {
  const handlers = {};
  return {
    state: 'Disconnected', handlers,
    start: jest.fn(function start() { this.state = 'Connected'; return Promise.resolve(); }),
    stop: jest.fn(function stop() { this.state = 'Disconnected'; return Promise.resolve(); }),
    on: jest.fn((event, listener) => { handlers[event] = listener; }),
    onreconnected: jest.fn(listener => { handlers.reconnected = listener; }),
  };
}

test('a SignalR ChangedV1 wakes the REST cursor at once and hubs sleep in background', async () => {
  const listeners = [];
  const appState = { currentState: 'active', addEventListener: jest.fn((name, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }) };
  const operations = hub();
  const getChanges = jest.fn().mockResolvedValue({ changes: [], nextCursor: null, hasMore: false });
  const onChanges = jest.fn();
  const observer = createMobileChangeObserver({ appState, hubs: [operations],
    getContext: jest.fn().mockResolvedValue(context()), getChanges, onChanges });
  await observer.start();
  expect(operations.start).toHaveBeenCalledTimes(1);
  getChanges.mockResolvedValueOnce({ changes: [change('ramp_operations', 'c1')], nextCursor: 'c1', hasMore: false });
  operations.handlers.ChangedV1();
  await observer.reconcile();
  expect(onChanges).toHaveBeenCalledWith(['ramp_operations']);
  listeners[0]('background');
  expect(operations.stop).toHaveBeenCalled();
  listeners[0]('active');
  expect(operations.start).toHaveBeenCalledTimes(2);
  await observer.stop();
  expect(operations.stop).toHaveBeenCalledTimes(2);
});
