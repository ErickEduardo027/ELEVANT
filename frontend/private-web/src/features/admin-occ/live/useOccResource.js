'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { abortForEffectCleanup } from '../../../lib/abort';
import { useOccShellChannel } from '../shell/occShellContext';
import { OCC_COALESCE_MS, OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from './occCadence';
import { createRefreshScheduler } from './refreshScheduler';

const NO_RESOURCES = Object.freeze([]);
const closedView = status => Object.freeze({ status, data: null, refreshing: false, refreshFailed: false, fetchedAt: null });
const IDLE_VIEW = closedView('idle');
const LOADING_VIEW = closedView('loading');
const FORBIDDEN_VIEW = closedView('forbidden');

function statusForError(error) {
  if (error?.code === 'timeout') return 'timeout';
  if (error?.status === 401 || error?.code === 'unauthorized') return 'unauthorized';
  if (error?.status === 403 || error?.status === 404 || error?.code === 'forbidden') return 'forbidden';
  return 'error';
}

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

// What the source list says about a read (sourceHealth.js).
function healthOf({ status, refreshFailed }) {
  if (status === 'success' || status === 'empty') return refreshFailed ? 'delayed' : 'ok';
  if (status === 'error' || status === 'timeout') return 'offline';
  if (status === 'forbidden' || status === 'unauthorized') return 'forbidden';
  return 'idle';
}

/**
 * The read loop of one resource, outside React: useOccResource starts it for a scope, stops it on cleanup and reads
 * its state through useSyncExternalStore. A lifecycle (`cycle`) belongs to one scope; anything that answers after its
 * cycle stopped is ignored.
 */
function createResourceEngine(key) {
  let config = { load: null, isEmpty: null, pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS,
    timeoutMs: OCC_READ_TIMEOUT_MS };
  let state = { status: 'loading', data: null, scopeKey: null, refreshing: false, refreshFailed: false, fetchedAt: null };
  let current = null;
  const listeners = new Set();

  const emit = next => { state = next; listeners.forEach(listener => listener()); };
  const keepsData = cycle => state.scopeKey === cycle.scopeKey && state.data != null;
  const closed = (cycle, status) => ({ status, data: null, scopeKey: cycle.scopeKey, refreshing: false,
    refreshFailed: false, fetchedAt: null });

  function clearPoll(cycle) {
    if (cycle.pollTimer === null) return;
    clearTimeout(cycle.pollTimer);
    cycle.pollTimer = null;
  }

  // The safety poll counts from the last finished read; `pollMs` may be a function of the data it answered.
  function armPoll(cycle) {
    clearPoll(cycle);
    const ms = typeof config.pollMs === 'function' ? config.pollMs(state.data) : config.pollMs;
    if (!Number.isFinite(ms) || ms <= 0) return;
    cycle.pollTimer = setTimeout(() => {
      cycle.pollTimer = null;
      if (cycle.stopped || cycle.blocked || cycle.inFlight) return;
      if (isHidden()) { cycle.pollDue = true; return; }
      read(cycle);
    }, ms);
  }

  function succeed(cycle, data) {
    emit({ status: config.isEmpty?.(data) ? 'empty' : 'success', data, scopeKey: cycle.scopeKey, refreshing: false,
      refreshFailed: false, fetchedAt: new Date().toISOString() });
  }

  function fail(cycle, error) {
    const status = statusForError(error);
    if (status === 'unauthorized' || status === 'forbidden') {
      // The server refused this account: drop what it showed and stop asking until access changes or retry().
      cycle.blocked = true;
      emit(closed(cycle, status));
      return;
    }
    // A failed refresh keeps what the screen shows and says so; a failed first read reports the failure.
    emit(keepsData(cycle) ? { ...state, refreshing: false, refreshFailed: true } : closed(cycle, status));
  }

  function read(cycle) {
    if (cycle.stopped) return;
    const controller = new AbortController();
    let done = false;
    let timer = null;
    const finish = outcome => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (cycle.stopped) return;
      cycle.inFlight = false;
      cycle.controller = null;
      outcome();
      if (!cycle.blocked) armPoll(cycle);
      cycle.scheduler.settled();
    };
    timer = setTimeout(() => {
      finish(() => fail(cycle, Object.assign(new Error(`${key}: the read took too long`), { code: 'timeout' })));
      controller.abort();
    }, config.timeoutMs);
    cycle.controller = controller;
    cycle.inFlight = true;
    cycle.pollDue = false;
    clearPoll(cycle);
    cycle.scheduler.started();
    emit(keepsData(cycle) ? { ...state, refreshing: true } : closed(cycle, 'loading'));
    new Promise(resolve => { resolve(config.load({ signal: controller.signal })); })
      .then(data => finish(() => succeed(cycle, data)), error => finish(() => fail(cycle, error)));
  }

  function onVisibility() {
    const cycle = current;
    if (!cycle || isHidden()) return;
    cycle.scheduler.becameVisible();
    if (cycle.pollDue && !cycle.inFlight && !cycle.blocked) read(cycle);
  }

  function stop() {
    const cycle = current;
    if (!cycle) return;
    current = null;
    cycle.stopped = true;
    cycle.scheduler.dispose();
    clearPoll(cycle);
    if (cycle.controller) abortForEffectCleanup(cycle.controller);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => state,
    configure(next) { config = { ...config, ...next }; },
    start(scopeKey) {
      stop();
      const cycle = { scopeKey, stopped: false, blocked: false, inFlight: false, controller: null, pollTimer: null,
        pollDue: false };
      cycle.scheduler = createRefreshScheduler({ coalesceMs: config.coalesceMs, isHidden, run: () => read(cycle) });
      current = cycle;
      document.addEventListener('visibilitychange', onVisibility);
      read(cycle);
    },
    stop,
    // An announcement of one of the resource's resources.
    announce() {
      if (current && !current.blocked) current.scheduler.request();
    },
    refresh() {
      const cycle = current;
      if (!cycle || cycle.blocked) return;
      if (cycle.inFlight) cycle.scheduler.request();
      else read(cycle);
    },
    retry() {
      const cycle = current;
      if (!cycle) return;
      cycle.blocked = false;
      if (!cycle.inFlight) read(cycle);
    },
    resume() {
      const cycle = current;
      if (!cycle?.blocked) return;
      cycle.blocked = false;
      read(cycle);
    },
    setData(updater) {
      if (state.data == null) return;
      const data = typeof updater === 'function' ? updater(state.data) : updater;
      if (data === state.data) return;
      const status = state.status === 'success' || state.status === 'empty'
        ? (config.isEmpty?.(data) ? 'empty' : 'success') : state.status;
      emit({ ...state, data, status });
    },
  };
}

/**
 * One OCC read on the shell's single observer (contracts 2.7).
 *
 * - Reads only while useDepartmentAccess() grants `permission`; otherwise `forbidden`, with no request.
 * - Re-reads when the shell announces one of `resources`: at most once every `coalesceMs`, joined with a read in
 *   flight, and deferred while the tab is hidden.
 * - A safety poll re-reads `pollMs` after the last finished read (a number, or a function of the data), also
 *   deferred while the tab is hidden.
 * - After a 401 (`unauthorized`) or a 403/404 (`forbidden`) it drops the data, stops polling and ignores
 *   announcements until the access object changes or `retry()` is called.
 * - A failed refresh keeps the data (`refreshFailed`); a new `scopeKey` drops it; a read is abandoned after
 *   `timeoutMs` (`timeout`); unmounting aborts the read in flight.
 * - With `sourceId` it reports the read to the shell's source list. `enabled: false` reads nothing (`idle`).
 * `key` names the read in its errors.
 */
export function useOccResource({ key, load, permission, resources = NO_RESOURCES, scopeKey = '', enabled = true,
  pollMs = OCC_SAFETY_POLL_MS, coalesceMs = OCC_COALESCE_MS, timeoutMs = OCC_READ_TIMEOUT_MS, isEmpty, sourceId }) {
  const channel = useOccShellChannel();
  const { access } = useDepartmentAccess();
  const granted = Boolean(access) && (!permission || access.can(permission));
  const active = Boolean(enabled) && granted;
  const [engine] = useState(() => createResourceEngine(key));
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const resourcesKey = [...new Set(resources)].sort().join('\n');

  // The latest read options; this effect runs first, so a start below always reads with them.
  useEffect(() => { engine.configure({ load, isEmpty, pollMs, coalesceMs, timeoutMs }); });

  useEffect(() => {
    if (!active) return undefined;
    engine.start(scopeKey);
    return () => engine.stop();
  }, [active, engine, scopeKey]);

  useEffect(() => {
    if (!active || !resourcesKey) return undefined;
    return channel.subscribe(resourcesKey.split('\n'), engine.announce);
  }, [active, channel, engine, resourcesKey]);

  // A new access object (the shell refreshes it on department_users and access_requests) resumes a refused read.
  useEffect(() => { engine.resume(); }, [access, engine]);

  let view = snapshot;
  if (!enabled) view = IDLE_VIEW;
  else if (!access) view = LOADING_VIEW;
  else if (!granted) view = FORBIDDEN_VIEW;
  // Effects run after render: never show another scope's data, even for one frame.
  else if (snapshot.scopeKey !== scopeKey) view = LOADING_VIEW;

  const health = healthOf(view);
  const healthAt = health === 'ok' || health === 'delayed' ? view.fetchedAt : null;
  useEffect(() => {
    if (sourceId) channel.sources.report(sourceId, { state: health, at: healthAt });
  }, [channel, health, healthAt, sourceId]);
  useEffect(() => (sourceId ? () => channel.sources.remove(sourceId) : undefined), [channel, sourceId]);

  return useMemo(() => ({
    status: view.status, data: view.data, refreshing: view.refreshing, refreshFailed: view.refreshFailed,
    fetchedAt: view.fetchedAt, refresh: engine.refresh, retry: engine.retry, setData: engine.setData,
  }), [engine, view]);
}
