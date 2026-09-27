import { useCallback, useEffect, useState } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommercialRevalidation } from './useCommercialRevalidation';

afterEach(() => vi.useRealTimers());

describe('useCommercialRevalidation', () => {
  it('re-reads the resource on focus, reconnect and a bounded fallback poll', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const { unmount } = renderHook(() => useCommercialRevalidation(reload));
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => window.dispatchEvent(new Event('online')));
    act(() => vi.advanceTimersByTime(25_000));
    expect(reload).toHaveBeenCalledTimes(3);
    unmount();
    act(() => vi.advanceTimersByTime(25_000));
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('recovers a failed resource fetch on the next poll even after the feed cursor advances', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    function Probe() {
      const [status, setStatus] = useState('loading');
      const reload = useCallback(async () => {
        try { await read(); setStatus('ready'); }
        catch { setStatus('error'); }
      }, []);
      useEffect(() => { void reload(); }, [reload]);
      useCommercialRevalidation(reload);
      return <p>{status}</p>;
    }
    render(<Probe />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('error')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
