import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mapperMocks = vi.hoisted(() => ({
  mapOccPlanningSnapshot: vi.fn(),
}));

vi.mock('./planningMappers', () => ({
  mapOccPlanningSnapshot: mapperMocks.mapOccPlanningSnapshot,
}));

import { usePlanningData } from './usePlanningData';
import * as planningService from '../../services/planningService';

const stationId = '20000000-0000-0000-0000-000000000001';
const rawSnapshot = {
  station: { id: stationId, code: 'PUJ' },
  date: '2026-08-19',
  turnarounds: [{ id: '91000000-0000-0000-0000-000000000002' }],
};

beforeEach(() => {
  mapperMocks.mapOccPlanningSnapshot.mockImplementation(snapshot => ({
    station: snapshot.station,
    date: snapshot.date,
    flights: snapshot.turnarounds,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  mapperMocks.mapOccPlanningSnapshot.mockReset();
});

describe('usePlanningData', () => {
  it('stays idle and does not fetch while disabled', () => {
    const serviceSpy = vi.spyOn(planningService, 'getPlanningSnapshot');

    const { result } = renderHook(() =>
      usePlanningData({ stationId, enabled: false })
    );

    expect(result.current).toMatchObject({ status: 'idle', data: null, error: null, refreshing: false });
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('loads, maps, and exposes a successful planning snapshot', async () => {
    const serviceSpy = vi
      .spyOn(planningService, 'getPlanningSnapshot')
      .mockResolvedValue(rawSnapshot);

    const { result } = renderHook(() =>
      usePlanningData({ stationId, date: '2026-08-19' })
    );

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(serviceSpy).toHaveBeenCalledTimes(1);
    expect(serviceSpy.mock.calls[0][0]).toMatchObject({ stationId, date: '2026-08-19' });
    expect(serviceSpy.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(mapperMocks.mapOccPlanningSnapshot).toHaveBeenCalledWith(rawSnapshot);
    expect(result.current.data).toEqual({
      station: rawSnapshot.station,
      date: rawSnapshot.date,
      flights: rawSnapshot.turnarounds,
    });
    expect(result.current.error).toBeNull();
  });

  it('omits an undefined date and re-fetches when refreshToken changes', async () => {
    const serviceSpy = vi
      .spyOn(planningService, 'getPlanningSnapshot')
      .mockResolvedValue(rawSnapshot);
    const { result, rerender } = renderHook(
      ({ refreshToken }) => usePlanningData({ stationId, refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(serviceSpy.mock.calls[0][0]).not.toHaveProperty('date');

    rerender({ refreshToken: 1 });
    await waitFor(() => expect(serviceSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(serviceSpy.mock.calls[1][0]).not.toHaveProperty('date');
  });

  it('keeps the current station snapshot visible while the same scope revalidates', async () => {
    let resolveRefresh;
    vi.spyOn(planningService, 'getPlanningSnapshot')
      .mockResolvedValueOnce(rawSnapshot)
      .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    const { result, rerender } = renderHook(
      ({ refreshToken }) => usePlanningData({ stationId, date: '2026-08-19', refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    rerender({ refreshToken: 1 });

    expect(result.current.status).toBe('success');
    expect(result.current.refreshing).toBe(true);
    expect(result.current.data?.flights).toEqual(rawSnapshot.turnarounds);

    await act(async () => resolveRefresh({ ...rawSnapshot, turnarounds: [] }));
    expect(result.current.status).toBe('empty');
    expect(result.current.refreshing).toBe(false);
    expect(result.current.data?.flights).toEqual([]);
  });

  it.each([
    { stationId: '20000000-0000-0000-0000-000000000002', date: '2026-08-19' },
    { stationId, date: '2026-08-20' },
  ])('does not carry a prior snapshot into a new station or date while loading: %o', async nextScope => {
    vi.spyOn(planningService, 'getPlanningSnapshot')
      .mockResolvedValueOnce(rawSnapshot)
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      scope => usePlanningData(scope),
      { initialProps: { stationId, date: '2026-08-19' } }
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    rerender(nextScope);

    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('preserves the mapped station and date in an empty state', async () => {
    const emptySnapshot = { ...rawSnapshot, turnarounds: [] };
    vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue(emptySnapshot);

    const { result } = renderHook(() => usePlanningData({ stationId }));

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.data).toEqual({
      station: emptySnapshot.station,
      date: emptySnapshot.date,
      flights: [],
    });
    expect(result.current.error).toBeNull();
  });

  it('exposes a dedicated unauthorized state without leaking service metadata', async () => {
    const serviceError = Object.assign(new Error('private authorization details'), {
      status: 401,
      code: 'unauthorized',
    });
    vi.spyOn(planningService, 'getPlanningSnapshot').mockRejectedValue(serviceError);

    const { result } = renderHook(() => usePlanningData({ stationId }));

    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toMatchObject({
      name: 'PlanningViewError',
      status: 401,
      code: 'unauthorized',
      message: 'La sesión expiró. Inicia sesión nuevamente.',
    });
    expect(result.current.error.message).not.toContain('private authorization details');
  });

  it('exposes a non-recoverable forbidden state without leaking policy detail', async () => {
    const serviceError = Object.assign(new Error('private policy details'), {
      status: 403,
      code: 'forbidden',
    });
    vi.spyOn(planningService, 'getPlanningSnapshot').mockRejectedValue(serviceError);

    const { result } = renderHook(() => usePlanningData({ stationId }));

    await waitFor(() => expect(result.current.status).toBe('forbidden'));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toMatchObject({
      name: 'PlanningViewError',
      status: 403,
      code: 'forbidden',
      message: 'Su cuenta no tiene permiso para consultar esta planificación.',
    });
    expect(result.current.error.message).not.toContain('private policy details');
  });

  it('exposes a generic sanitized recoverable error', async () => {
    vi.spyOn(planningService, 'getPlanningSnapshot').mockRejectedValue(
      new Error('socket and internal host details')
    );

    const { result } = renderHook(() => usePlanningData({ stationId }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.error.message).toBe(
      'No fue posible cargar la planificación operativa.'
    );
    expect(result.current.error.message).not.toContain('internal host');
  });

  it('aborts a superseded request and ignores its AbortError', async () => {
    let firstSignal;
    let requestNumber = 0;
    vi.spyOn(planningService, 'getPlanningSnapshot').mockImplementation(({ signal }) => {
      requestNumber += 1;
      if (requestNumber === 1) {
        firstSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      return Promise.resolve(rawSnapshot);
    });

    const { result, rerender } = renderHook(
      ({ refreshToken }) => usePlanningData({ stationId, refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => expect(firstSignal).toBeInstanceOf(AbortSignal));
    rerender({ refreshToken: 1 });

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.error).toBeNull();
  });
});
