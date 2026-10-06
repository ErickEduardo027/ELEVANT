import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReportFilters } from './useReportFilters';

describe('useReportFilters', () => {
  it('defaults to the closure report and the "today" date preset', () => {
    const { result } = renderHook(() => useReportFilters());
    expect(result.current.activeReport).toBe('closure');
    expect(result.current.datePreset).toBe('today');
    expect(result.current.dateRange.from).toBe(result.current.dateRange.to);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('switches the active report', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => result.current.setActiveReport('summary'));
    expect(result.current.activeReport).toBe('summary');
  });

  it('resolves the "week" preset to a range spanning several days', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => result.current.setDatePreset('week'));
    expect(result.current.dateRange.from <= result.current.dateRange.to).toBe(true);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('switches to custom when a custom date is set and feeds it into resolvedFilters', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => result.current.setCustomDate('from', '2026-08-01'));
    act(() => result.current.setCustomDate('to', '2026-08-07'));
    expect(result.current.datePreset).toBe('custom');
    expect(result.current.resolvedFilters).toEqual(
      expect.objectContaining({ dateFrom: '2026-08-01', dateTo: '2026-08-07' })
    );
  });

  it('sets a facet filter and reflects it in resolvedFilters and hasActiveFilters', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => result.current.setFacet('airline', 'Arajet'));
    expect(result.current.resolvedFilters.airline).toBe('Arajet');
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('resets every filter back to defaults', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => result.current.setFacet('agent', 'Carlos Medina'));
    act(() => result.current.setDatePreset('month'));
    act(() => result.current.resetFilters());
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.datePreset).toBe('today');
    expect(result.current.facets).toEqual({ airline: '', agent: '', terminal: '', position: '' });
  });
});