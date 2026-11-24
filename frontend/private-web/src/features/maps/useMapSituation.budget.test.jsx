import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedOccMapAdapter } from '../../services/occMapService';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import {
  OCC_DEMO_MINUTE, OCC_REQUEST_BUDGET, OCC_REQUEST_PLAN, OCC_SCREEN_POLLS, OCC_SCREEN_REFRESH,
} from '../admin-occ/live/occRequestPlan';
import { createRefreshScheduler } from '../admin-occ/live/refreshScheduler';
import { createScreenRefresh } from '../admin-occ/live/useOccScreenRefresh';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { createTrafficScenario, TRAFFIC_NOON, TRAFFIC_STATION_ID } from './testing/trafficFixtures';
import { MAP_SITUATION_READS, useMapSituation } from './useMapSituation';

// The request budget of a map (contracts 2.7): one scripted demo minute (OCC_DEMO_MINUTE) replayed against the real hook
// and the simulated adapter, counting what it asks from the moment it mounts, then added to Monitoreo de vuelos as it is
// today (the frame, the route's re-reads on useOccScreenRefresh), replayed on the same fake clock with the rules of
// occRequestBudget.test.js: the shell's observer groups the hints (`hintCoalesceMs`) and delivers what changed, to the
// map too, once its cursor read answers. Every answer takes 200 ms, enough to join reads that arrive while one is in
// flight.

const MINUTE_MS = 60_000;
const READ_LATENCY_MS = 200;
const MONITORING_ROUTE = 'src/features/flight-monitoring/FlightMonitoringRoute.jsx';
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function mountMap(shell) {
  const adapter = createSimulatedOccMapAdapter({ scenario: createTrafficScenario(), latencyMs: READ_LATENCY_MS });
  const wrapper = ({ children }) => (
    <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
      <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  renderHook(() => useMapSituation({ stationId: TRAFFIC_STATION_ID, service: adapter }), { wrapper });
  return adapter;
}

/**
 * The tab's observer (services/accountChangeObserver.js), with fake timers: a cursor read at once for a hint after a quiet
 * window, one trailing read `hintCoalesceMs` after the last for the hints that follow, and one every 25 s; each read
 * delivers, once it answers, the resources announced before it began. Returns `hint(resource)`.
 */
function startShellObserver(record, deliver) {
  const { pollMs, hintCoalesceMs } = OCC_REQUEST_PLAN.observer;
  let pending = new Set();
  let lastPassAt = null;
  let timer = null;
  let active = false;
  let dirty = false;
  function pass() {
    lastPassAt = Date.now();
    clearTimeout(timer);
    timer = null;
    active = true;
    record('shell:cursor');
    const batch = [...pending];
    pending = new Set();
    setTimeout(() => {
      active = false;
      if (batch.length) deliver(batch);
      if (dirty) {
        dirty = false;
        pass();
      }
    }, READ_LATENCY_MS);
  }
  const reconcile = () => { if (active) dirty = true; else pass(); };
  reconcile();
  setInterval(reconcile, pollMs);
  return resource => {
    pending.add(resource);
    if (timer !== null) return;
    const wait = lastPassAt === null ? 0 : lastPassAt + hintCoalesceMs - Date.now();
    if (wait <= 0) reconcile();
    else timer = setTimeout(() => { timer = null; reconcile(); }, wait);
  };
}

/**
 * Today's Monitoreo de vuelos without its map: the frame's reads through the shell's refresh scheduler and the route's
 * re-reads on useOccScreenRefresh's rules, both on the shell's deliveries, and the screen's own polls (none left).
 * `record(key)` is called for each request; returns the listeners the shell's observer delivers to.
 */
function startMonitoringToday(record) {
  const listeners = [];
  const every = (ms, callback) => setInterval(callback, ms);

  for (const frameRead of OCC_REQUEST_PLAN.frame) {
    if (frameRead.fixedRate) {
      record(frameRead.key);
      every(frameRead.pollMs, () => record(frameRead.key));
      continue;
    }
    // As useOccResource: coalesced announcements and a safety poll counted from the last finished read.
    let inFlight = false;
    let poll = null;
    const scheduler = createRefreshScheduler({ coalesceMs: frameRead.coalesceMs, run: () => read() });
    function read() {
      record(frameRead.key);
      inFlight = true;
      clearTimeout(poll);
      scheduler.started();
      setTimeout(() => {
        inFlight = false;
        poll = setTimeout(() => { if (!inFlight) read(); }, frameRead.pollMs);
        scheduler.settled();
      }, READ_LATENCY_MS);
    }
    listeners.push({ resources: frameRead.resources, onChange: () => scheduler.request() });
    read();
  }
  const route = OCC_SCREEN_REFRESH[MONITORING_ROUTE];
  let engine = null;
  const readAll = () => {
    for (let count = 0; count < route.readsPerRefresh; count += 1) record('FlightMonitoringRoute:read');
    engine.busy(true);
    setTimeout(() => engine.busy(false), READ_LATENCY_MS);
  };
  engine = createScreenRefresh({ coalesceMs: route.coalesceMs, pollMs: route.pollMs, hidden: () => false,
    onRead: readAll });
  engine.start();
  readAll();
  listeners.push({ resources: route.resources, onChange: () => engine.announce() });
  for (const screenPoll of OCC_SCREEN_POLLS.filter(item => item.screen === 'flight-monitoring')) {
    record(screenPoll.key);
    every(screenPoll.pollMs, () => record(screenPoll.key));
  }
  return listeners;
}

// Replays the demo minute from the mount: each announcement at its second, then up to the end of the minute.
async function replayDemoMinute(announce) {
  let elapsed = 0;
  for (const { at, resource } of OCC_DEMO_MINUTE) {
    await flush(at * 1_000 - elapsed);
    elapsed = at * 1_000;
    act(() => announce(resource));
  }
  await flush(MINUTE_MS - elapsed - 1);
}

const tally = keys => keys.reduce((counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 }), {});

let start;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse(TRAFFIC_NOON));
  start = Date.now();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('the map within the OCC request budget (contracts 2.7)', () => {
  it("the map's reads in a demo minute: six air pictures, at most nine flight reads, one ping", async () => {
    expect(MAP_SITUATION_READS.mapFlights.resources).toEqual(['occ_planning']);
    expect(MAP_SITUATION_READS.airPicture.resources).toEqual([]);
    const shell = createOccShellValue();
    const adapter = mountMap(shell);
    const hint = startShellObserver(() => {}, resources => shell.announce(resources));
    await replayDemoMinute(hint);

    const reads = tally(adapter.calls.filter(call => call.at - start < MINUTE_MS).map(call => call.read));
    expect(reads.airPicture).toBe(6);
    expect(reads.mapFlights).toBeLessThanOrEqual(9);
    expect(reads.ping).toBe(1);
    expect(reads.aircraftTrack).toBeUndefined();
    // The air picture keeps the server's pace (10 s after each answer), whatever is announced.
    const pictures = adapter.calls.filter(call => call.read === 'airPicture').map(call => call.at - start);
    pictures.slice(1).forEach((at, index) => expect(at - pictures[index]).toBeGreaterThanOrEqual(10_000));
  });

  it('Monitoreo de vuelos with the live map stays within 40 requests in a demo minute', async () => {
    const today = [];
    const record = key => today.push({ key, at: Date.now() - start });
    const listeners = startMonitoringToday(record);
    const shell = createOccShellValue();
    const adapter = mountMap(shell);
    const hint = startShellObserver(record, resources => {
      for (const listener of listeners) {
        if (listener.resources.some(resource => resources.includes(resource))) listener.onChange();
      }
      shell.announce(resources);
    });
    await replayDemoMinute(hint);

    const map = adapter.calls.filter(call => call.at - start < MINUTE_MS).map(call => call.read);
    const rest = today.filter(request => request.at < MINUTE_MS).map(request => request.key);
    const byKey = tally([...map, ...rest]);
    const total = map.length + rest.length;
    expect(total, `${total} requests: ${JSON.stringify(byKey)}`).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.demo);
    // The map adds its own reads only: the screen as it is today keeps every request it sends.
    expect(map.length).toBeLessThanOrEqual(16);
    expect(rest.length).toBeGreaterThan(0);
  });
});
