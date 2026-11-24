import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOCK_SLEW, FRAME_STEP, REDUCED_MOTION_STEP_MS, UPDATE_RATE, createFrameLoop, createRenderClock, metresPerPixel, updateIntervalMs,
} from './frameLoop';

// The loop on fakes: frames run only when the test runs them, timers only when it fires them, the tab is shown or hidden
// by the test, and the server clock is a number the test moves.
const T0 = Date.parse('2026-11-14T15:00:00.250Z');

function setup({ reducedMotion = false, frozenAt = null } = {}) {
  const server = { at: T0, now() { return this.at; } };
  const clock = createRenderClock({ clock: server, frozenAt });
  const frames = new Map();
  const timers = new Map();
  let next = 1;
  const listeners = new Set();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.add(listener); },
    removeEventListener: (type, listener) => { listeners.delete(listener); },
  };
  const requestFrame = vi.fn(callback => {
    const handle = next++;
    frames.set(handle, callback);
    return handle;
  });
  const cancelFrame = vi.fn(handle => { frames.delete(handle); });
  const setTimer = vi.fn((callback, ms) => {
    const handle = next++;
    timers.set(handle, { callback, ms });
    return handle;
  });
  const clearTimer = vi.fn(handle => { timers.delete(handle); });
  const loop = createFrameLoop({ clock, requestFrame, cancelFrame, setTimer, clearTimer, document: doc, reducedMotion });
  // Runs the frames due now, as the browser would on its next paint; returns how many ran.
  const runFrames = () => {
    const due = [...frames.entries()];
    frames.clear();
    due.forEach(([, callback]) => callback());
    return due.length;
  };
  const fireTimers = () => {
    const due = [...timers.entries()];
    timers.clear();
    due.forEach(([, { callback }]) => callback());
    return due.map(([, { ms }]) => ms);
  };
  const setVisibility = state => {
    doc.visibilityState = state;
    listeners.forEach(listener => listener());
  };
  return { server, clock, loop, frames, timers, requestFrame, cancelFrame, setTimer, clearTimer, runFrames, fireTimers,
    setVisibility, listeners };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('frame loop (design H)', () => {
  it('requests no frame while nothing animates', () => {
    const { loop, requestFrame, setTimer } = setup();
    const onFrame = vi.fn();
    loop.subscribe(onFrame, { isAnimating: () => false });
    loop.subscribe(vi.fn());
    expect(requestFrame).not.toHaveBeenCalled();
    expect(setTimer).not.toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('runs one frame per animation frame while something animates and stops when it settles', () => {
    const { loop, server, requestFrame, runFrames } = setup();
    let movingUntil = T0 + 50;
    const onFrame = vi.fn();
    loop.subscribe(onFrame, { isAnimating: t => t < movingUntil });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(true);
    // Each frame asks for exactly one more while the aircraft moves.
    for (let frame = 1; frame <= 3; frame += 1) {
      server.at += 16;
      expect(runFrames()).toBe(1);
      expect(onFrame).toHaveBeenCalledTimes(frame);
      expect(requestFrame).toHaveBeenCalledTimes(frame + 1);
    }
    expect(onFrame.mock.calls.map(([t, info]) => [t - T0, info])).toEqual([
      [16, { dtMs: 0, reduced: false }], [32, { dtMs: 16, reduced: false }], [48, { dtMs: 16, reduced: false }],
    ]);
    // It settles: the frame after draws and asks for no other.
    server.at += 16;
    runFrames();
    expect(onFrame).toHaveBeenCalledTimes(4);
    expect(requestFrame).toHaveBeenCalledTimes(4);
    expect(loop.isRunning()).toBe(false);
    // Two subscribers: the loop goes on while either animates.
    movingUntil = Infinity;
    const other = vi.fn();
    loop.subscribe(other, { isAnimating: () => false });
    loop.wake();
    runFrames();
    expect(other).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(true);
  });

  it('passes the render clock time, never Date.now()', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { loop, server, runFrames } = setup();
    const seen = [];
    loop.subscribe(t => seen.push(t), { isAnimating: () => true });
    server.at = T0 + 1_234;
    runFrames();
    server.at = T0 + 1_250;
    runFrames();
    expect(seen).toEqual([T0 + 1_234, T0 + 1_250]);
    expect(loop.now()).toBe(T0 + 1_250);
    expect(Date.now).not.toHaveBeenCalled();
  });

  it('wake draws one frame while idle and while paused', () => {
    const { loop, server, clock, requestFrame, runFrames } = setup();
    const onFrame = vi.fn();
    loop.subscribe(onFrame, { isAnimating: () => false });
    // Idle: new data or a camera move draws once, and the loop stops again.
    loop.wake();
    loop.wake();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    runFrames();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(false);
    // Paused, with an aircraft that would move: the pause draws its frame, a wake draws one more, both at the instant
    // the pause holds, and nothing keeps running.
    const moving = vi.fn();
    loop.subscribe(moving, { isAnimating: () => true });
    runFrames();
    loop.pause();
    expect(clock.isPaused()).toBe(true);
    server.at += 5_000;
    runFrames();
    expect(moving.mock.calls.at(-1)[0]).toBe(clock.pausedAt());
    expect(loop.isRunning()).toBe(false);
    server.at += 5_000;
    loop.wake();
    runFrames();
    expect(moving.mock.calls.at(-1)[0]).toBe(clock.pausedAt());
    expect(loop.isRunning()).toBe(false);
  });

  it('pause freezes the time and resume picks up the server time', () => {
    const { loop, server, clock, runFrames } = setup();
    const seen = [];
    const listener = vi.fn();
    clock.subscribe(listener);
    loop.subscribe(t => seen.push(t), { isAnimating: () => true });
    server.at = T0 + 1_000;
    runFrames();
    loop.pause();
    expect(loop.isPaused()).toBe(true);
    expect(clock.pausedAt()).toBe(T0 + 1_000);
    expect(listener).toHaveBeenCalledTimes(1);
    // The data keeps loading and the server's time runs on; the map draws the paused instant.
    server.at = T0 + 31_000;
    expect(clock.now()).toBe(T0 + 1_000);
    runFrames();
    expect(seen.at(-1)).toBe(T0 + 1_000);
    // A second pause changes nothing; resume jumps to the server's time and the loop runs again.
    loop.pause();
    expect(clock.pausedAt()).toBe(T0 + 1_000);
    loop.resume();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(clock.isPaused()).toBe(false);
    expect(clock.pausedAt()).toBeNull();
    runFrames();
    expect(seen.at(-1)).toBe(T0 + 31_000);
    expect(loop.isRunning()).toBe(true);
    loop.resume();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a frozen clock never animates and shows no pause', () => {
    const frozenAt = Date.parse('2026-11-13T15:00:00Z');
    const { loop, server, clock, requestFrame, runFrames } = setup({ frozenAt });
    expect(clock.isFrozen()).toBe(true);
    expect(clock.isPaused()).toBe(false);
    expect(loop.isPaused()).toBe(false);
    const seen = [];
    loop.subscribe(t => seen.push(t), { isAnimating: () => true });
    expect(requestFrame).not.toHaveBeenCalled();
    // A wake draws the frozen instant once, whatever the server's time.
    server.at += 60_000;
    loop.wake();
    runFrames();
    expect(seen).toEqual([frozenAt]);
    expect(loop.isRunning()).toBe(false);
    // Paused by hand it says so, and stays at the frozen instant.
    loop.pause();
    runFrames();
    expect(loop.isPaused()).toBe(true);
    expect(clock.pausedAt()).toBe(frozenAt);
    loop.resume();
    runFrames();
    expect(seen).toEqual([frozenAt, frozenAt, frozenAt]);
    expect(loop.isRunning()).toBe(false);
  });

  it('stops while the tab is hidden and samples the current server time when it shows again', () => {
    const { loop, server, cancelFrame, requestFrame, runFrames, setVisibility, listeners } = setup();
    const onFrame = vi.fn();
    loop.subscribe(onFrame, { isAnimating: () => true });
    runFrames();
    expect(loop.isRunning()).toBe(true);
    setVisibility('hidden');
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(loop.isRunning()).toBe(false);
    // Hidden, a wake waits for the tab.
    loop.wake();
    expect(loop.isRunning()).toBe(false);
    const requested = requestFrame.mock.calls.length;
    // Ten minutes later the tab shows: one frame at the server's time now, nothing to catch up, and it runs on.
    server.at = T0 + 600_000;
    setVisibility('visible');
    expect(requestFrame).toHaveBeenCalledTimes(requested + 1);
    runFrames();
    expect(onFrame.mock.calls.at(-1)).toEqual([T0 + 600_000, { dtMs: 0, reduced: false }]);
    expect(loop.isRunning()).toBe(true);
    loop.dispose();
    expect(listeners.size).toBe(0);
  });

  it('under reduced motion ticks once per second at whole seconds', () => {
    const { loop, server, requestFrame, setTimer, fireTimers, runFrames } = setup({ reducedMotion: true });
    const onFrame = vi.fn();
    loop.subscribe(onFrame, { isAnimating: () => true });
    // T0 is 250 ms into its second: the first tick waits for the next whole second.
    expect(requestFrame).not.toHaveBeenCalled();
    expect(setTimer).toHaveBeenLastCalledWith(expect.any(Function), 750);
    server.at = T0 + 750;
    fireTimers();
    expect(onFrame.mock.calls.at(-1)).toEqual([T0 + 750, { dtMs: 0, reduced: true }]);
    expect((T0 + 750) % REDUCED_MOTION_STEP_MS).toBe(0);
    expect(setTimer).toHaveBeenLastCalledWith(expect.any(Function), 1_000);
    // A tick that fires late still draws the whole second it is in; then the next one.
    server.at = T0 + 1_750 + 120;
    expect(fireTimers()).toEqual([1_000]);
    expect(onFrame.mock.calls.at(-1)).toEqual([T0 + 1_750, { dtMs: 1_000, reduced: true }]);
    expect(setTimer).toHaveBeenLastCalledWith(expect.any(Function), 880);
    // New data draws a frame at once, still at the whole second, and the ticks go on.
    server.at = T0 + 2_100;
    loop.wake();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    runFrames();
    expect(onFrame.mock.calls.at(-1)[0]).toBe(T0 + 1_750);
    expect(onFrame.mock.calls.every(([t]) => t % REDUCED_MOTION_STEP_MS === 0)).toBe(true);
    // Back to full motion: every frame again, at the clock's own time.
    loop.setReducedMotion(false);
    server.at = T0 + 2_116;
    runFrames();
    expect(onFrame.mock.calls.at(-1)).toEqual([T0 + 2_116, { dtMs: 366, reduced: false }]);
    expect(requestFrame.mock.calls.length).toBeGreaterThan(1);
  });

  it('updateIntervalMs: never every frame, two pixels of the fastest aircraft in view, 2 to 15 Hz (CN-18)', () => {
    expect(UPDATE_RATE).toEqual({ minHz: 2, maxHz: 15, pxPerWrite: 2 });
    expect(updateIntervalMs()).toBe(500);
    expect(updateIntervalMs({ fastestPxPerSecond: 0 })).toBe(500);
    expect(updateIntervalMs({ fastestPxPerSecond: 3 })).toBe(500);
    expect(updateIntervalMs({ fastestPxPerSecond: 20 })).toBe(100);
    expect(updateIntervalMs({ fastestPxPerSecond: 30 })).toBeCloseTo(1_000 / 15, 9);
    expect(updateIntervalMs({ fastestPxPerSecond: 600 })).toBeCloseTo(1_000 / 15, 9);
    expect(updateIntervalMs({ fastestPxPerSecond: Number.NaN })).toBe(500);
  });

  it('metresPerPixel matches MapLibre at the equator and at PUJ', () => {
    // MapLibre's 512-pixel world: 78 271.517 m per pixel at zoom 0 on the equator, halving at every zoom.
    expect(metresPerPixel(0, 0)).toBeCloseTo(78_271.517, 2);
    expect(metresPerPixel(1, 0)).toBeCloseTo(78_271.517 / 2, 2);
    expect(metresPerPixel(15, 0)).toBeCloseTo(2.388657, 5);
    // At Punta Cana (18.5674° N) the same zoom shows more of the ground: cos(18.5674°) of it per pixel.
    expect(metresPerPixel(15, 18.5674)).toBeCloseTo(2.388657 * Math.cos((18.5674 * Math.PI) / 180), 5);
    expect(metresPerPixel(15, 18.5674)).toBeCloseTo(2.26434, 4);
    // An A320 taxiing at 16 kt in the ramp view (zoom 16.5) moves about 10 px a second.
    expect((16 * 1_852) / 3_600 / metresPerPixel(16.5, 18.5674)).toBeCloseTo(10.3, 1);
  });

  it('dispose cancels the pending frame and every subscription', () => {
    const { loop, frames, cancelFrame, requestFrame, runFrames, timers, listeners } = setup();
    const onFrame = vi.fn();
    const unsubscribe = loop.subscribe(onFrame, { isAnimating: () => true });
    expect(frames.size).toBe(1);
    loop.dispose();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(loop.isRunning()).toBe(false);
    // Nothing runs or subscribes afterwards.
    loop.wake();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(runFrames()).toBe(0);
    expect(onFrame).not.toHaveBeenCalled();
    loop.subscribe(onFrame, { isAnimating: () => true });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    unsubscribe();
    loop.dispose();
    // The last subscriber that leaves stops a loop that is still alive.
    const alive = setup();
    const leave = alive.loop.subscribe(vi.fn(), { isAnimating: () => true });
    leave();
    expect(alive.cancelFrame).toHaveBeenCalledTimes(1);
    expect(alive.loop.isRunning()).toBe(false);
  });
});

describe('smooth time (CN-18)', () => {
  // A server clock as services/serverClock.js reads: the browser's time plus an offset the test moves.
  function serverClockAt(offsetMs) {
    const state = { local: 1_000_000, offset: offsetMs };
    return { state, now: () => state.local + state.offset, localNow: () => state.local };
  }

  it('slews a new offset of the server clock at 5 % of the time that passes instead of stepping', () => {
    expect(CLOCK_SLEW).toEqual({ rate: 0.05, snapMs: 5_000 });
    const server = serverClockAt(200);
    const clock = createRenderClock({ clock: server });
    expect(clock.now()).toBe(1_000_200);
    // The clock settles on another sample, 300 ms earlier: no step, 5 % of every 16 ms frame.
    server.state.offset = -100;
    let last = clock.now();
    expect(last).toBe(1_000_200);
    let largest = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      server.state.local += 16;
      const now = clock.now();
      largest = Math.max(largest, Math.abs(now - last - 16));
      expect(now).toBeGreaterThan(last);
      last = now;
    }
    expect(largest).toBeLessThanOrEqual(16 * 0.05 + 1e-9);
    // Caught up after 300 / 0.8 frames.
    expect(clock.now()).toBe(server.now());
  });

  it('takes a gap beyond 5 s at once (its first sync, a wrong browser clock)', () => {
    const server = serverClockAt(0);
    const clock = createRenderClock({ clock: server });
    expect(clock.now()).toBe(1_000_000);
    server.state.offset = 60_000;
    expect(clock.now()).toBe(1_060_000);
  });

  it('a clock without localNow is read as it is', () => {
    const server = { at: T0, now() { return this.at; } };
    const clock = createRenderClock({ clock: server });
    server.at += 500;
    expect(clock.now()).toBe(T0 + 500);
  });

  it('a frame 2 s late advances 250 ms, then catches up within about a second without a jump', () => {
    expect(FRAME_STEP).toEqual({ maxMs: 250, catchUpMs: 250 });
    const server = { at: T0, now() { return this.at; } };
    const clock = createRenderClock({ clock: server });
    const frames = [];
    let local = 0;
    const loop = createFrameLoop({
      clock, requestFrame: callback => frames.push(callback), cancelFrame: () => {}, document: null, localNow: () => local,
    });
    const drawn = [];
    loop.subscribe(tMs => drawn.push(tMs), { isAnimating: () => true });
    const advance = ms => {
      local += ms;
      server.at += ms;
      frames.splice(0).forEach(callback => callback());
    };
    for (let index = 0; index < 10; index += 1) advance(16);
    const before = drawn.at(-1);
    // A long task: the next frame comes 2 s later.
    advance(2_000);
    expect(drawn.at(-1) - before).toBe(250);
    expect(loop.now()).toBeLessThan(server.at);
    let largest = 0;
    for (let index = 0; index < 75; index += 1) {
      const previous = drawn.at(-1);
      advance(16);
      largest = Math.max(largest, drawn.at(-1) - previous);
      expect(drawn.at(-1)).toBeGreaterThanOrEqual(previous);
    }
    // Faster than real time for a moment, never another jump of the whole gap.
    expect(largest).toBeLessThan(140);
    expect(server.at - drawn.at(-1)).toBeLessThan(20);
  });

  it('a loop that starts again after it stopped draws at the clock at once', () => {
    const server = { at: T0, now() { return this.at; } };
    const clock = createRenderClock({ clock: server });
    const frames = [];
    let local = 0;
    let moving = true;
    const loop = createFrameLoop({
      clock, requestFrame: callback => frames.push(callback), cancelFrame: () => {}, document: null, localNow: () => local,
    });
    const drawn = [];
    loop.subscribe(tMs => drawn.push(tMs), { isAnimating: () => moving });
    const run = ms => {
      local += ms;
      server.at += ms;
      frames.splice(0).forEach(callback => callback());
    };
    run(16);
    moving = false;
    run(16);
    expect(frames).toHaveLength(0);
    local += 30_000;
    server.at += 30_000;
    moving = true;
    loop.wake();
    run(16);
    expect(drawn.at(-1)).toBe(server.at);
  });
});
