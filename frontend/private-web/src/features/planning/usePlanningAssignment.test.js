import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlanningAssignment } from './usePlanningAssignment';
import * as planningService from '../../services/planningService';

const turnaroundId = '91000000-0000-0000-0000-000000000002';
const agentId = '30000000-0000-0000-0000-000000000001';
const etag = '"planning-options-v1"';
const assignmentMetadata = {
  assignment: { turnaroundId, operationStatus: 'Assigned' },
  etag: '"assigned-v2"',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('usePlanningAssignment', () => {
  it('starts idle and submits the exact command once', async () => {
    const serviceSpy = vi
      .spyOn(planningService, 'assignPlanningOperation')
      .mockResolvedValue(assignmentMetadata);
    const { result } = renderHook(() => usePlanningAssignment());

    expect(result.current).toMatchObject({
      status: 'idle',
      data: null,
      error: null,
      reason: null,
      refreshRequired: false,
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.assign({ turnaroundId, agentId, etag });
    });

    expect(serviceSpy).toHaveBeenCalledTimes(1);
    expect(serviceSpy.mock.calls[0][0]).toBe(turnaroundId);
    expect(serviceSpy.mock.calls[0][1]).toBe(agentId);
    expect(serviceSpy.mock.calls[0][2]).toBe(etag);
    expect(serviceSpy.mock.calls[0][3].signal).toBeInstanceOf(AbortSignal);
    expect(outcome).toEqual({ ok: true, data: assignmentMetadata });
    expect(result.current).toMatchObject({
      status: 'success',
      data: assignmentMetadata,
      error: null,
      refreshRequired: false,
    });
  });

  it('coalesces double submission into the same in-flight command', async () => {
    let resolveRequest;
    const request = new Promise(resolve => {
      resolveRequest = resolve;
    });
    const serviceSpy = vi
      .spyOn(planningService, 'assignPlanningOperation')
      .mockReturnValue(request);
    const { result } = renderHook(() => usePlanningAssignment());

    let first;
    let second;
    act(() => {
      first = result.current.assign({ turnaroundId, agentId, etag });
      second = result.current.assign({ turnaroundId, agentId, etag });
    });

    expect(first).toBe(second);
    expect(serviceSpy).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('submitting');

    await act(async () => {
      resolveRequest(assignmentMetadata);
      await first;
    });
    expect(result.current.status).toBe('success');
  });

  it('preserves safe failure classification and refresh guidance', async () => {
    const serviceError = Object.assign(new Error('safe stale message'), {
      status: 412,
      code: 'stale',
      refreshRequired: true,
    });
    vi.spyOn(planningService, 'assignPlanningOperation').mockRejectedValue(serviceError);
    const { result } = renderHook(() => usePlanningAssignment());

    let outcome;
    await act(async () => {
      outcome = await result.current.assign({ turnaroundId, agentId, etag });
    });

    expect(outcome).toEqual({
      ok: false,
      error: serviceError,
      reason: 'stale',
      refreshRequired: true,
    });
    expect(result.current).toMatchObject({
      status: 'error',
      data: null,
      error: serviceError,
      reason: 'stale',
      refreshRequired: true,
    });
  });

  it('does not abort a dispatched write on unmount and marks its eventual result detached', async () => {
    let observedSignal;
    let resolveRequest;
    vi.spyOn(planningService, 'assignPlanningOperation').mockImplementation(
      (_turnaroundId, _agentId, _etag, { signal }) => {
        observedSignal = signal;
        return new Promise(resolve => {
          resolveRequest = resolve;
        });
      }
    );
    const { result, unmount } = renderHook(() => usePlanningAssignment());

    let request;
    act(() => {
      request = result.current.assign({ turnaroundId, agentId, etag });
    });
    await waitFor(() => expect(observedSignal).toBeInstanceOf(AbortSignal));
    unmount();

    expect(observedSignal.aborted).toBe(false);
    resolveRequest(assignmentMetadata);
    await expect(request).resolves.toEqual({
      ok: true,
      data: assignmentMetadata,
      detached: true,
    });
  });

  it('does not reset or abort a dispatched write while its outcome is unknown', async () => {
    let resolveRequest;
    let observedSignal;
    vi.spyOn(planningService, 'assignPlanningOperation').mockImplementation(
      (_turnaroundId, _agentId, _etag, { signal }) => {
        observedSignal = signal;
        return new Promise(resolve => {
          resolveRequest = resolve;
        });
      }
    );
    const { result } = renderHook(() => usePlanningAssignment());

    let request;
    act(() => {
      request = result.current.assign({ turnaroundId, agentId, etag });
    });
    expect(result.current.status).toBe('submitting');

    let resetResult;
    act(() => {
      resetResult = result.current.reset();
    });
    expect(resetResult).toBe(false);
    expect(observedSignal.aborted).toBe(false);
    expect(result.current.status).toBe('submitting');

    await act(async () => {
      resolveRequest(assignmentMetadata);
      await request;
    });
    expect(result.current.status).toBe('success');

    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
  });

  it('times out a hanging request and requires reconciliation without retrying', async () => {
    vi.useFakeTimers();
    let observedSignal;
    const safeTimeoutError = Object.assign(
      new Error('No fue posible confirmar la asignación. La planificación se actualizará antes de volver a intentar.'),
      { code: 'unknown-outcome', refreshRequired: true }
    );
    const serviceSpy = vi
      .spyOn(planningService, 'assignPlanningOperation')
      .mockImplementation((_turnaroundId, _agentId, _etag, { signal }) => {
        observedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(safeTimeoutError));
        });
      });
    const { result } = renderHook(() => usePlanningAssignment());

    let request;
    act(() => {
      request = result.current.assign({ turnaroundId, agentId, etag });
    });
    expect(observedSignal.aborted).toBe(false);

    let outcome;
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      outcome = await request;
    });

    expect(observedSignal.aborted).toBe(true);
    expect(serviceSpy).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      ok: false,
      error: safeTimeoutError,
      reason: 'unknown-outcome',
      refreshRequired: true,
    });
    expect(result.current).toMatchObject({
      status: 'error',
      reason: 'unknown-outcome',
      refreshRequired: true,
    });
  });
});
