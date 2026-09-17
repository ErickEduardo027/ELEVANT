import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlanningOptions } from './usePlanningOptions';
import * as planningService from '../../services/planningService';

const firstTurnaroundId = '91000000-0000-0000-0000-000000000002';
const secondTurnaroundId = '91000000-0000-0000-0000-000000000003';
const planningOptions = {
  turnaround: {
    id: firstTurnaroundId,
    operationCode: 'DEV-TAT-0002',
    operationDate: '2026-08-19',
  },
  contract: { id: 'contract-1' },
  services: [{ id: 'service-1', code: 'BAGGAGE' }],
  agents: [{ id: 'agent-1', eligible: true }],
};
const optionsMetadata = { options: planningOptions, etag: '"planning-options-v1"' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePlanningOptions', () => {
  it('stays idle and does not fetch until a turnaround is selected', () => {
    const serviceSpy = vi.spyOn(planningService, 'getPlanningOptions');

    const { result } = renderHook(() => usePlanningOptions());

    expect(result.current).toEqual({
      status: 'idle',
      data: null,
      etag: null,
      error: null,
      reason: null,
      recoverable: false,
    });
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('stays idle when explicitly disabled even if a turnaround is selected', () => {
    const serviceSpy = vi.spyOn(planningService, 'getPlanningOptions');

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId, enabled: false })
    );

    expect(result.current.status).toBe('idle');
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('loads options lazily for the selected turnaround and preserves the AbortSignal', async () => {
    const serviceSpy = vi
      .spyOn(planningService, 'getPlanningOptions')
      .mockResolvedValue(optionsMetadata);

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId })
    );

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(serviceSpy).toHaveBeenCalledTimes(1);
    expect(serviceSpy.mock.calls[0][0]).toBe(firstTurnaroundId);
    expect(serviceSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data).toBe(planningOptions);
    expect(result.current.etag).toBe('"planning-options-v1"');
    expect(result.current.error).toBeNull();
  });

  it('returns empty when neither contracted services nor agents are available', async () => {
    const emptyOptions = { ...planningOptions, contract: null, services: [], agents: [] };
    vi.spyOn(planningService, 'getPlanningOptions').mockResolvedValue({
      options: emptyOptions,
      etag: '"empty-options-v1"',
    });

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId })
    );

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.data).toBe(emptyOptions);
    expect(result.current.etag).toBe('"empty-options-v1"');
    expect(result.current.error).toBeNull();
  });

  it('exposes a dedicated unauthorized state with a sanitized message', async () => {
    const serviceError = Object.assign(new Error('private authorization details'), {
      status: 401,
      code: 'unauthorized',
    });
    vi.spyOn(planningService, 'getPlanningOptions').mockRejectedValue(serviceError);

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId })
    );

    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    expect(result.current).toMatchObject({
      data: null,
      etag: null,
      reason: 'unauthorized',
      recoverable: false,
    });
    expect(result.current.error).toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'La sesión expiró. Inicia sesión nuevamente.',
    });
    expect(result.current.error.message).not.toContain('private authorization details');
  });

  it('exposes a non-recoverable forbidden state with a sanitized message', async () => {
    const serviceError = Object.assign(new Error('private policy details'), {
      status: 403,
      code: 'forbidden',
    });
    vi.spyOn(planningService, 'getPlanningOptions').mockRejectedValue(serviceError);

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId })
    );

    await waitFor(() => expect(result.current.status).toBe('forbidden'));
    expect(result.current).toMatchObject({
      data: null,
      etag: null,
      reason: 'forbidden',
      recoverable: false,
    });
    expect(result.current.error).toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Su cuenta no tiene permiso para consultar estas opciones.',
    });
    expect(result.current.error.message).not.toContain('private policy details');
  });

  it('classifies HTTP 409 as a recoverable contractual ambiguity', async () => {
    const serviceError = Object.assign(new Error('overlapping internal contract data'), {
      status: 409,
      code: 'options-conflict',
    });
    vi.spyOn(planningService, 'getPlanningOptions').mockRejectedValue(serviceError);

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId })
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({
      data: null,
      etag: null,
      reason: 'options-conflict',
      recoverable: true,
    });
    expect(result.current.error).toMatchObject({
      status: 409,
      code: 'options-conflict',
      recoverable: true,
      message: 'No fue posible preparar una versión asignable de esta operación. Actualice la planificación y revise su estado.',
    });
    expect(result.current.error.message).not.toContain('internal contract');
  });

  it('exposes a generic recoverable error for network and unexpected failures', async () => {
    vi.spyOn(planningService, 'getPlanningOptions').mockRejectedValue(
      new Error('socket and private host details')
    );

    const { result } = renderHook(() =>
      usePlanningOptions({ turnaroundId: firstTurnaroundId })
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({
      data: null,
      etag: null,
      reason: 'request-failed',
      recoverable: true,
    });
    expect(result.current.error.message).toBe(
      'No fue posible cargar las opciones de planificación.'
    );
    expect(result.current.error.message).not.toContain('private host');
  });

  it('aborts superseded option requests and keeps the latest result', async () => {
    let firstSignal;
    vi.spyOn(planningService, 'getPlanningOptions').mockImplementation(
      (turnaroundId, { signal }) => {
        if (turnaroundId === firstTurnaroundId) {
          firstSignal = signal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }
        return Promise.resolve({
          options: {
            ...planningOptions,
            turnaround: { ...planningOptions.turnaround, id: secondTurnaroundId },
          },
          etag: '"planning-options-v2"',
        });
      }
    );

    const { result, rerender } = renderHook(
      ({ turnaroundId }) => usePlanningOptions({ turnaroundId }),
      { initialProps: { turnaroundId: firstTurnaroundId } }
    );

    await waitFor(() => expect(firstSignal).toBeInstanceOf(AbortSignal));
    rerender({ turnaroundId: secondTurnaroundId });

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data.turnaround.id).toBe(secondTurnaroundId);
    expect(result.current.etag).toBe('"planning-options-v2"');
  });
});
