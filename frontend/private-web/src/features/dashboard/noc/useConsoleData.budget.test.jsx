import { act, cleanup, renderHook } from '@testing-library/react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedOccMapAdapter } from '../../../services/occMapService';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { OCC_DEMO_MINUTE, OCC_REQUEST_BUDGET, OCC_REQUEST_PLAN } from '../../admin-occ/live/occRequestPlan';
import { useOccResource } from '../../admin-occ/live/useOccResource';
import {
  createOccShellValue, OCC_TEST_ACCOUNT_ID, OccShellTestProvider,
} from '../../admin-occ/shell/testing/occShellFixtures';
import { boardStand } from '../../maps/testing/mapFixtures';
import { createTrafficScenario, TRAFFIC_NOON, TRAFFIC_STATION_ID } from '../../maps/testing/trafficFixtures';
import { useMapSituation } from '../../maps/useMapSituation';
import { useConsoleData } from './useConsoleData';

// The console within the OCC request budget (contratos 2.7), with the real hooks: useConsoleData over counted
// stand-ins of its four adapters, useMapSituation over the simulated map adapter, and the frame's own reads as the shell
// sends them (its notices on useOccResource with the plan's cadence, the one observer's cursor reads and the presence
// lease), on a test channel that delivers the scripted announcements of a demo minute (OCC_DEMO_MINUTE). Everything
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
 * Mounts the console's reads and replays `script` (announcements at their second of the counted minute). Returns the
 * requests of the counted minute by key: the console's, the map's (from the simulated adapter's log), the frame's
 * notices, the observer's cursor reads (one when it mounts, its 25 s poll and one per announcement) and the presence
 * lease.
 */
async function replay(script) {
  const start = Date.now();
  const requests = [];
  const record = key => requests.push({ key, at: Date.now() - start });
  const shell = createOccShellValue();
  const adapter = createSimulatedOccMapAdapter({ scenario: createTrafficScenario(), latencyMs: READ_LATENCY_MS });
  const services = consoleServices(record);
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
  }, { wrapper });

  const cursor = () => record('shell:cursor');
  cursor();
  setInterval(cursor, OCC_REQUEST_PLAN.observer.pollMs);
  record('presence');
  setInterval(() => record('presence'), PRESENCE.pollMs);

  let elapsed = 0;
  for (const { at, resource } of script) {
    const due = WARM_UP_MS + at * 1_000;
    await flush(due - elapsed);
    elapsed = due;
    act(() => {
      cursor();
      shell.announce([resource]);
    });
  }
  await flush(WARM_UP_MS + MINUTE_MS - 1 - elapsed);

  const inMinute = at => at >= WARM_UP_MS && at < WARM_UP_MS + MINUTE_MS;
  const counted = [
    ...requests.filter(request => inMinute(request.at)).map(request => request.key),
    ...adapter.calls.filter(call => inMinute(call.at - start)).map(call => call.read),
  ];
  const byKey = {};
  for (const key of counted) byKey[key] = (byKey[key] ?? 0) + 1;
  return { total: counted.length, byKey, subscriptions: shell.subscriptions() };
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
    // Who listens to what: the flights to occ_planning, the queue to occ_review, the frame's notices to notifications.
    expect(rest.subscriptions).toEqual(['notifications', 'occ_planning', 'occ_review']);
  });

  it('a demo minute stays within 70 and the secondary reads never follow occ_planning', async () => {
    const rest = await replay([]);
    cleanup();
    vi.clearAllTimers();
    const demo = await replay(OCC_DEMO_MINUTE);
    expect(demo.total, breakdown(demo)).toBeLessThanOrEqual(OCC_REQUEST_BUDGET.demo);
    // Eight occ_planning announcements re-read only the map flights, at most one every 3 s; the queue follows
    // occ_review and the frame's notices follow notifications.
    expect(demo.byKey.mapFlights).toBe(rest.byKey.mapFlights + 8);
    expect(demo.byKey.reviewQueue).toBe(rest.byKey.reviewQueue + 1);
    expect(demo.byKey.notices).toBe(rest.byKey.notices + 2);
    for (const key of ['planning', 'positions', 'readiness', 'airPicture']) {
      expect(demo.byKey[key], `${key}: ${breakdown(demo)}`).toBe(rest.byKey[key]);
    }
    expect(demo.byKey['shell:cursor']).toBe(rest.byKey['shell:cursor'] + OCC_DEMO_MINUTE.length);

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
