import { useEffect, useState } from 'react';

// The instant the stands of a screen inside the OCC frame read (PR M6): the clock the map draws its aircraft at (the
// render clock of useMapSituation, over the server clock; contracts 2.7, one clock for the whole app), so a demo stand
// turns Ocupada at the server's on-block and frees at its off-block in the same moment its aircraft stops or starts to
// roll, whatever the laptop's own clock says. It re-renders on each minute of that clock (the states and countdowns
// change on the minute) and at each demo instant of the visits in between, never per frame. «Pausar movimiento» freezes
// the render clock, and with it the stands, until it resumes.

const MINUTE_MS = 60 * 1000;
const DEMO_INSTANTS = Object.freeze(['touchdownAt', 'onBlockAt', 'offBlockAt']);

const timeOf = value => {
  const ms = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
};

function legsOf(flightsByTurnaround) {
  if (flightsByTurnaround == null) return [];
  const values = flightsByTurnaround instanceof Map ? [...flightsByTurnaround.values()] : Object.values(flightsByTurnaround);
  return values.flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter(leg => leg !== null && typeof leg === 'object');
}

/**
 * The first demo instant of the map flights (`touchdownAt`, `onBlockAt` or `offBlockAt` of their `demo`) after `afterMs`
 * and up to `untilMs` included, or `null`: the moments a demo stand changes state between two minutes.
 */
export function nextDemoInstant(flightsByTurnaround, afterMs, untilMs = Infinity) {
  let next = null;
  for (const leg of legsOf(flightsByTurnaround)) {
    const demo = leg.demo;
    if (demo === null || typeof demo !== 'object') continue;
    for (const key of DEMO_INSTANTS) {
      const at = timeOf(demo[key]);
      if (at !== null && at > afterMs && at <= untilMs && (next === null || at < next)) next = at;
    }
  }
  return next;
}

/**
 * The instant the stands read, from `clock` (`{ now(), subscribe? }`: the map's render clock), or `null` without one
 * (the screen then keeps the minute clock of the browser, as outside the OCC frame). It changes at each minute of that
 * clock, at each demo instant of `flightsByTurnaround` and when the clock pauses or resumes.
 */
export function useStandClock({ clock = null, flightsByTurnaround } = {}) {
  const [tick, setTick] = useState(() => (clock ? clock.now() : null));
  const current = clock ? tick ?? clock.now() : null;

  useEffect(() => {
    if (!clock) return undefined;
    const now = clock.now();
    // New flights, or a clock that moved on since the last tick (a new clock, a resume): read again at once when a
    // minute or a demo instant went by in between; else at the next minute or demo instant.
    const stale = current === null || Math.floor(now / MINUTE_MS) !== Math.floor(current / MINUTE_MS)
      || nextDemoInstant(flightsByTurnaround, current, now) !== null;
    const nextMinute = (Math.floor(now / MINUTE_MS) + 1) * MINUTE_MS;
    const due = stale ? now : Math.min(nextMinute, nextDemoInstant(flightsByTurnaround, now) ?? Infinity);
    // A paused clock stands still: the tick then changes nothing, and the next resume reads again.
    const timer = setTimeout(() => setTick(clock.now()), Math.max(0, due - now));
    const unsubscribe = typeof clock.subscribe === 'function' ? clock.subscribe(() => setTick(clock.now())) : null;
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [clock, current, flightsByTurnaround]);

  return current;
}
