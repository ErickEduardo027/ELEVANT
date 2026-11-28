import { act, cleanup, renderHook } from '@testing-library/react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountChangeObserver } from '../../../services/accountChangeObserver';
import { createSimulatedOccMapAdapter } from '../../../services/occMapService';
import { createSimulatedRegionWeatherAdapter } from '../../../services/regionWeatherService';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { OCC_DEMO_MINUTE, OCC_REQUEST_BUDGET, OCC_REQUEST_PLAN } from '../../admin-occ/live/occRequestPlan';
import { useOccResource } from '../../admin-occ/live/useOccResource';
import {
  createOccShellValue, OCC_TEST_ACCOUNT_ID, OccShellTestProvider,
} from '../../admin-occ/shell/testing/occShellFixtures';
import { boardStand } from '../../maps/testing/mapFixtures';
import { createTrafficScenario, TRAFFIC_NOON, TRAFFIC_STATION_ID } from '../../maps/testing/trafficFixtures';
import { createRegionWeatherScenario } from '../../maps/testing/weatherFixtures';
import { useMapSituation } from '../../maps/useMapSituation';
import { useRegionWeather } from '../../weather/useRegionWeather';
import { useConsoleData } from './useConsoleData';

// The console within the OCC request budget (contratos 2.7), with the real hooks: useConsoleData over counted
// stand-ins of its four adapters, useMapSituation over the simulated map adapter, and the frame's own reads as the shell
// sends them (its notices on useOccResource with the plan's cadence, the one observer's cursor reads and the presence
// lease), on a test channel fed by the real account-change observer (services/accountChangeObserver.js, with the
// shell's `hintCoalesceMs`) over a stand-in feed and two stand-in hubs that hint the scripted announcements of a demo
// minute (OCC_DEMO_MINUTE): the channel hears what the cursor read returned, once it answered. Everything
// mounts at t = 0; after a minute of warm-up the second minute is counted. Every answer takes 200 ms, enough to join
// the announcements that arrive while a read is in flight.

const WARM_UP_MS = 60_000;
const MINUTE_MS = 60_000;
const READ_LATENCY_MS = 200;
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const NOTICES = OCC_REQUEST_PLAN.frame.find(read => read.key === 'notices');
const PRESENCE = OCC_REQUEST_PLAN.frame.find(read => read.key === 'presence');

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const answerLater = value => new Promise(resolve => { setTimeout(() => resolve(value), READ_LATENCY_MS); });

const planningSnapshot = stationId => ({
  station: { id: stationId, code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
  date: '2026-11-13', turnarounds: [],
});
const reviewQueue = stationId => ({ stationId, stationCode: 'PUJ', stationName: 'Punta Cana',
  ianaTimeZone: 'America/Santo_Domingo', operations: [], hasMore: false });
const positionsBoard = (stationId, date) => ({ stationId, stationCode: 'PUJ', operationDate: date, asOf: TRAFFIC_NOON,
  positions: [boardStand('A05')], unassigned: [], canAssign: true });

// The console's four adapters, each request recorded under the plan's key.
const consoleServices = record => ({
  getPlanningSnapshot: ({ stationId }) => { record('planning'); return answerLater(planningSnapshot(stationId)); },
  getAssignmentReadiness: ({ stationId, date }) => {
    record('readiness');
    return answerLater({ stationId, date, assignments: [] });
  },
  loadOccPositions: (stationId, date) => { record('positions'); return answerLater(positionsBoard(stationId, date)); },
  loadOccReviewQueue: stationId => { record('reviewQueue'); return answerLater(reviewQueue(stationId)); },
  clock: { now: () => Date.now() },
});

// The frame's notices, read as OccShellProvider reads them: one useOccResource on `notifications` at the plan's pace.
function FrameNotices({ record }) {
  const load = useCallback(() => {
    record('notices');
    return answerLater({ notifications: [], hasMore: false });
  }, [record]);
  useOccResource({ key: 'notices', load, permission: 'operations.notifications.read', resources: NOTICES.resources,
    pollMs: NOTICES.pollMs, coalesceMs: NOTICES.coalesceMs, scopeKey: OCC_TEST_ACCOUNT_ID });
  return null;
}

/**
 * The account-change feed and the two hubs as the API sends them: each announcement is a change on the feed and a
 * `ChangedV1` hint on its hub (notifications on the notifications hub, the rest on the operations hub); a cursor read
 * (recorded as `shell:cursor`) answers after the latency with the changes after its cursor.
 */
function startObserver(record, deliver) {
  const changes = [];
  const hubs = [];
  const api = {
    getAccountChanges: ({ after } = {}) => {
      record('shell:cursor');
      const from = after ? Number(after) : 0;
      const page = changes.slice(from);
      return answerLater({ changes: page, nextCursor: String(changes.length), hasMore: false });
    },
  };
  const createHubConnection = path => {
    const hub = { path, state: 'Connected', handlers: {}, start: async () => {}, stop: async () => {},
      on: (name, handler) => { hub.handlers[name] = handler; }, onreconnected: () => {}, onclose: () => {} };
    hubs.push(hub);
    return hub;
  };
  const observer = createAccountChangeObserver({ api, createHubConnection, onChanges: deliver, events: window,
    pollMs: OCC_REQUEST_PLAN.observer.pollMs, hintCoalesceMs: OCC_REQUEST_PLAN.observer.hintCoalesceMs });
  void observer.start();
  return resource => {
    changes.push({ resource, cursor: String(changes.length + 1) });
    const hub = hubs.find(item => item.path === (resource === 'notifications' ? '/hubs/notifications' : '/hubs/operations'));
    hub.handlers.ChangedV1({ eventId: String(changes.length) });
  };
}

/**
 * Mounts the console's reads and replays `script` (announcements at their second of the counted minute). Returns the
 * requests of the counted minute by key: the console's, the map's (from the simulated adapter's log), the frame's
 * notices, the observer's cursor reads (one when it mounts, its 25 s poll and those its hints ask for) and the presence
 * lease.
 */
async function replay(script) {
  const start = Date.now();
  const requests = [];
  const record = key => requests.push({ key, at: Date.now() - start });
  const shell = createOccShellValue();
  const adapter = createSimulatedOccMapAdapter({ scenario: createTrafficScenario(), latencyMs: READ_LATENCY_MS });
  const services = consoleServices(record);
  // Panorama's regional weather (lane M7) on its own polls of five and ten minutes.
  const weather = createSimulatedRegionWeatherAdapter({ scenario: createRegionWeatherScenario(),
    latencyMs: READ_LATENCY_MS });
  const wrapper = ({ children }) => (
    <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
      <OccShellTestProvider value={shell}>
        <FrameNotices record={record} />
        {children}
      </OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  renderHook(() => {
    useConsoleData({ accountId: OCC_TEST_ACCOUNT_ID, stationId: TRAFFIC_STATION_ID, stationCode: 'PUJ', services });
    useMapSituation({ stationId: TRAFFIC_STATION_ID, service: adapter });
    useRegionWeather({ adapter: weather, stationId: TRAFFIC_STATION_ID });
  }, { wrapper });

  const hint = startObserver(record, resources => shell.announce(resources));
  record('presence');
  setInterval(() => record('presence'), PRESENCE.pollMs);

  let elapsed = 0;
  for (const { at, resource } of script) {
    const due = WARM_UP_MS + at * 1_000;
    await flush(due - elapsed);
    elapsed = due;
    act(() => hint(resource));
  }
  await flush(WARM_UP_MS + MINUTE_MS - 1 - elapsed);

  const inMinute = at => at >= WARM_UP_MS && at < WARM_UP_MS + MINUTE_MS;
  const counted = [
    ...requests.filter(request => inMinute(request.at)).map(request => request.key),
    ...adapter.calls.filter(call => inMinute(call.at - start)).map(call => call.read),
    ...weather.calls.filter(call => inMinute(call.at - start)).map(call => `weather:${call.read}`),
  ];
  const byKey = {};
  for (const key of counted) byKey[key] = (byKey[key] ?? 0) + 1;
  // The regional weather reads made since the mount, all four once when it mounts (lane M7).
  const weatherReads = weather.calls.map(call => call.read);
  return { total: counted.length, byKey, subscriptions: shell.subscriptions(), weatherReads };
}

const breakdown = result => `${result.total} requests: ${JSON.stringify(result.byKey)}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse(TRAFFIC_NOON));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('the console within the OCC request budget (contratos 2.7)', () => {
  it('a console minute at rest stays within 40 requests', async () => {
    const rest = await replay([]);
    expect(rest.total, breakdown(rest)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.rest);
    // Two cursor polls, the air picture every 10 s, every 60 s read once, the presence lease twice: the plan's minute.
    expect(rest.byKey).toEqual({ 'shell:cursor': 2, airPicture: 6, mapFlights: 1, planning: 1, positions: 1,
      reviewQueue: 1, readiness: 1, notices: 1, presence: 2 });
    // The regional weather (lane M7) read once each when Panorama opened, and not again within the counted minute (the
    // worst case: Panorama leaves out the wind grid while it is not drawn, 2026-11-28).
    expect(rest.weatherReads.sort()).toEqual(['radar', 'region', 'sigmets', 'wind']);
    // Who listens to what: the flights to occ_planning, the queue to occ_review, the frame's notices to notifications.
    expect(rest.subscriptions).toEqual(['notifications', 'occ_planning', 'occ_review']);
  });

  it('a demo minute stays within 40 and the secondary reads never follow occ_planning', async () => {
    const rest = await replay([]);
    cleanup();
    vi.clearAllTimers();
    const demo = await replay(OCC_DEMO_MINUTE);
    expect(demo.total, breakdown(demo)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.demo);
    // The seventeen occ_planning announcements re-read only the map flights, after the observer's cursor reads (one every
    // 10 s at most for the hints); the queue follows occ_review and the frame's notices follow notifications.
    const hintWindows = Math.ceil(MINUTE_MS / OCC_REQUEST_PLAN.observer.hintCoalesceMs);
    expect(demo.byKey.mapFlights, breakdown(demo)).toBeLessThanOrEqual(rest.byKey.mapFlights + hintWindows + 2);
    expect(demo.byKey.mapFlights, breakdown(demo)).toBeGreaterThan(rest.byKey.mapFlights);
    // (the queue's re-read on occ_review also moves its 60 s safety poll past the counted minute).
    expect(demo.byKey.reviewQueue, breakdown(demo)).toBeGreaterThanOrEqual(rest.byKey.reviewQueue);
    expect(demo.byKey.reviewQueue, breakdown(demo)).toBeLessThanOrEqual(rest.byKey.reviewQueue + 1);
    expect(demo.byKey.notices).toBe(rest.byKey.notices + 2);
    for (const key of ['planning', 'positions', 'readiness', 'airPicture']) {
      expect(demo.byKey[key], `${key}: ${breakdown(demo)}`).toBe(rest.byKey[key]);
    }
    // Twenty hints, far fewer cursor reads.
    expect(demo.byKey['shell:cursor']).toBeLessThanOrEqual(rest.byKey['shell:cursor'] + hintWindows + 1);

    // A burst of tablet taps changes none of the console's own reads either.
    cleanup();
    vi.clearAllTimers();
    const taps = await replay(Array.from({ length: 20 }, (_, index) => ({ at: 10 + index * 0.5, resource: 'occ_planning' })));
    for (const key of ['planning', 'positions', 'readiness', 'reviewQueue']) {
      expect(taps.byKey[key], `${key}: ${breakdown(taps)}`).toBe(rest.byKey[key]);
    }
    expect(taps.total, breakdown(taps)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.demo);
  });
});
