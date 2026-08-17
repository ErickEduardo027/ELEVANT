import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReportFilterOptions, useReportsData } from './useReportsData';
import * as reportsService from '../../services/reportsService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useReportsData', () => {
  it('loads the closure report by default', async () => {
    const { result } = renderHook(() => useReportsData('PUJ', 'closure', {}));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data.rows.length).toBeGreaterThan(0);
  });

  it('refetches when the active report changes', async () => {
    const closureSpy = vi.spyOn(reportsService, 'getClosureReport');
    const summarySpy = vi.spyOn(reportsService, 'getOperationalSummary');

    const { result, rerender } = renderHook(
      ({ activeReport }) => useReportsData('PUJ', activeReport, {}),
      { initialProps: { activeReport: 'closure' } }
    );
    await waitFor(() => expect(closureSpy).toHaveBeenCalledTimes(1));

    rerender({ activeReport: 'summary' });
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data.records).toEqual(expect.any(Array)));
  });

  it('exposes an error state when the service rejects', async () => {
    vi.spyOn(reportsService, 'getClosureReport').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useReportsData('PUJ', 'closure', {}));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error.message).toBe('network down');
  });

  it('reloads when refreshToken changes', async () => {
    const spy = vi.spyOn(reportsService, 'getClosureReport');
    const { rerender } = renderHook(({ token }) => useReportsData('PUJ', 'closure', {}, token), {
      initialProps: { token: 0 },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});

describe('useReportFilterOptions', () => {
  it('derives filter options from the unfiltered operational records', async () => {
    const { result } = renderHook(() => useReportFilterOptions());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.options.airlines.length).toBeGreaterThan(0);
    expect(result.current.options.terminals.length).toBeGreaterThan(0);
  });
});
