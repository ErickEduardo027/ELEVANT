import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAirPicture, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON } from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';
import { TELEMETRY_INTERVAL_MS, createTelemetryStore, telemetryAt, useServerTime, useTelemetry } from './telemetryStore';

const NOON = Date.parse(TRAFFIC_NOON);
const situationAt = nowMs => buildSituation({ picture: toPictureModel(createAirPicture()),
  flights: toFlightsModel(createMapFlights()), nowMs });
const ARRIVAL = `f:${KEY.arrival}`;

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOON);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  delete document.visibilityState;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('telemetry store', () => {
  it('ticks at 4 Hz only while watched and visible', () => {
    const store = createTelemetryStore({ clock: { now: () => Date.now() } });
    expect(TELEMETRY_INTERVAL_MS).toBe(250);
    // Nobody watches: no timer runs.
    vi.advanceTimersByTime(1_000);
    expect(store.isTicking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.isTicking()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalledTimes(4);
    // One second without watchers, one with them.
    expect(store.getSnapshot().nowMs).toBe(NOON + 2_000);

    // A hidden tab stops it; showing it again ticks at once and every 250 ms after.
    setVisibility('hidden');
    expect(store.isTicking()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(listener).toHaveBeenCalledTimes(4);
    setVisibility('visible');
    expect(listener).toHaveBeenCalledTimes(5);
    expect(store.getSnapshot().nowMs).toBe(NOON + 7_000);
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(7);

    // A second watcher shares the same timer; the last one to leave stops it, and visibility no longer matters.
    const other = vi.fn();
    const leave = store.subscribe(other);
    vi.advanceTimersByTime(250);
    expect([listener.mock.calls.length, other.mock.calls.length]).toEqual([8, 1]);
    leave();
    unsubscribe();
    expect(store.isTicking()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalledTimes(8);

    // A tab hidden when the first watcher comes waits for it to show.
    setVisibility('hidden');
    const late = vi.fn();
    store.subscribe(late);
    vi.advanceTimersByTime(1_000);
    expect(late).not.toHaveBeenCalled();
    setVisibility('visible');
    vi.advanceTimersByTime(250);
    expect(late).toHaveBeenCalledTimes(2);
  });

  it('gives the telemetry of an aircraft in the units of the screen, the same object while its values hold', () => {
    const store = createTelemetryStore({ clock: { now: () => Date.now() } });
    store.set(situationAt(NOON));
    // ZZ161 on final: 2 600 ft, 150 kt, track 074°, 768 ft/min down, its fix 4 s old, and the instant of that fix.
    const first = store.telemetryOf(ARRIVAL);
    expect(first).toEqual({ altFt: 2_600, gsKt: 150, trackDeg: 74, vrate: -768, ageS: 4, positionAt: NOON - 4_000,
      quality: 'live', onGround: false });
    expect(store.telemetryOf(ARRIVAL)).toBe(first);
    // A tick within the same second keeps the object; the next second gives a new one.
    store.subscribe(() => {});
    vi.advanceTimersByTime(250);
    expect(store.telemetryOf(ARRIVAL)).toBe(first);
    vi.advanceTimersByTime(750);
    expect(store.telemetryOf(ARRIVAL)).toEqual({ ...first, ageS: 5 });
    // An aircraft the situation does not hold, or none asked, has no telemetry.
    expect(store.telemetryOf('h:nothing')).toBeNull();
    expect(store.telemetryOf(null)).toBeNull();
    expect(telemetryAt(null, NOON)).toBeNull();
    expect(telemetryAt({ altM: null, gsMs: undefined, trackDeg: -10, positionAt: NOON + 2_000, quality: 'estimated' }, NOON))
      .toEqual({ altFt: null, gsKt: null, trackDeg: 350, vrate: null, ageS: 0, positionAt: NOON + 2_000,
        quality: 'estimated', onGround: false });
    // An aircraft without the instant of its position has neither an age nor that instant.
    expect(telemetryAt({ positionAt: null, quality: 'stale' }, NOON)).toMatchObject({ ageS: null, positionAt: null });
  });

  it('reads through hooks that render only when what they show changes', () => {
    const store = createTelemetryStore({ clock: { now: () => Date.now() } });
    store.set(situationAt(NOON));
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return { telemetry: useTelemetry(store, ARRIVAL), minute: useServerTime(store, 60_000) };
    });
    expect(result.current.telemetry.ageS).toBe(4);
    expect(result.current.minute).toBe(NOON);
    const before = renders;
    // Three ticks inside the same second render nothing; the fourth turns the age.
    act(() => { vi.advanceTimersByTime(750); });
    expect(renders).toBe(before);
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.telemetry.ageS).toBe(5);
    expect(renders).toBe(before + 1);
    // Without a store, nothing to show.
    const { result: empty } = renderHook(() => [useTelemetry(null, ARRIVAL), useServerTime(undefined)]);
    expect(empty.current).toEqual([null, null]);
  });
});
