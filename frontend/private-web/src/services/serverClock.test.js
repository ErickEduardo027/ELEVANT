import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerClock, parseInstant, serverClock, syncServerClock } from './serverClock';

const LOCAL = Date.parse('2026-11-13T15:00:00.000Z');

// A clock whose browser time the test moves by hand.
function manualClock(options = {}) {
  let local = LOCAL;
  const clock = createServerClock({ now: () => local, ...options });
  return { clock, set: value => { local = value; } };
}

afterEach(() => serverClock.reset());

describe('serverClock (contracts 2.7)', () => {
  it('takes the offset from the sample with the smallest round trip', () => {
    const { clock, set } = manualClock();
    const listener = vi.fn();
    clock.subscribe(listener);

    // Sent at 0 and answered 400 ms later: the server wrote its time in the middle, 5 s ahead of the browser.
    expect(clock.observe('2026-11-13T15:00:05.200Z', LOCAL, LOCAL + 400)).toBe(true);
    expect(clock.offsetMs()).toBe(5_000);
    // A slower answer (2 s) says 5.9 s: the faster sample keeps the offset.
    expect(clock.observe('2026-11-13T15:00:06.900Z', LOCAL, LOCAL + 2_000)).toBe(true);
    expect(clock.offsetMs()).toBe(5_000);
    // A faster one (100 ms) replaces it.
    expect(clock.observe('2026-11-13T15:00:04.850Z', LOCAL - 100, LOCAL)).toBe(true);
    expect(clock.offsetMs()).toBe(4_900);
    expect(listener).toHaveBeenCalledTimes(2);

    set(LOCAL + 60_000);
    expect(clock.now()).toBe(LOCAL + 60_000 + 4_900);
    expect(clock.localNow()).toBe(LOCAL + 60_000);
    expect(clock.isSynced()).toBe(true);
  });

  it('keeps only the last samples, so an old fast one stops counting', () => {
    const { clock } = manualClock({ maxSamples: 2 });
    clock.observe('2026-11-13T15:00:01.000Z', LOCAL, LOCAL);
    clock.observe('2026-11-13T15:00:02.500Z', LOCAL, LOCAL + 1_000);
    expect(clock.offsetMs()).toBe(1_000);
    clock.observe('2026-11-13T15:00:03.000Z', LOCAL, LOCAL + 2_000);
    // The 0 ms sample fell out of the window: the best of the two left is the 1 s round trip.
    expect(clock.offsetMs()).toBe(2_000);
    // Between equal round trips the newest wins: it knows the latest drift.
    clock.observe('2026-11-13T15:00:04.000Z', LOCAL, LOCAL + 2_000);
    expect(clock.offsetMs()).toBe(3_000);
  });

  it('reads the browser clock and reports unsynced without samples', () => {
    const { clock } = manualClock();
    expect(clock.now()).toBe(LOCAL);
    expect(clock.offsetMs()).toBeNull();
    expect(clock.isSynced()).toBe(false);

    clock.observe('2026-11-13T15:00:03.000Z', LOCAL, LOCAL);
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.reset();
    expect(clock.isSynced()).toBe(false);
    expect(clock.now()).toBe(LOCAL);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('parses seven-decimal instants and ignores invalid ones', () => {
    expect(parseInstant('2026-11-13T15:00:00.1234567+00:00')).toBe(LOCAL + 123);
    expect(parseInstant('2026-11-13T11:00:00.9999999-04:00')).toBe(LOCAL + 999);
    expect(parseInstant('2026-11-13T15:00:00.5Z')).toBe(LOCAL + 500);
    expect(parseInstant('2026-11-13T15:00:00Z')).toBe(LOCAL);
    for (const value of [null, undefined, '', 'mañana', '2026-11-13', '2026-11-13 15:00:00Z', 1_794_582_000_000,
      '2026-13-40T15:00:00Z']) {
      expect(parseInstant(value), String(value)).toBeNull();
    }

    const { clock } = manualClock();
    expect(clock.observe('2026-11-13T15:00:02.0000001Z', LOCAL, LOCAL)).toBe(true);
    expect(clock.offsetMs()).toBe(2_000);
    // Not an instant, no answer time, or answered before it was sent: the sample is ignored.
    expect(clock.observe('not a time', LOCAL, LOCAL)).toBe(false);
    expect(clock.observe('2026-11-13T15:09:00Z', Number.NaN, LOCAL)).toBe(false);
    expect(clock.observe('2026-11-13T15:09:00Z', LOCAL, LOCAL - 1)).toBe(false);
    expect(clock.offsetMs()).toBe(2_000);
  });

  it('syncServerClock feeds the clock from the ping timestamp', async () => {
    const { clock, set } = manualClock();
    const controller = new AbortController();
    // The ping takes 300 ms and the server is 90 s ahead.
    const ping = vi.fn(async () => {
      set(LOCAL + 300);
      return { application: 'ELEVANT', status: 'ok', environment: 'Test', timestampUtc: '2026-11-13T15:01:30.1500000+00:00' };
    });
    await expect(syncServerClock({ ping, clock, signal: controller.signal })).resolves.toBe(true);
    expect(ping).toHaveBeenCalledWith({ signal: controller.signal });
    expect(clock.offsetMs()).toBe(90_000);

    // A ping without a time feeds nothing; a failed one rejects and leaves the clock as it was.
    await expect(syncServerClock({ ping: async () => ({}), clock })).resolves.toBe(false);
    await expect(syncServerClock({ ping: async () => { throw new Error('offline'); }, clock })).rejects.toThrow('offline');
    expect(clock.offsetMs()).toBe(90_000);
    await expect(syncServerClock({ clock })).rejects.toThrow(TypeError);

    // Without a clock it feeds the app's one.
    await syncServerClock({ ping: async () => ({ timestampUtc: new Date(Date.now() + 60_000).toISOString() }) });
    expect(serverClock.isSynced()).toBe(true);
  });
});
