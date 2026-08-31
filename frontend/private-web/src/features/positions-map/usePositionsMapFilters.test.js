import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePositionsMapFilters } from './usePositionsMapFilters';

function position(overrides) {
  return { id: 'A1', terminal: 'A', flightNumber: null, aircraftRegistration: null, ...overrides };
}

const POSITIONS = [
  position({ id: 'A1', terminal: 'A' }),
  position({ id: 'B24', terminal: 'B', flightNumber: 'DM161' }),
  position({ id: 'BN8', terminal: 'FBO', flightNumber: 'CM345' }),
];

describe('usePositionsMapFilters', () => {
  it('returns every position when nothing is filtered', () => {
    const { result } = renderHook(() => usePositionsMapFilters(POSITIONS));
    expect(result.current.filteredPositions).toHaveLength(3);
  });

  it('filters by terminal', () => {
    const { result } = renderHook(() => usePositionsMapFilters(POSITIONS));
    act(() => result.current.setTerminalFilter('B'));
    expect(result.current.filteredPositions.map(p => p.id)).toEqual(['B24']);
  });

  it('filters by free-text search across id and flight number', () => {
    const { result } = renderHook(() => usePositionsMapFilters(POSITIONS));
    act(() => result.current.setSearch('dm161'));
    expect(result.current.filteredPositions.map(p => p.id)).toEqual(['B24']);
  });

  it('combines the terminal filter and the search text', () => {
    const { result } = renderHook(() => usePositionsMapFilters(POSITIONS));
    act(() => result.current.setTerminalFilter('FBO'));
    act(() => result.current.setSearch('dm161'));
    expect(result.current.filteredPositions).toHaveLength(0);
  });
});
