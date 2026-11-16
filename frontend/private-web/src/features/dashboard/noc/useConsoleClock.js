'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** How often the console's countdowns and its band's «ahora» line move: «en 12 min» changes once a minute at most. */
export const CONSOLE_TICK_MS = 15_000;

// One timer while the tab shows; hidden, nothing runs, and the tab showing again ticks at once.
function subscribeEvery(stepMs) {
  return listener => {
    let timer = null;
    const start = () => {
      if (timer === null) timer = setInterval(listener, stepMs);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      listener();
      start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState !== 'hidden') start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  };
}

const subscribers = new Map();
const subscriberFor = stepMs => {
  if (!subscribers.has(stepMs)) subscribers.set(stepMs, subscribeEvery(stepMs));
  return subscribers.get(stepMs);
};
const noSubscription = () => () => {};
const noTime = () => null;

/**
 * The server's time in milliseconds (`clock.now()`, src/services/serverClock.js), rounded down to `stepMs` and read
 * again every `stepMs` while the tab shows: the console counts down with the server's clock, never the device's. Without
 * a clock, `null`. It makes no request (contratos 2.7).
 */
export function useConsoleClock(clock, stepMs = CONSOLE_TICK_MS) {
  const live = typeof clock?.now === 'function';
  const read = useCallback(() => (live ? Math.floor(clock.now() / stepMs) * stepMs : null), [clock, live, stepMs]);
  return useSyncExternalStore(live ? subscriberFor(stepMs) : noSubscription, read, noTime);
}
