import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOccShellValue, OccShellTestProvider } from '../shell/testing/occShellFixtures';
import { OCC_COALESCE_MS, OCC_READ_TIMEOUT_MS, OCC_SAFETY_POLL_MS } from './occCadence';
import { createScreenRefresh, useOccScreenRefresh } from './useOccScreenRefresh';

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.parse('2026-11-24T14:00:00Z'));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.useRealTimers();
});

describe('createScreenRefresh', () => {
  it('coalesces announcements, joins a read in flight and polls after the last read', () => {
    const onRead = vi.fn();
    const engine = createScreenRefresh({ onRead, hidden: () => false });
    engine.start();
    // The mount's read is in flight: an announcement waits for it.
    engine.announce();
    expect(onRead).not.toHaveBeenCalled();
    engine.busy(true);
    engine.busy(false);
    vi.advanceTimersByTime(OCC_COALESCE_MS);
    expect(onRead).toHaveBeenCalledTimes(1);
    engine.busy(true);
    engine.busy(false);
    // A burst within the window: one trailing read.
    engine.announce();
    engine.announce();
    engine.announce();
    vi.advanceTimersByTime(OCC_COALESCE_MS);
    expect(onRead).toHaveBeenCalledTimes(2);
    engine.busy(true);
    engine.busy(false);
    // A refresh asked by the person reads at once.
    engine.refresh();
    expect(onRead).toHaveBeenCalledTimes(3);
    engine.busy(true);
    engine.busy(false);
    // The safety poll, from the last read.
    vi.advanceTimersByTime(OCC_SAFETY_POLL_MS);
    expect(onRead).toHaveBeenCalledTimes(4);
    engine.stop();
    engine.announce();
    vi.advanceTimersByTime(OCC_SAFETY_POLL_MS * 2);
    expect(onRead).toHaveBeenCalledTimes(4);
  });

  it('settles a read the screen never reports after the read timeout', () => {
    const onRead = vi.fn();
    const engine = createScreenRefresh({ onRead, hidden: () => false });
    engine.start();
    engine.announce();
    vi.advanceTimersByTime(OCC_READ_TIMEOUT_MS);
    expect(onRead).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});

describe('useOccScreenRefresh', () => {
  it('re-reads on the shell’s announcements of its resources, deferred while the tab is hidden', async () => {
    const shell = createOccShellValue();
    const wrapper = ({ children }) => <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>;
    const { result } = renderHook(() => useOccScreenRefresh({ resources: ['occ_planning'] }), { wrapper });
    expect(result.current.token).toBe(0);
    act(() => { result.current.busy(true); result.current.busy(false); });
    await flush(OCC_COALESCE_MS);

    act(() => shell.announce(['notifications']));
    expect(result.current.token).toBe(0);
    act(() => shell.announce(['occ_planning']));
    expect(result.current.token).toBe(1);
    act(() => { result.current.busy(true); result.current.busy(false); });

    setVisibility('hidden');
    await flush(OCC_COALESCE_MS);
    act(() => shell.announce(['occ_planning']));
    await flush(OCC_COALESCE_MS);
    expect(result.current.token).toBe(1);
    setVisibility('visible');
    expect(result.current.token).toBe(2);

    // «Reintentar» joins a read the screen reports as running, then reads once.
    act(() => result.current.busy(true));
    act(() => result.current.refresh());
    expect(result.current.token).toBe(2);
    act(() => result.current.busy(false));
    await flush(OCC_COALESCE_MS);
    expect(result.current.token).toBe(3);
  });

  it('outside the OCC frame keeps only its safety poll', async () => {
    const { result } = renderHook(() => useOccScreenRefresh({ resources: ['occ_planning'] }));
    act(() => { result.current.busy(true); result.current.busy(false); });
    await flush(OCC_SAFETY_POLL_MS);
    expect(result.current.token).toBe(1);
  });
});
