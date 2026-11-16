import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), observer: vi.fn() }));
vi.mock('../../../services/attendanceDraftService', () => ({
  readAttendanceDraft: mocks.read, saveOccAttendanceDraft: mocks.save,
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: mocks.observer,
}));

import { useAttendanceDraft } from './useAttendanceDraft';

const operationId = '70000000-0000-7000-8000-000000000005';
const assignmentId = '70000000-0000-7000-8000-000000000006';
const snapshot = {
  operationId, assignmentId, stationId: '20000000-0000-7000-8000-000000000003',
  occ: null, rampAgent: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(snapshot);
  mocks.save.mockResolvedValue({ contribution: { revision: 1, incidentNote: 'Observado' }, replayed: false });
  mocks.observer.mockImplementation(callback => ({
    start: async () => {}, stop: async () => {}, callback,
  }));
});
afterEach(() => vi.useRealTimers());

describe('useAttendanceDraft', () => {
  it('re-reads canonical data when the durable attendance hint arrives', async () => {
    const view = renderHook(() => useAttendanceDraft({ operationId, assignmentId, enabled: true }));
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    expect(mocks.read).toHaveBeenCalledOnce();

    await act(async () => {
      mocks.observer.mock.results[0].value.callback(['attendance_draft']);
    });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    view.unmount();
  });

  it('stops observing and cancels reading when the panel unmounts', async () => {
    const stop = vi.fn();
    mocks.observer.mockImplementation(() => ({ start: async () => {}, stop }));
    const view = renderHook(() => useAttendanceDraft({ operationId, assignmentId, enabled: true }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    const signal = mocks.read.mock.calls[0][2].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('drops the former session snapshot after a cancelled refresh', async () => {
    mocks.read.mockResolvedValueOnce({ ...snapshot,
      occ: { revision: 1, incidentNote: 'Dato anterior' } })
      .mockRejectedValueOnce({ code: 'cancelled', recoverable: false });
    const view = renderHook(() => useAttendanceDraft({ operationId, assignmentId, enabled: true }));
    await waitFor(() => expect(view.result.current.snapshot?.occ?.incidentNote).toBe('Dato anterior'));
    await act(async () => { await view.result.current.reload(); });
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.snapshot).toBeNull();
    await act(async () => { await view.result.current.save({ incidentNote: 'No reenviar' }); });
    expect(mocks.save).not.toHaveBeenCalled();
    view.unmount();
  });
});
