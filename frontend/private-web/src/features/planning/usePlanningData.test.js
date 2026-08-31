import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlanningData } from './usePlanningData';
import * as planningService from '../../services/planningService';

describe('usePlanningData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state then resolves to success with the snapshot', async () => {
    const fakeSnapshot = { station: { code: 'PUJ' }, date: '2026-08-05', flights: [] };
    vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue(fakeSnapshot);

    const { result } = renderHook(() => usePlanningData('PUJ'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual(fakeSnapshot);
    expect(result.current.error).toBeNull();
  });

  it('moves to error state when the service rejects', async () => {
    vi.spyOn(planningService, 'getPlanningSnapshot').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePlanningData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('re-fetches when refreshToken changes', async () => {
    const spy = vi.spyOn(planningService, 'getPlanningSnapshot').mockResolvedValue({ flights: [] });
    const { rerender } = renderHook(({ token }) => usePlanningData('PUJ', undefined, token), {
      initialProps: { token: 0 },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
