import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { OCC_SAFETY_POLL_MS } from '../../admin-occ/live/occCadence';
import {
  createOccShellValue, OCC_TEST_ACCOUNT_ID, OccShellTestProvider,
} from '../../admin-occ/shell/testing/occShellFixtures';
import { boardStand, boardVisit } from '../../maps/testing/mapFixtures';
import { useConsoleData } from './useConsoleData';

// The console's reads against counted stand-ins of the four adapters (synthetic answers in the shape of the API) and a
// shell stub: no request leaves the test.

const STATION_ID = '20000000-0000-7000-8000-000000000003';
const OTHER_STATION_ID = '20000000-0000-7000-8000-000000000004';
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
// 22:30 of the 13th in Punta Cana: the UTC day (and a device clock a few hours ahead) already says the 14th.
const SERVER_NOW = Date.parse('2026-11-14T02:30:00Z');
const DEVICE_NOW = Date.parse('2026-11-14T05:00:00Z');
const refused = status => Object.assign(new Error('refused'), { status });

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function planningSnapshot(stationId, date = '2026-11-13', code = 'PUJ') {
  return {
    station: { id: stationId, code, name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
    date,
    turnarounds: [{
      id: '91000000-0000-4000-8000-000000000001', operationCode: 'ZZ161-1113', operationDate: date, status: 'Confirmed',
      airline: { id: 'airline-1', iataCode: 'ZZ', icaoCode: 'ZZZ', name: 'Zeta Air de prueba' }, aircraft: null,
      stand: { id: 'stand-a5', code: 'A05', terminal: { id: 'terminal-a', code: 'A', name: 'Terminal A' } },
      arrival: { id: 'leg-1', flightNumber: 'ZZ161', origin: { id: 'mia', iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami' },
        destination: { id: 'puj', iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana' },
        scheduledAt: '2026-11-14T02:45:00Z', estimatedAt: null, actualAt: null },
      departure: null, operation: null, agents: [], equipment: [], services: [],
    }],
  };
}

function positionsBoard(stationId, date) {
  return {
    stationId, stationCode: 'PUJ', operationDate: date, asOf: new Date(SERVER_NOW).toISOString(),
    positions: [boardStand('A05', { coveredBy: ['Marta Castillo'],
      turnarounds: [boardVisit({ nowMs: SERVER_NOW, flight: 'ZZ161', arrivalInMin: 15 })] })],
    unassigned: [], canAssign: true,
  };
}

function reviewQueue(stationId) {
  return { stationId, stationCode: 'PUJ', stationName: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo',
    operations: [{ operationId: 'op-1', submissionId: 'sub-1', revisionNumber: 1, status: 'PendingReview',
      operationCode: 'ZZ100-1113', operationDate: '2026-11-13', airlineName: 'Zeta Air de prueba', agentName: 'Agente',
      submittedAt: '2026-11-14T01:00:00Z', serviceCount: 2, incidentCount: 0 }],
    hasMore: false };
}

function createServices(overrides = {}) {
  return {
    getPlanningSnapshot: vi.fn(async ({ stationId }) => planningSnapshot(stationId)),
    getAssignmentReadiness: vi.fn(async ({ stationId, date }) => ({ stationId, date, assignments: [] })),
    loadOccPositions: vi.fn(async (stationId, date) => positionsBoard(stationId, date)),
    loadOccReviewQueue: vi.fn(async stationId => reviewQueue(stationId)),
    // The server's time, as the map reads and the ping set it: not the device's.
    clock: { now: () => SERVER_NOW },
    ...overrides,
  };
}

const notice = (id, stationCode, overrides = {}) => ({ id, operationId: `op-${id}`, operationCode: `OP-${id}`,
  stationCode, kind: 'incident_reported', sourceId: `source-${id}`, occurredAt: '2026-11-14T02:20:00Z', readAt: null,
  ...overrides });

function setup(props = {}, { shell = createOccShellValue(), services = createServices() } = {}) {
  const wrapper = ({ children }) => (
    <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
      <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  const hook = renderHook(current => useConsoleData(current), { wrapper,
    initialProps: { accountId: OCC_TEST_ACCOUNT_ID, stationId: STATION_ID, stationCode: 'PUJ', services, ...props } });
  return { ...hook, shell, services };
}

const statuses = data => Object.fromEntries(Object.entries(data).map(([name, view]) => [name, view.status]));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(DEVICE_NOW);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useConsoleData', () => {
  it('reads the station day without sending a browser date', async () => {
    const { result, services } = setup();
    await flush();
    // The planning snapshot: no date at all, the server decides the station's day.
    expect(services.getPlanningSnapshot).toHaveBeenCalledOnce();
    const [planningArgs] = services.getPlanningSnapshot.mock.calls[0];
    expect(Object.keys(planningArgs).sort()).toEqual(['signal', 'stationId']);
    expect(planningArgs.stationId).toBe(STATION_ID);
    // The positions board: the station's day on the server's clock (the 13th), not the UTC or the device's (the 14th).
    expect(services.loadOccPositions).toHaveBeenCalledWith(STATION_ID, '2026-11-13', expect.objectContaining({
      signal: expect.any(AbortSignal) }));
    // The readiness marks: the day the planning answered.
    expect(services.getAssignmentReadiness).toHaveBeenCalledWith(expect.objectContaining({ stationId: STATION_ID,
      date: '2026-11-13' }));
    expect(services.loadOccReviewQueue).toHaveBeenCalledWith(STATION_ID, expect.objectContaining({
      signal: expect.any(AbortSignal) }));

    expect(statuses(result.current)).toEqual({ planning: 'success', positions: 'success', reviewQueue: 'success',
      readiness: 'success', notices: 'empty' });
    // Each bay's own model: the planning's raw and mapped turnarounds, the board with its stands.
    expect(result.current.planning.data).toMatchObject({ date: '2026-11-13', station: { code: 'PUJ' } });
    expect(result.current.planning.data.turnarounds[0].operationCode).toBe('ZZ161-1113');
    expect(result.current.planning.data.flights[0]).toMatchObject({ turnaroundId: '91000000-0000-4000-8000-000000000001',
      flightNumber: 'ZZ161', position: 'A05', hasAssignmentGap: true });
    expect(result.current.positions.data.board.operationDate).toBe('2026-11-13');
    expect(result.current.positions.data.stands.find(stand => stand.id === 'A5')).toMatchObject({
      status: 'planned', coveredBy: ['Marta Castillo'] });
    expect(result.current.reviewQueue.data.operations).toHaveLength(1);
  });

  it('never reads without the PUJ scope', async () => {
    const services = createServices();
    const view = setup({ stationCode: 'SDQ', stationId: OTHER_STATION_ID }, { services });
    await flush(2 * OCC_SAFETY_POLL_MS);
    for (const props of [{ stationCode: 'PUJ', stationId: '' }, { stationCode: 'PUJ', accountId: '' },
      { stationCode: undefined }]) {
      view.rerender({ accountId: OCC_TEST_ACCOUNT_ID, stationId: STATION_ID, stationCode: 'PUJ', services, ...props });
      await flush(OCC_SAFETY_POLL_MS);
      expect(statuses(view.result.current), JSON.stringify(props)).toEqual({ planning: 'idle', positions: 'idle',
        reviewQueue: 'idle', readiness: 'idle', notices: 'idle' });
    }
    for (const read of ['getPlanningSnapshot', 'getAssignmentReadiness', 'loadOccPositions', 'loadOccReviewQueue']) {
      expect(services[read], read).not.toHaveBeenCalled();
    }
    cleanup();

    // An answer for another station is never shown: that bay fails as a whole, the others are unaffected.
    const foreign = createServices({
      getPlanningSnapshot: vi.fn(async () => planningSnapshot(OTHER_STATION_ID)),
      loadOccReviewQueue: vi.fn(async () => ({ ...reviewQueue(STATION_ID), stationCode: 'SDQ' })),
    });
    const { result } = setup({}, { services: foreign });
    await flush();
    expect(result.current.planning).toMatchObject({ status: 'error', data: null });
    expect(result.current.reviewQueue).toMatchObject({ status: 'error', data: null });
    expect(result.current.positions.status).toBe('success');
    // Without the planning's day, the readiness marks are not read.
    expect(result.current.readiness.status).toBe('idle');
    expect(foreign.getAssignmentReadiness).not.toHaveBeenCalled();
  });

  it('a 403 on positions leaves the other bays reading', async () => {
    const services = createServices({ loadOccPositions: vi.fn().mockRejectedValue(refused(403)) });
    const { result } = setup({}, { services });
    await flush();
    expect(statuses(result.current)).toEqual({ planning: 'success', positions: 'forbidden', reviewQueue: 'success',
      readiness: 'success', notices: 'empty' });
    expect(result.current.positions.data).toBeNull();

    // A minute later every other bay reads again on its own poll; the refused one stops asking.
    await flush(OCC_SAFETY_POLL_MS);
    expect(services.getPlanningSnapshot).toHaveBeenCalledTimes(2);
    expect(services.loadOccReviewQueue).toHaveBeenCalledTimes(2);
    expect(services.getAssignmentReadiness).toHaveBeenCalledTimes(2);
    expect(services.loadOccPositions).toHaveBeenCalledOnce();
    expect(result.current.positions.status).toBe('forbidden');

    // A 401 on the review queue says so on its bay alone.
    cleanup();
    const expired = createServices({ loadOccReviewQueue: vi.fn().mockRejectedValue(refused(401)) });
    const second = setup({}, { services: expired });
    await flush();
    expect(statuses(second.result.current)).toMatchObject({ planning: 'success', positions: 'success',
      reviewQueue: 'unauthorized' });
  });

  it('keeps the last data when a refresh fails', async () => {
    const getPlanningSnapshot = vi.fn()
      .mockImplementationOnce(async ({ stationId }) => planningSnapshot(stationId))
      .mockRejectedValueOnce(Object.assign(new Error('No fue posible cargar la planificación operativa.'), { status: 503 }));
    const { result } = setup({}, { services: createServices({ getPlanningSnapshot }) });
    await flush();
    const first = result.current.planning;
    expect(first).toMatchObject({ status: 'success', refreshFailed: false });
    expect(first.fetchedAt).toEqual(expect.any(String));

    await flush(OCC_SAFETY_POLL_MS);
    expect(getPlanningSnapshot).toHaveBeenCalledTimes(2);
    // The turnarounds stay on screen, marked as the last good read, with its time.
    expect(result.current.planning).toMatchObject({ status: 'success', refreshFailed: true, fetchedAt: first.fetchedAt });
    expect(result.current.planning.data).toBe(first.data);
    // The readiness marks keep the planning's day and go on reading.
    expect(result.current.readiness.status).toBe('success');
  });

  it('readiness waits for the planning date', async () => {
    const answers = [deferred(), deferred(), deferred()];
    let call = 0;
    const getPlanningSnapshot = vi.fn(() => answers[call++].promise);
    const services = createServices({ getPlanningSnapshot });
    const { result } = setup({}, { services });
    await flush();
    // The planning is on its way: the readiness marks have no day yet.
    expect(result.current.readiness.status).toBe('idle');
    expect(services.getAssignmentReadiness).not.toHaveBeenCalled();

    await act(async () => { answers[0].resolve(planningSnapshot(STATION_ID, '2026-11-13')); });
    await flush();
    expect(services.getAssignmentReadiness).toHaveBeenCalledOnce();
    expect(services.getAssignmentReadiness.mock.calls[0][0]).toMatchObject({ date: '2026-11-13' });
    expect(result.current.readiness.data).toEqual({ stationId: STATION_ID, date: '2026-11-13', assignments: [] });

    // The next day the planning answers another date: the marks of that day are read at once, and the old ones dropped
    // (the marks of the 13th were also read again on their own poll in that minute).
    await flush(OCC_SAFETY_POLL_MS);
    await act(async () => { answers[1].resolve(planningSnapshot(STATION_ID, '2026-11-14')); });
    await flush();
    expect(services.getAssignmentReadiness.mock.calls.map(([args]) => args.date))
      .toEqual(['2026-11-13', '2026-11-13', '2026-11-14']);
    expect(result.current.readiness.data.date).toBe('2026-11-14');

    // A refused planning takes its day away: the marks stop with it.
    await flush(OCC_SAFETY_POLL_MS);
    await act(async () => { answers[2].reject(refused(403)); });
    await flush();
    expect(result.current.planning.status).toBe('forbidden');
    expect(result.current.readiness).toMatchObject({ status: 'idle', data: null });
  });

  it('notices come from the shell, filtered to the station, with no request', async () => {
    const markRead = vi.fn(async id => ({ id }));
    const refresh = vi.fn();
    const items = [notice('1', 'PUJ'), notice('2', 'SDQ'), notice('3', 'PUJ', { readAt: '2026-11-14T02:25:00Z' })];
    const shell = createOccShellValue({ notices: { status: 'success', items, fetchedAt: '2026-11-14T02:29:00Z',
      markRead, refresh } });
    const services = createServices();
    const { result } = setup({}, { shell, services });
    await flush();
    const { notices } = result.current;
    expect(notices).toMatchObject({ status: 'success', refreshFailed: false, fetchedAt: '2026-11-14T02:29:00Z' });
    // The station's notices, read or not; another station's never.
    expect(notices.data.map(item => item.id)).toEqual(['1', '3']);
    // «Recibido» is the shell's read receipt.
    await act(async () => { await notices.markRead('1'); });
    expect(markRead).toHaveBeenCalledWith('1');
    // The console asked nothing of its own: each adapter once, for its own read; the shell's notices were not re-read.
    for (const read of ['getPlanningSnapshot', 'getAssignmentReadiness', 'loadOccPositions', 'loadOccReviewQueue']) {
      expect(services[read], read).toHaveBeenCalledOnce();
    }
    expect(refresh).not.toHaveBeenCalled();
    cleanup();

    // Only another station's notices: empty. Still loading: no list yet. Refused: the shell's state.
    for (const [value, status, data] of [
      [{ status: 'success', items: [notice('2', 'SDQ')] }, 'empty', []],
      [{ status: 'loading', items: [] }, 'loading', null],
      [{ status: 'forbidden', items: [] }, 'forbidden', null],
    ]) {
      const view = setup({}, { shell: createOccShellValue({ notices: value }) });
      expect(view.result.current.notices, status).toMatchObject({ status, data });
      cleanup();
    }
  });
});
