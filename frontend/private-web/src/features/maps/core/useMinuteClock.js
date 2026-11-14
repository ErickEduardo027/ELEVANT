import { useSyncExternalStore } from 'react';

// The clock of the stand states and countdowns: they change only on the minute (stands/standModel.js), so the screens
// re-render once a minute, never per frame. It reads the browser's clock and makes no request (contracts 2.7).

const MINUTE_MS = 60 * 1000;
const floorToMinute = ms => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

// One timeout to the next minute boundary at a time, never an interval; each tick schedules the next one.
function subscribeToMinutes(onTick) {
  let timer = null;
  const schedule = () => {
    timer = setTimeout(() => {
      onTick();
      schedule();
    }, MINUTE_MS - (Date.now() % MINUTE_MS));
  };
  schedule();
  return () => clearTimeout(timer);
}

const subscribeToNothing = () => () => {};
const currentMinute = () => floorToMinute(Date.now());

/**
 * The current time in milliseconds, rounded down to the minute; the component re-renders at each minute boundary.
 * `frozenAt` (milliseconds, the map lab's `?t=`) holds that instant, rounded the same way, and starts no timer.
 */
export function useMinuteClock({ frozenAt = null } = {}) {
  const frozen = Number.isFinite(frozenAt) ? floorToMinute(frozenAt) : null;
  const subscribe = frozen === null ? subscribeToMinutes : subscribeToNothing;
  const minute = useSyncExternalStore(subscribe, currentMinute, currentMinute);
  return frozen ?? minute;
}
