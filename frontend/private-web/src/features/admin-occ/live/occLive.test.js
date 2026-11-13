import { describe, expect, it } from 'vitest';
import { LIVE_FRESH_MS, OFFLINE_AFTER_MS, RECONNECT_GRACE_MS } from './occCadence';
import { LIVE_STATES, liveSourceReports, liveState, reduceLive, startLive } from './occLive';

const T = Date.parse('2026-11-12T14:00:00Z');
const PATHS = ['/hubs/operations', '/hubs/notifications'];
const hubs = (...states) => states.map((state, index) => ({ path: PATHS[index], state }));
const status = (now, report) => ({ type: 'status', status: report, now });

describe('liveState', () => {
  it('is live with a connected hub and a reconcile under 60 s', () => {
    expect(LIVE_STATES).toEqual(['live', 'reconnecting', 'polling', 'offline']);
    expect(liveState({ hubs: hubs('Connected', 'Connected'), lastOkAt: T, now: T + LIVE_FRESH_MS - 1 }))
      .toEqual({ state: 'live', since: T + LIVE_FRESH_MS - 1 });
    // One connected hub is enough.
    expect(liveState({ hubs: hubs('Connected', 'Reconnecting'), lastOkAt: T, now: T + 10_000 }).state).toBe('live');
    // A socket without a recent answer is not proof that the picture is current.
    expect(liveState({ hubs: hubs('Connected', 'Connected'), lastOkAt: T, now: T + LIVE_FRESH_MS }).state).not.toBe('live');
    expect(liveState({ hubs: hubs('Connected', 'Connected'), lastOkAt: null, failingSince: T, now: T + 1 }).state)
      .not.toBe('live');

    // `since` is when the state began: an equal state keeps the previous result, a new one starts now.
    const first = liveState({ hubs: hubs('Connected'), lastOkAt: T, now: T });
    expect(liveState({ hubs: hubs('Connected'), lastOkAt: T + 25_000, now: T + 25_000, previous: first })).toBe(first);
    expect(liveState({ hubs: hubs('Disconnected'), lastOkAt: T + 25_000, now: T + 26_000, previous: first }))
      .toEqual({ state: 'polling', since: T + 26_000 });
  });

  it('is reconnecting for the first 30 s of a reconnect and before the first result', () => {
    // Before any answer the link counts as connecting, from the moment the observer started.
    expect(liveState({ reconnectingSince: T, now: T + RECONNECT_GRACE_MS - 1 }).state).toBe('reconnecting');
    expect(liveState({ hubs: hubs('Connected', 'Connected'), reconnectingSince: T, now: T + 2_000 }).state)
      .toBe('reconnecting');
    expect(liveState({ reconnectingSince: T, now: T + RECONNECT_GRACE_MS }).state).toBe('offline');

    // A reconnect episode, with an answer still fresh: reconnecting for 30 s, then judged on what the link does.
    const reconnecting = { hubs: hubs('Reconnecting', 'Reconnecting'), lastOkAt: T + 20_000, reconnectingSince: T + 1_000 };
    expect(liveState({ ...reconnecting, now: T + 30_000 }).state).toBe('reconnecting');
    expect(liveState({ ...reconnecting, now: T + 1_000 + RECONNECT_GRACE_MS }).state).toBe('polling');

    // The reducer starts a new grace when a reconnect begins and clears it once every hub settled after an answer.
    let record = startLive(T);
    expect(record.live).toEqual({ state: 'reconnecting', since: T });
    record = reduceLive(record, status(T + 1_000, { hubs: hubs('Connected', 'Connecting') }));
    expect(record.reconnectingSince).toBe(T);
    record = reduceLive(record, status(T + 1_500, { hubs: hubs('Connected', 'Connected'), lastOkAt: T + 1_500 }));
    expect(record).toMatchObject({ reconnectingSince: null, live: { state: 'live', since: T + 1_500 } });
    record = reduceLive(record, status(T + 40_000, { hubs: hubs('Reconnecting', 'Reconnecting'), lastOkAt: T + 26_500 }));
    expect(record).toMatchObject({ reconnectingSince: T + 40_000, live: { state: 'reconnecting', since: T + 40_000 } });
    // A second hub dropping in the same episode does not extend the grace.
    record = reduceLive(record, status(T + 45_000, { hubs: hubs('Reconnecting', 'Reconnecting'), lastOkAt: T + 45_000 }));
    expect(record.reconnectingSince).toBe(T + 40_000);
    // Time alone ends it; a tick that changes nothing keeps the same record.
    const ticked = reduceLive(record, { type: 'tick', now: T + 50_000 });
    expect(ticked).toBe(record);
    expect(reduceLive(record, { type: 'tick', now: T + 70_000 }).live).toEqual({ state: 'polling', since: T + 70_000 });
  });

  it('is polling when hubs are down but HTTP reconciles succeed', () => {
    expect(liveState({ hubs: hubs('Disconnected', 'Disconnected'), lastOkAt: T, now: T + 5_000 }).state).toBe('polling');
    // A failure or two inside the minute is not «Sin conexión» while answers are still fresh.
    expect(liveState({ hubs: hubs('Disconnected', 'Disconnected'), lastOkAt: T, failingSince: T + 25_000,
      now: T + 50_000 }).state).toBe('polling');

    // The 25 s poll restarting the hubs (Connecting) does not open a new reconnecting grace.
    let record = reduceLive(startLive(T), status(T + 1_000,
      { hubs: hubs('Disconnected', 'Disconnected'), lastOkAt: T + 1_000 }));
    expect(record).toMatchObject({ reconnectingSince: null, live: { state: 'polling' } });
    record = reduceLive(record, status(T + 26_000, { hubs: hubs('Disconnected', 'Connecting'), lastOkAt: T + 26_000 }));
    expect(record.live.state).toBe('polling');
  });

  it('is offline when the browser is offline or reconciles fail for more than 60 s', () => {
    expect(liveState({ hubs: hubs('Connected', 'Connected'), lastOkAt: T, online: false, now: T + 1 }).state)
      .toBe('offline');
    // A reconnect that begins late cannot hide more than a minute of failed reconciles.
    const failing = { hubs: hubs('Reconnecting', 'Reconnecting'), failingSince: T, reconnectingSince: T + 50_000 };
    expect(liveState({ ...failing, now: T + OFFLINE_AFTER_MS }).state).toBe('reconnecting');
    expect(liveState({ ...failing, now: T + OFFLINE_AFTER_MS + 1 }).state).toBe('offline');
    // Nothing fresh and no grace left: nothing tells us the picture is current.
    expect(liveState({ hubs: hubs('Disconnected', 'Disconnected'), lastOkAt: T, now: T + LIVE_FRESH_MS }).state)
      .toBe('offline');

    // The reducer follows the browser's flag and keeps it across a restart.
    let record = reduceLive(startLive(T), status(T + 1_000, { hubs: hubs('Connected', 'Connected'), lastOkAt: T + 1_000 }));
    record = reduceLive(record, { type: 'online', online: false, now: T + 2_000 });
    expect(record).toMatchObject({ online: false, offlineSince: T + 2_000, live: { state: 'offline', since: T + 2_000 } });
    expect(reduceLive(record, { type: 'restart', now: T + 3_000 })).toMatchObject({ online: false, offlineSince: T + 2_000 });
    record = reduceLive(record, { type: 'online', online: true, now: T + 4_000 });
    expect(record).toMatchObject({ online: true, offlineSince: null, live: { state: 'live', since: T + 4_000 } });
  });
});

describe('liveSourceReports', () => {
  it('reports ELEVANT and the realtime link for the source list', () => {
    const at = (state, extra = {}) => ({ live: { state, since: T }, lastOkAt: T, ...extra });
    expect(liveSourceReports(at('live'))).toEqual({
      elevant: { state: 'ok', at: T, detail: null }, realtime: { state: 'ok', at: T, detail: 'live' },
    });
    expect(liveSourceReports(at('polling')).realtime).toEqual({ state: 'delayed', at: T, detail: 'polling' });
    expect(liveSourceReports(at('reconnecting')).realtime).toEqual({ state: 'delayed', at: T, detail: 'reconnecting' });
    expect(liveSourceReports(at('offline'))).toEqual({
      elevant: { state: 'offline', at: T, detail: null }, realtime: { state: 'offline', at: T, detail: 'offline' },
    });
    // Nothing has answered yet: neither source has a verdict.
    expect(liveSourceReports(at('reconnecting', { lastOkAt: null }))).toEqual({
      elevant: { state: 'idle', at: null, detail: null }, realtime: { state: 'idle', at: null, detail: 'reconnecting' },
    });
  });
});
