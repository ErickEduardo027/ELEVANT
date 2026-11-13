import { OCC_COALESCE_MS } from './occCadence';

/**
 * When an announced resource is read again (contracts 2.7). Pure: the clock, the timers, the tab's visibility and
 * the read are injected, so useOccResource and the request-budget test run the same rules.
 *
 * - `request()`: something changed. Reads at once if no read started in the last `coalesceMs`; otherwise one
 *   trailing read at the end of that window takes every request that arrives meanwhile.
 * - A request that arrives during a read is joined into one read after it (`settled()` asks again).
 * - A request that arrives while the tab is hidden waits, and `becameVisible()` reads once for all of them.
 * - `started()` and `settled()` frame every read of the resource, whatever started it, so a poll or a manual
 *   refresh also counts for the window and satisfies a pending trailing read.
 */
export function createRefreshScheduler({ coalesceMs = OCC_COALESCE_MS, now = () => Date.now(),
  schedule = (callback, ms) => setTimeout(callback, ms), cancel = id => clearTimeout(id),
  isHidden = () => false, run }) {
  let lastStartAt = null;
  let inFlight = false;
  let pending = false;
  let deferred = false;
  let timer = null;
  let disposed = false;

  function clearTimer() {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  }

  function fire() {
    timer = null;
    if (disposed) return;
    if (isHidden()) { deferred = true; return; }
    run();
  }

  function request() {
    if (disposed) return;
    if (isHidden()) { deferred = true; return; }
    if (inFlight) { pending = true; return; }
    if (timer !== null) return;
    const wait = lastStartAt === null ? 0 : lastStartAt + coalesceMs - now();
    if (wait <= 0) run();
    else timer = schedule(fire, wait);
  }

  return {
    request,
    started() {
      inFlight = true;
      lastStartAt = now();
      // This read sees every change announced before it began.
      clearTimer();
      deferred = false;
    },
    settled() {
      inFlight = false;
      if (disposed || !pending) return;
      pending = false;
      request();
    },
    becameVisible() {
      if (disposed || !deferred) return;
      deferred = false;
      request();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
