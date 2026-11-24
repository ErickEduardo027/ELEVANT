'use client';

import { useEffect, useState } from 'react';
import { useOptionalOccShellChannel } from '../shell/occShellContext';
import { OCC_COALESCE_MS, OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from './occCadence';
import { createRefreshScheduler } from './refreshScheduler';

const NO_RESOURCES = Object.freeze([]);
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * When a screen with reads of its own (a `refreshToken` its data hooks re-read on) reads again, on the shell's single
 * observer (contracts 2.7). Pure apart from the timers: useOccScreenRefresh drives it.
 *
 * - `announce()`: one of the screen's resources changed. Coalesced as useOccResource does (refreshScheduler.js): at most
 *   one re-read every `coalesceMs`, a trailing one for what arrives meanwhile, joined with a read in flight and
 *   deferred while the tab is hidden.
 * - `refresh()`: the person asked (Reintentar). At once, or joined to a read the screen reports as running.
 * - `busy(value)`: what the screen's data hooks say of the read the last `onRead()` started; it settles once it went
 *   busy and stopped, or after `timeoutMs` if the screen never says so.
 * - A safety poll re-reads `pollMs` after the last read settled, deferred while the tab is hidden.
 * The screen's first read is its own mount: `start()` counts it as the read in flight.
 */
export function createScreenRefresh({ onRead, coalesceMs = OCC_COALESCE_MS, pollMs = OCC_SAFETY_POLL_MS,
  timeoutMs = OCC_READ_TIMEOUT_MS, schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = id => clearTimeout(id), now = () => Date.now(), hidden = isHidden }) {
  let reading = false;
  let sawBusy = false;
  let guard = null;
  let pollTimer = null;
  let pollDue = false;
  let stopped = true;
  // One scheduler per start: a stopped one forgets what it held (React may stop and start the same screen again).
  let scheduler = null;

  function clear(timer) {
    if (timer !== null) cancel(timer);
    return null;
  }

  function armPoll() {
    pollTimer = clear(pollTimer);
    if (!Number.isFinite(pollMs) || pollMs <= 0) return;
    pollTimer = schedule(() => {
      pollTimer = null;
      if (stopped || reading) return;
      if (hidden()) { pollDue = true; return; }
      read();
    }, pollMs);
  }

  function begin() {
    reading = true;
    sawBusy = false;
    pollDue = false;
    pollTimer = clear(pollTimer);
    scheduler.started();
    guard = clear(guard);
    guard = schedule(settle, timeoutMs);
  }

  function settle() {
    if (!reading || stopped) return;
    reading = false;
    guard = clear(guard);
    armPoll();
    scheduler.settled();
  }

  function read() {
    if (stopped) return;
    begin();
    onRead();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      scheduler = createRefreshScheduler({ coalesceMs, now, schedule, cancel, isHidden: hidden, run: () => read() });
      begin();
    },
    stop() {
      stopped = true;
      reading = false;
      scheduler?.dispose();
      guard = clear(guard);
      pollTimer = clear(pollTimer);
    },
    announce() {
      if (!stopped) scheduler.request();
    },
    refresh() {
      if (stopped) return;
      // Joined to a read the screen says is running; otherwise at once.
      if (reading && sawBusy) scheduler.request();
      else read();
    },
    busy(value) {
      if (!reading) return;
      if (value) sawBusy = true;
      else if (sawBusy) settle();
    },
    becameVisible() {
      if (stopped || hidden()) return;
      scheduler.becameVisible();
      if (pollDue && !reading) read();
    },
  };
}

/**
 * The re-reads of a screen whose data hooks take a `refreshToken` (Monitoreo de vuelos, Mapa de posiciones,
 * Planificación) on the shell's single observer: no observer, poll or focus listener of its own (contracts 2.7).
 * Returns `{ token, refresh, busy }`: `token` grows by one for each re-read (pass it to the data hooks), `refresh()`
 * re-reads at once (Reintentar) and `busy(reading)`, called by the screen after each render (an effect), says whether its
 * data hooks are reading (createScreenRefresh: the in-flight join). `resources` are the announced resources the screen
 * shows. Outside the OCC frame (no shell) it hears no announcement and keeps only its safety poll. `enabled: false`
 * re-reads nothing.
 */
export function useOccScreenRefresh({ resources = NO_RESOURCES, enabled = true,
  coalesceMs = OCC_COALESCE_MS, pollMs = OCC_SAFETY_POLL_MS } = {}) {
  const channel = useOptionalOccShellChannel();
  const [token, setToken] = useState(0);
  const [engine] = useState(() => createScreenRefresh({ coalesceMs, pollMs,
    onRead: () => setToken(value => value + 1) }));
  const resourcesKey = [...new Set(resources)].sort().join('\n');

  useEffect(() => {
    if (!enabled) return undefined;
    engine.start();
    const onVisibility = () => engine.becameVisible();
    const onOnline = () => engine.announce();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      engine.stop();
    };
  }, [enabled, engine]);

  useEffect(() => {
    if (!enabled || !channel || !resourcesKey) return undefined;
    return channel.subscribe(resourcesKey.split('\n'), engine.announce);
  }, [channel, enabled, engine, resourcesKey]);

  return { token, refresh: engine.refresh, busy: engine.busy };
}
