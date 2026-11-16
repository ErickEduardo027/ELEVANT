import { useSyncExternalStore } from 'react';

// The clock of the stand states and countdowns, and of the night shade (PR M8): they change only on the minute
// (stands/standModel.js, traffic/nightShade.js), so the screens re-render once a minute, never per frame. It reads the
// browser's clock, or the clock it is given (the server's, services/serverClock.js, for the night), and makes no
// request (contracts 2.7).

const MINUTE_MS = 60 * 1000;
const floorToMinute = ms => Math.floor(ms / MINUTE_MS) * MINUTE_MS;
const untilNextMinute = ms => MINUTE_MS - (((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);

/** The browser's clock. */
const BROWSER_CLOCK = Object.freeze({ now: () => Date.now() });

// One timeout to the next minute boundary of the clock at a time, never an interval; each tick schedules the next one.
// A clock that tells when its time moves (services/serverClock.js: subscribe, on a new offset) ticks at once and is
// timed again, since its minute may have changed.
function minuteSource(clock) {
  const current = () => floorToMinute(clock.now());
  const subscribe = onTick => {
    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => {
        onTick();
        schedule();
      }, untilNextMinute(clock.now()));
    };
    schedule();
    const stopListening = typeof clock.subscribe === 'function'
      ? clock.subscribe(() => {
        clearTimeout(timer);
        onTick();
        schedule();
      })
      : null;
    return () => {
      clearTimeout(timer);
      stopListening?.();
    };
  };
  return { current, subscribe };
}

// One source per clock, so its subscribe and its snapshot keep their identity from render to render.
const sources = new WeakMap();
function sourceFor(clock) {
  if (!sources.has(clock)) sources.set(clock, minuteSource(clock));
  return sources.get(clock);
}

const subscribeToNothing = () => () => {};

/**
 * The current time in milliseconds, rounded down to the minute; the component re-renders at each minute boundary.
 * `frozenAt` (milliseconds, the map lab's `?t=`) holds that instant, rounded the same way, and starts no timer.
 * `clock` (`{ now() }`, the browser's by default) is the clock whose minute it follows: the server's clock for what moves
 * with the server's time.
 */
export function useMinuteClock({ frozenAt = null, clock = BROWSER_CLOCK } = {}) {
  const frozen = Number.isFinite(frozenAt) ? floorToMinute(frozenAt) : null;
  const source = sourceFor(clock ?? BROWSER_CLOCK);
  const subscribe = frozen === null ? source.subscribe : subscribeToNothing;
  const minute = useSyncExternalStore(subscribe, source.current, source.current);
  return frozen ?? minute;
}
