import { serverClock } from '../../../services/serverClock';

// One animation loop per OCC map (PR M6, design H). Everything that moves on a map is a pure function of the server's
// time, so a frame only has to ask the clock for the time and draw: nothing is integrated frame by frame and nothing
// has to catch up. The loop asks the browser for a frame only while one of its subscribers animates (an aircraft
// moving, a blend or a fade under way, the follow camera closing in on its aircraft; later the 3D matrices); otherwise
// there is no loop at all and MapLibre idles. OccMap subscribes the traffic first and follow mode after it, so the
// camera frames each aircraft where that frame drew it. It stops while the tab is hidden and draws at the current server time when the tab shows again
// (the clock's offset is synced again by the map's reads: useMapSituation pings on return). Under reduced motion it
// ticks once a second, at whole seconds, without interpolation. React never renders per frame: a subscriber writes to
// the map directly.
//
// The render clock is the server clock the map draws at: the same time, except that «Pausar movimiento» freezes it
// while the data keeps loading, and the map lab freezes it for good at its `?t=` instant (no pause is shown then).
//
// API for the map (core/OccMap.jsx) and for what comes later (PR M7: the 3D matrices and their governor):
// - `createRenderClock({ clock, frozenAt })` → `{ now, pause, resume, isPaused, pausedAt, isFrozen, subscribe }`;
// - `createFrameLoop({ clock, requestFrame, cancelFrame, setTimer, clearTimer, document, reducedMotion })` →
//   `{ subscribe(onFrame(tMs, { dtMs, reduced }), { isAnimating(tMs) }) → unsubscribe, wake, pause, resume, isPaused,
//   now, setReducedMotion, isRunning, dispose }`;
// - `updateIntervalMs({ inView, fastestPxPerSecond })` and `metresPerPixel(zoom, latDeg)`: how often the 2D traffic is
//   written to the map (updateData) for what is in view.

/**
 * How often the 2D traffic is written while it moves (design H): every frame with fewer than `everyFrameBelow` aircraft
 * in view; with more, at half the fastest one's speed on screen in pixels per second, between `minHz` and `maxHz`.
 */
export const UPDATE_RATE = Object.freeze({ minHz: 2, maxHz: 30, everyFrameBelow: 30 });

/** Under reduced motion the aircraft move once a second, at whole seconds of the clock. */
export const REDUCED_MOTION_STEP_MS = 1_000;

// MapLibre's world: 512-pixel tiles over the equator's length.
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TILE_PX = 512;

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** The metres one pixel covers on a MapLibre map at `zoom` and latitude `latDeg` (512-pixel tiles, Web Mercator). */
export function metresPerPixel(zoom, latDeg) {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
}

/**
 * The milliseconds between two writes of the traffic (design H): 0 (every frame) with fewer than 30 aircraft in view,
 * otherwise 1000 / clamp(fastestPxPerSecond / 2, 2, 30): half the speed on screen of the fastest aircraft in view, in
 * pixels per second, between 2 and 30 writes a second.
 */
export function updateIntervalMs({ inView = 0, fastestPxPerSecond = 0 } = {}) {
  if (!(finite(inView) && inView >= UPDATE_RATE.everyFrameBelow)) return 0;
  const speed = finite(fastestPxPerSecond) && fastestPxPerSecond > 0 ? fastestPxPerSecond : 0;
  const hz = Math.min(UPDATE_RATE.maxHz, Math.max(UPDATE_RATE.minHz, speed / 2));
  return 1_000 / hz;
}

/**
 * The clock a map draws at: `clock.now()` (the server clock by default), frozen while paused («Pausar movimiento»:
 * the data keeps loading, the aircraft stand still) and for good with `frozenAt` (the map lab's `?t=` instant, in
 * milliseconds), which is no pause: `isPaused()` stays false until someone pauses. Resuming picks up the server time
 * again, it does not go on from where it stopped.
 * - `now()`: the instant to draw at; `pause()`, `resume()`, `isPaused()`, `pausedAt()` (the frozen instant, or `null`);
 * - `isFrozen()`: whether `frozenAt` holds it; `subscribe(listener)` hears every pause and resume.
 */
export function createRenderClock({ clock = serverClock, frozenAt = null } = {}) {
  const frozen = finite(frozenAt) ? frozenAt : null;
  const listeners = new Set();
  let pausedAtMs = null;
  const notify = () => listeners.forEach(listener => listener());
  return Object.freeze({
    now: () => pausedAtMs ?? frozen ?? clock.now(),
    pause() {
      if (pausedAtMs !== null) return;
      pausedAtMs = frozen ?? clock.now();
      notify();
    },
    resume() {
      if (pausedAtMs === null) return;
      pausedAtMs = null;
      notify();
    },
    isPaused: () => pausedAtMs !== null,
    pausedAt: () => pausedAtMs,
    isFrozen: () => frozen !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}

const defaultRequestFrame = callback => (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame(callback)
  : globalThis.setTimeout(callback, 16));
const defaultCancelFrame = handle => (typeof globalThis.cancelAnimationFrame === 'function'
  ? globalThis.cancelAnimationFrame(handle)
  : globalThis.clearTimeout(handle));

/**
 * The animation loop of one map.
 * - `clock`: the render clock (createRenderClock): every frame draws at its `now()`, never at the browser's time;
 *   `pause()` and `resume()` go to it.
 * - `requestFrame`, `cancelFrame` (requestAnimationFrame by default), `setTimer`, `clearTimer` (the reduced-motion
 *   tick) and `document` (its visibility) are injected so a test drives them.
 * - `subscribe(onFrame, { isAnimating })`: `onFrame(tMs, { dtMs, reduced })` runs on every frame; after a frame the
 *   loop asks for the next one only while some subscriber's `isAnimating(tMs)` says yes, the clock is neither paused
 *   nor frozen and the tab shows. Returns the call that unsubscribes.
 * - `wake()`: one frame now, also while nothing animates, while paused or frozen (new data, a selection, the camera
 *   moved); while the tab is hidden it waits for the tab to show, which draws a frame anyway.
 * - `pause()` and `resume()`: the render clock's, with a frame at the instant that holds then.
 * - `setReducedMotion(on)`: once a second at whole seconds of the clock, `onFrame` with `reduced: true`, or back to
 *   every frame.
 * - `isRunning()`: whether a frame or a tick is due; `isPaused()` and `now()`: the clock's; `dispose()` cancels what is
 *   due and forgets every subscriber.
 */
export function createFrameLoop({
  clock = createRenderClock(),
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimer = handle => globalThis.clearTimeout(handle),
  document: doc = globalThis.document,
  reducedMotion = false,
} = {}) {
  const subscribers = new Set();
  let frameHandle = null;
  let timerHandle = null;
  let reduced = reducedMotion === true;
  let lastT = null;
  let disposed = false;

  const visible = () => doc?.visibilityState !== 'hidden';
  const canAnimate = () => !disposed && clock.isPaused?.() !== true && clock.isFrozen?.() !== true && visible();
  const animating = tMs => [...subscribers].some(entry => entry.isAnimating?.(tMs) === true);

  function cancelPending() {
    if (frameHandle !== null) cancelFrame(frameHandle);
    if (timerHandle !== null) clearTimer(timerHandle);
    frameHandle = null;
    timerHandle = null;
  }

  // The next frame of a loop that keeps going: the browser's next one, or under reduced motion the next whole second.
  function schedule() {
    if (frameHandle !== null || timerHandle !== null) return;
    if (reduced) {
      const now = clock.now();
      const intoSecond = ((now % REDUCED_MOTION_STEP_MS) + REDUCED_MOTION_STEP_MS) % REDUCED_MOTION_STEP_MS;
      timerHandle = setTimer(run, REDUCED_MOTION_STEP_MS - intoSecond);
    } else {
      frameHandle = requestFrame(run);
    }
  }

  function run() {
    frameHandle = null;
    timerHandle = null;
    if (disposed) return;
    const now = clock.now();
    const tMs = reduced ? Math.floor(now / REDUCED_MOTION_STEP_MS) * REDUCED_MOTION_STEP_MS : now;
    const dtMs = lastT === null ? 0 : Math.max(0, tMs - lastT);
    lastT = tMs;
    for (const entry of [...subscribers]) entry.onFrame(tMs, { dtMs, reduced });
    if (canAnimate() && animating(tMs)) schedule();
  }

  function wake() {
    if (disposed || frameHandle !== null || !visible()) return;
    // A reduced-motion tick waiting for its second gives way to a frame now; the ticks go on from there.
    if (timerHandle !== null) {
      clearTimer(timerHandle);
      timerHandle = null;
    }
    frameHandle = requestFrame(run);
  }

  function onVisibility() {
    if (!visible()) {
      cancelPending();
      return;
    }
    // Back on screen: nothing to catch up, the next frame draws at the current server time.
    lastT = null;
    wake();
  }
  doc?.addEventListener?.('visibilitychange', onVisibility);

  return Object.freeze({
    subscribe(onFrame, { isAnimating = null } = {}) {
      if (disposed || typeof onFrame !== 'function') return () => {};
      const entry = { onFrame, isAnimating };
      subscribers.add(entry);
      if (canAnimate() && isAnimating?.(clock.now()) === true) schedule();
      return () => {
        subscribers.delete(entry);
        if (subscribers.size === 0) cancelPending();
      };
    },
    wake,
    pause() {
      clock.pause?.();
      wake();
    },
    resume() {
      clock.resume?.();
      wake();
    },
    isPaused: () => clock.isPaused?.() === true,
    now: () => clock.now(),
    setReducedMotion(on) {
      const next = on === true;
      if (next === reduced) return;
      reduced = next;
      if (frameHandle === null && timerHandle === null) return;
      cancelPending();
      wake();
    },
    isRunning: () => frameHandle !== null || timerHandle !== null,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPending();
      subscribers.clear();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    },
  });
}
