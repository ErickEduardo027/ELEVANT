// The server's time in the browser, one clock for the whole app (contracts 2.7). The API does not expose its `Date`
// header to the browser, so the clock learns the offset from the instants the API writes in its bodies: the `serverTime`
// of every map read and the `timestampUtc` of `system/ping` (SystemPingResponse does not change). Everything that moves
// on the OCC maps is a function of this time, so every screen draws the same thing at the same moment.

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FRACTION = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/;

/**
 * Milliseconds of an instant the API wrote (`2026-11-13T15:00:00.1234567+00:00`), or `null` when it is not one. .NET
 * writes up to seven decimals and not every engine parses more than three, so the fraction is cut (never rounded) to
 * milliseconds, as the api-client's validators read it.
 */
export function parseInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return null;
  const ms = Date.parse(value.replace(FRACTION, (_, digits) => `.${digits.slice(0, 3).padEnd(3, '0')}`));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A clock that follows the server's time. `observe(serverTime, sentAtMs, receivedAtMs)` adds one sample: a read sent
 * and answered at those instants of `localNow()` that carried `serverTime`. The offset is the one of the sample with the
 * smallest round trip among the last `maxSamples` (`server − (sent + received) / 2`, as NTP does): the shorter the
 * round trip, the less the answer could have waited. Without a sample the clock reads the browser's time and
 * `isSynced()` is false.
 *
 * - `now()`: the server's time in milliseconds; `offsetMs()`: the offset in use, or `null`.
 * - `subscribe(listener)` tells when the offset changes and returns the unsubscribe function; `reset()` forgets every
 *   sample.
 * - `localNow()` is the browser's own reading (`now` option): sent and received instants must be taken with it.
 */
export function createServerClock({ now = () => Date.now(), maxSamples = 8 } = {}) {
  const limit = Math.max(1, Math.floor(maxSamples) || 1);
  const listeners = new Set();
  let samples = [];
  let offset = null;

  // The fastest round trip wins; between equal ones, the newest, which knows the latest drift.
  function settle() {
    let best = null;
    for (const sample of samples) if (best === null || sample.roundTripMs <= best.roundTripMs) best = sample;
    const next = best === null ? null : best.offsetMs;
    if (next === offset) return;
    offset = next;
    listeners.forEach(listener => listener());
  }

  return Object.freeze({
    observe(serverTime, sentAtMs, receivedAtMs) {
      const serverMs = parseInstant(serverTime);
      if (serverMs === null || !Number.isFinite(sentAtMs) || !Number.isFinite(receivedAtMs) || receivedAtMs < sentAtMs) {
        return false;
      }
      samples = [...samples, { offsetMs: serverMs - (sentAtMs + receivedAtMs) / 2, roundTripMs: receivedAtMs - sentAtMs }]
        .slice(-limit);
      settle();
      return true;
    },
    now: () => now() + (offset ?? 0),
    localNow: () => now(),
    offsetMs: () => offset,
    isSynced: () => offset !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reset() {
      samples = [];
      settle();
    },
  });
}

/** The app's clock: the map reads and the ping feed it, and every OCC screen reads the server's time from it. */
export const serverClock = createServerClock();

/**
 * Asks the server its time once and feeds `clock` with the answer's `timestampUtc`. `ping({ signal })` is the
 * `getSystemPing` read of a service (occMapService's `ping`). Resolves to whether the sample was taken.
 */
export async function syncServerClock({ ping, clock = serverClock, signal } = {}) {
  if (typeof ping !== 'function') throw new TypeError('syncServerClock needs the ping read.');
  const sentAt = clock.localNow();
  const response = await ping({ signal });
  return clock.observe(response?.timestampUtc, sentAt, clock.localNow());
}
