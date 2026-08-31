import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import * as dashboardService from '../../services/dashboardService';

describe('useDashboardData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state then resolves to success with the snapshot', async () => {
    const fakeSnapshot = { station: { code: 'PUJ' } };
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockResolvedValue(fakeSnapshot);

    const { result } = renderHook(() => useDashboardData('PUJ'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data).toEqual(fakeSnapshot);
    expect(result.current.error).toBeNull();
  });

  it('moves to error state when the service rejects', async () => {
    vi.spyOn(dashboardService, 'getDashboardSnapshot').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useDashboardData('PUJ'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('refetches when the refreshToken changes, allowing a manual retry', async () => {
    const spy = vi
      .spyOn(dashboardService, 'getDashboardSnapshot')
      .mockResolvedValue({ station: { code: 'PUJ' } });

    const { result, rerender } = renderHook(({ token }) => useDashboardData('PUJ', token), {
      initialProps: { token: 0 },
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ token: 1 });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
