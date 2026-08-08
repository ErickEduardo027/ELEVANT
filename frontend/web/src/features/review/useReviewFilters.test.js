import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReviewFilters } from './useReviewFilters';

function buildOperation(overrides = {}) {
  return {
    id: 'REV-1',
    status: 'PENDING_REVIEW',
    flight: { number: 'DM161', airline: 'Arajet' },
    agent: { name: 'Carlos Medina' },
    supervisor: { name: 'Juan Pérez' },
    position: 'A5',
    schedule: { sta: '2026-08-05T14:20:00-04:00' },
    services: [{ name: 'GPU' }],
    ...overrides,
  };
}

const OPERATIONS = [
  buildOperation({ id: 'REV-1', status: 'PENDING_REVIEW' }),
  buildOperation({ id: 'REV-2', status: 'PENDING_REVIEW', flight: { number: 'AA904', airline: 'American' }, agent: { name: 'Ana' }, position: 'B21' }),
  buildOperation({ id: 'REV-3', status: 'IN_REVIEW' }),
  buildOperation({ id: 'REV-4', status: 'APPROVED' }),
  buildOperation({ id: 'REV-5', status: 'RETURNED' }),
  buildOperation({ id: 'REV-6', status: 'RESUBMITTED' }),
];

describe('useReviewFilters', () => {
  it('defaults to the pending tab and shows only pending operations', () => {
    const { result } = renderHook(() => useReviewFilters(OPERATIONS));
    expect(result.current.activeTab).toBe('pending');
    expect(result.current.filteredOperations.map(o => o.id)).toEqual(['REV-1', 'REV-2']);
  });

  it('computes a count per tab from the full list, independent of filters', () => {
    const { result } = renderHook(() => useReviewFilters(OPERATIONS));
    expect(result.current.tabCounts).toEqual({ pending: 2, inReview: 1, approved: 1, returned: 1, resubmitted: 1 });
  });

  it('switches tabs', () => {
    const { result } = renderHook(() => useReviewFilters(OPERATIONS));
    act(() => result.current.setActiveTab('returned'));
    expect(result.current.filteredOperations.map(o => o.id)).toEqual(['REV-5']);
  });

  it('combines a select filter with the active tab', () => {
    const { result } = renderHook(() => useReviewFilters(OPERATIONS));
    act(() => result.current.setFilter('airline', 'American'));
    expect(result.current.filteredOperations.map(o => o.id)).toEqual(['REV-2']);
  });

  it('applies the general search across flight number, airline, agent, supervisor and position', () => {
    const { result } = renderHook(() => useReviewFilters(OPERATIONS));
    act(() => result.current.setFilter('search', 'ana'));
    expect(result.current.filteredOperations.map(o => o.id)).toEqual(['REV-2']);
  });

  it('reports whether any filter is active and resets them all', () => {
    const { result } = renderHook(() => useReviewFilters(OPERATIONS));
    expect(result.current.hasActiveFilters).toBe(false);
    act(() => result.current.setFilter('position', 'A5'));
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => result.current.resetFilters());
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filteredOperations.map(o => o.id)).toEqual(['REV-1', 'REV-2']);
  });
});
