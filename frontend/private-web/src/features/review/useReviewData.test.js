import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useReviewData } from './useReviewData';
import * as reviewService from '../../services/reviewService';
import { __resetReviewStoreForTests } from '../../services/reviewService';

afterEach(() => {
  vi.restoreAllMocks();
  __resetReviewStoreForTests();
});

describe('useReviewData', () => {
  it('loads the review queue and exposes it as success state', async () => {
    const { result } = renderHook(() => useReviewData());
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data.operations.length).toBeGreaterThan(0);
  });

  it('exposes an error state when the service rejects', async () => {
    vi.spyOn(reviewService, 'getReviewQueue').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useReviewData());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error.message).toBe('network down');
  });

  it('reloads when refreshToken changes', async () => {
    const spy = vi.spyOn(reviewService, 'getReviewQueue');
    const { rerender } = renderHook(({ token }) => useReviewData('PUJ', token), { initialProps: { token: 0 } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('approveOperation patches the operation in place without refetching the whole list', async () => {
    const { result } = renderHook(() => useReviewData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.approveOperation('REV-1001', { user: 'Administrador OCC' });
    });

    const updated = result.current.data.operations.find(operation => operation.id === 'REV-1001');
    expect(updated.status).toBe('APPROVED');
  });

  it('returnOperation patches the operation with the returned status and reason', async () => {
    const { result } = renderHook(() => useReviewData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.returnOperation('REV-1001', { user: 'Administrador OCC', reason: 'Falta firma.' });
    });

    const updated = result.current.data.operations.find(operation => operation.id === 'REV-1001');
    expect(updated.status).toBe('RETURNED');
    expect(updated.returnReason).toBe('Falta firma.');
  });

  it('bulkApprove patches every operation in the batch', async () => {
    const { result } = renderHook(() => useReviewData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.bulkApprove(['REV-1001', 'REV-1002'], { user: 'Administrador OCC' });
    });

    const ids = ['REV-1001', 'REV-1002'];
    const updated = result.current.data.operations.filter(operation => ids.includes(operation.id));
    expect(updated.every(operation => operation.status === 'APPROVED')).toBe(true);
  });
});