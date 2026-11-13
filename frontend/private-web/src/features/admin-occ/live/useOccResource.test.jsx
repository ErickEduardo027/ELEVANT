import { act, cleanup, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { administratorAccess, DepartmentAccessProvider, useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { createOccShellValue, OccShellTestProvider } from '../shell/testing/occShellFixtures';
import { OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from './occCadence';
import { useOccResource } from './useOccResource';

const PERMISSION = 'operations.planning.read';
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const WITHOUT_PERMISSION = { ...ACCESS, kind: 'Member', canManageDepartmentUsers: false,
  permissions: ACCESS.permissions.filter(code => code !== PERMISSION) };
const START = Date.parse('2026-11-12T14:00:00Z');
const refused = status => Object.assign(new Error('refused'), { status });

let accessContext;
function CaptureAccess() {
  const value = useDepartmentAccess();
  useEffect(() => { accessContext = value; });
  return null;
}

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

// Moves the fake clock and lets every answer and render that falls due settle.
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

// `statuses` lists every status the hook committed, in order.
function setup(props, { access = ACCESS, shell = createOccShellValue() } = {}) {
  const loadAccess = vi.fn().mockResolvedValue(access);
  const statuses = [];
  const wrapper = ({ children }) => (
    <DepartmentAccessProvider initialAccess={access} load={loadAccess} observe={false}>
      <OccShellTestProvider value={shell}><CaptureAccess />{children}</OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  const hook = renderHook(current => {
    const read = useOccResource(current);
    useEffect(() => { statuses.push(read.status); }, [read.status]);
    return read;
  }, { wrapper, initialProps: { key: 'planning', permission: PERMISSION, ...props } });
  return { ...hook, shell, loadAccess, statuses };
}

// A read that answers only when the test refuses it.
function refusable() {
  const pending = {};
  pending.load = () => new Promise((_, reject) => { pending.refuse = status => reject(refused(status)); });
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(START);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useOccResource', () => {
  it('issues no read without the permission and reports forbidden', async () => {
    const load = vi.fn().mockResolvedValue({ rows: [] });
    const { result, shell } = setup({ load, resources: ['occ_planning'], sourceId: 'providerFlights' },
      { access: WITHOUT_PERMISSION });
    await flush(3 * OCC_SAFETY_POLL_MS);
    act(() => shell.announce(['occ_planning']));
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ status: 'forbidden', data: null, refreshing: false });
    expect(shell.subscriptions()).toEqual([]);
    expect(shell.sourceStore.getSnapshot()).toEqual([expect.objectContaining({ id: 'providerFlights', state: 'forbidden' })]);

    // Disabled reads nothing either, and says so.
    const disabled = setup({ load, enabled: false });
    await flush(OCC_SAFETY_POLL_MS);
    expect(load).not.toHaveBeenCalled();
    expect(disabled.result.current.status).toBe('idle');
  });

  it('reads once on mount and keeps the data while refreshing', async () => {
    let answer;
    const load = vi.fn()
      .mockResolvedValueOnce({ rows: [1] })
      .mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const { result } = setup({ load, isEmpty: data => data.rows.length === 0 });
    expect(result.current.status).toBe('loading');
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [1] }, refreshing: false,
      refreshFailed: false, fetchedAt: '2026-11-12T14:00:00.000Z' });

    act(() => result.current.refresh());
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [1] }, refreshing: true });
    await act(async () => { answer({ rows: [] }); });
    // An empty answer is its own state, with the data it brought.
    expect(result.current).toMatchObject({ status: 'empty', data: { rows: [] }, refreshing: false });

    // A local change replaces the data in place, without a read.
    act(() => result.current.setData(data => ({ rows: [...data.rows, 2] })));
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [2] } });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('five announcements within a second cause one immediate read and one trailing read', async () => {
    const load = vi.fn().mockResolvedValue({ rows: [] });
    const { shell } = setup({ load, resources: ['occ_planning'] });
    await flush(10_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shell.subscriptions()).toEqual(['occ_planning']);

    for (const wait of [0, 200, 200, 200, 200]) {
      await flush(wait);
      act(() => shell.announce(['occ_planning']));
    }
    expect(load).toHaveBeenCalledTimes(2);
    await flush(3_000);
    expect(load).toHaveBeenCalledTimes(3);
    await flush(5_000);
    expect(load).toHaveBeenCalledTimes(3);

    // Other resources are not this read's business.
    act(() => shell.announce(['notifications', 'occ_review']));
    await flush(5_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('defers announcement reads while the tab is hidden', async () => {
    const load = vi.fn().mockResolvedValue({ rows: [] });
    const { shell } = setup({ load, resources: ['occ_planning'] });
    await flush(10_000);
    setVisibility('hidden');
    for (const wait of [0, 5_000, 5_000]) {
      await flush(wait);
      act(() => shell.announce(['occ_planning']));
    }
    await flush(20_000);
    expect(load).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    await flush(10_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('polls every 60 s as a safety net', async () => {
    const load = vi.fn().mockResolvedValue({ rows: [] });
    setup({ load });
    await flush(OCC_SAFETY_POLL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(load).toHaveBeenCalledTimes(2);
    await flush(OCC_SAFETY_POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);

    // A poll that falls due while the tab is hidden waits for it to show.
    setVisibility('hidden');
    await flush(2 * OCC_SAFETY_POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    setVisibility('visible');
    await flush();
    expect(load).toHaveBeenCalledTimes(4);

    // The pace can follow the data, as the air picture's refreshAfterSeconds will.
    const paced = vi.fn().mockResolvedValue({ refreshAfterSeconds: 10 });
    setup({ load: paced, pollMs: data => (data?.refreshAfterSeconds ?? 60) * 1_000 });
    await flush(30_000);
    expect(paced).toHaveBeenCalledTimes(4);
  });

  it('stops polling and ignores announcements after a 401 or 403 until access changes', async () => {
    for (const [status, state] of [[403, 'forbidden'], [401, 'unauthorized']]) {
      const load = vi.fn()
        .mockResolvedValueOnce({ rows: [1] })
        .mockRejectedValueOnce(refused(status))
        .mockResolvedValue({ rows: [2] });
      const { result, shell, unmount } = setup({ load, resources: ['occ_planning'] });
      await flush(10_000);
      act(() => shell.announce(['occ_planning']));
      await flush();
      expect(result.current, String(status)).toMatchObject({ status: state, data: null });

      await flush(5 * OCC_SAFETY_POLL_MS);
      act(() => shell.announce(['occ_planning']));
      act(() => result.current.invalidate());
      await flush(10_000);
      expect(load, String(status)).toHaveBeenCalledTimes(2);

      // A new access object, as the shell's refresh on department_users brings, resumes it.
      await act(async () => { await accessContext.refresh(); });
      await flush();
      expect(load, String(status)).toHaveBeenCalledTimes(3);
      expect(result.current, String(status)).toMatchObject({ status: 'success', data: { rows: [2] } });
      unmount();
    }
  });

  it('a 401 or 403 also drops the re-read an announcement left waiting on the refused read', async () => {
    for (const [status, state] of [[403, 'forbidden'], [401, 'unauthorized']]) {
      const pending = refusable();
      const load = vi.fn()
        .mockResolvedValueOnce({ rows: [1] })
        .mockImplementationOnce(pending.load)
        .mockResolvedValue({ rows: [2] });
      const { result, shell, statuses, unmount } = setup({ load, resources: ['occ_planning'] });
      await flush(10_000);
      // The first announcement reads at once; the second arrives during that read and waits for it.
      act(() => shell.announce(['occ_planning']));
      act(() => shell.announce(['occ_planning']));
      expect(load, String(status)).toHaveBeenCalledTimes(2);
      await act(async () => { pending.refuse(status); });
      expect(result.current, String(status)).toMatchObject({ status: state, data: null });

      await flush(10_000);
      expect(load, String(status)).toHaveBeenCalledTimes(2);
      // Once refused it stays refused, with no «loading» in between: the bar's alerts button would come and go.
      expect(statuses.slice(statuses.indexOf(state)), String(status)).toEqual([state]);
      unmount();
    }
  });

  it('a 401 or 403 in a hidden tab issues no read when the tab shows again', async () => {
    for (const [status, state] of [[403, 'forbidden'], [401, 'unauthorized']]) {
      const pending = refusable();
      const load = vi.fn()
        .mockResolvedValueOnce({ rows: [1] })
        .mockImplementationOnce(pending.load)
        .mockResolvedValue({ rows: [2] });
      const { result, shell, statuses, unmount } = setup({ load, resources: ['occ_planning'] });
      // The safety poll starts a read; the tab hides and an announcement waits for it to show.
      await flush(OCC_SAFETY_POLL_MS);
      expect(load, String(status)).toHaveBeenCalledTimes(2);
      setVisibility('hidden');
      act(() => shell.announce(['occ_planning']));
      await act(async () => { pending.refuse(status); });
      expect(result.current, String(status)).toMatchObject({ status: state, data: null });

      await flush(10_000);
      setVisibility('visible');
      await flush(10_000);
      expect(load, String(status)).toHaveBeenCalledTimes(2);
      expect(statuses.slice(statuses.indexOf(state)), String(status)).toEqual([state]);
      unmount();
    }
  });

  it('invalidate() re-reads as an announcement does, while refresh() reads at once', async () => {
    const load = vi.fn().mockResolvedValue({ rows: [] });
    const { result } = setup({ load });
    await flush(10_000);
    act(() => result.current.invalidate());
    await flush();
    expect(load).toHaveBeenCalledTimes(2);

    // Inside the 3 s window it waits for the window's end, and several become one read.
    act(() => result.current.invalidate());
    act(() => result.current.invalidate());
    await flush(2_999);
    expect(load).toHaveBeenCalledTimes(2);
    await flush(1);
    expect(load).toHaveBeenCalledTimes(3);
    act(() => result.current.refresh());
    await flush();
    expect(load).toHaveBeenCalledTimes(4);

    // In a hidden tab it waits for the tab to show.
    setVisibility('hidden');
    act(() => result.current.invalidate());
    await flush(10_000);
    expect(load).toHaveBeenCalledTimes(4);
    setVisibility('visible');
    await flush();
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('resumes after retry or a new access object', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(refused(404))
      .mockResolvedValue({ rows: [1] });
    const { result, loadAccess } = setup({ load });
    await flush();
    expect(result.current.status).toBe('forbidden');
    act(() => result.current.retry());
    await flush();
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [1] } });
    expect(load).toHaveBeenCalledTimes(2);

    // A new access object resumes only a refused read; a working one keeps its own pace.
    await act(async () => { await accessContext.refresh(); });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);

    // Losing the permission stops the read and hides the data; getting it back reads again.
    loadAccess.mockResolvedValueOnce(WITHOUT_PERMISSION);
    await act(async () => { await accessContext.refresh(); });
    expect(result.current).toMatchObject({ status: 'forbidden', data: null });
    await flush(2 * OCC_SAFETY_POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    loadAccess.mockResolvedValueOnce(ACCESS);
    await act(async () => { await accessContext.refresh(); });
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe('success');
  });

  it('keeps the data and flags refreshFailed on a failed refresh', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ rows: [1] })
      .mockRejectedValueOnce(Object.assign(new Error('Internal provider exception details'), { status: 500 }))
      .mockResolvedValueOnce({ rows: [2] });
    const { result } = setup({ load });
    await flush();
    act(() => result.current.refresh());
    await flush();
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [1] }, refreshing: false,
      refreshFailed: true, fetchedAt: '2026-11-12T14:00:00.000Z' });

    // The safety poll keeps trying, and a good answer clears the flag.
    await flush(OCC_SAFETY_POLL_MS);
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [2] }, refreshFailed: false });

    // A first read that fails has nothing to keep.
    const failing = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ rows: [3] });
    const first = setup({ load: failing });
    await flush();
    expect(first.result.current).toMatchObject({ status: 'error', data: null, refreshFailed: false });
    await flush(OCC_SAFETY_POLL_MS);
    expect(first.result.current).toMatchObject({ status: 'success', data: { rows: [3] } });
  });

  it('drops the data when the scope changes', async () => {
    // Answers that ignore the abort, so a late one can arrive after its scope ended.
    const answers = [];
    const load = vi.fn(() => new Promise(resolve => { answers.push(resolve); }));
    const { result, rerender } = setup({ load, scopeKey: 'station-a' });
    await act(async () => { answers[0]({ station: 'a' }); });
    expect(result.current).toMatchObject({ status: 'success', data: { station: 'a' } });
    act(() => result.current.refresh());
    expect(result.current).toMatchObject({ data: { station: 'a' }, refreshing: true });

    rerender({ key: 'planning', permission: PERMISSION, load, scopeKey: 'station-b' });
    expect(result.current).toMatchObject({ status: 'loading', data: null, refreshing: false });
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[1][0].signal.aborted).toBe(true);

    // The other scope's late answer is ignored; this scope's own answer is shown.
    await act(async () => { answers[1]({ station: 'a-late' }); });
    expect(result.current).toMatchObject({ status: 'loading', data: null });
    await act(async () => { answers[2]({ station: 'b' }); });
    expect(result.current).toMatchObject({ status: 'success', data: { station: 'b' } });
  });

  it('aborts the read in flight when it unmounts', async () => {
    const load = vi.fn(() => new Promise(() => {}));
    const { unmount } = setup({ load });
    await flush();
    const { signal } = load.mock.calls[0][0];
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('times out a read after 20 s', async () => {
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ rows: [1] })
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result } = setup({ load });
    await flush(OCC_READ_TIMEOUT_MS - 1);
    expect(result.current.status).toBe('loading');
    await flush(1);
    expect(result.current).toMatchObject({ status: 'timeout', data: null });
    expect(load.mock.calls[0][0].signal.aborted).toBe(true);

    // It is not left loading: the safety poll asks again.
    await flush(OCC_SAFETY_POLL_MS);
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [1] } });

    // A refresh that hangs keeps the data and says the refresh failed.
    act(() => result.current.refresh());
    await flush(OCC_READ_TIMEOUT_MS);
    expect(result.current).toMatchObject({ status: 'success', data: { rows: [1] }, refreshFailed: true });
  });

  it('reports its source health when given a sourceId', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ rows: [1] })
      .mockRejectedValueOnce(new Error('offline'));
    const { result, shell, unmount } = setup({ load, sourceId: 'providerFlights' });
    await flush();
    expect(shell.sourceStore.getSnapshot()).toEqual([
      { id: 'providerFlights', state: 'ok', at: START, detail: null, tags: [] },
    ]);
    act(() => result.current.refresh());
    await flush();
    expect(shell.sourceStore.getSnapshot()).toEqual([
      { id: 'providerFlights', state: 'delayed', at: START, detail: null, tags: [] },
    ]);
    unmount();
    expect(shell.sourceStore.getSnapshot()).toEqual([]);
  });
});
