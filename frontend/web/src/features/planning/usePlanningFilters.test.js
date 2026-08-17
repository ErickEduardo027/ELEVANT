import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlanningFilters } from './usePlanningFilters';

function flight(overrides) {
  return {
    id: 'flt-x',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    station: 'PUJ',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    ...overrides,
  };
}

const FLIGHTS = [
  flight({ id: 'a', flightNumber: 'DM161', airlineIata: 'DM', status: 'scheduled', position: 'A5', agents: ['M. Castillo'] }),
  flight({ id: 'b', flightNumber: 'AA904', airlineIata: 'AA', status: 'delayed', position: 'B21', agents: [], destination: 'MIA' }),
  flight({ id: 'c', flightNumber: 'B6289', airlineIata: 'B6', status: 'boarding', position: null, agents: [], destination: 'LAX' }),
];

describe('usePlanningFilters', () => {
  it('returns every flight when no filter is active', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('filters by airline', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('airlineIata', 'AA'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual(['b']);
  });

  it('filters by free-text search across flight number and route', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('search', 'jfk'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual(['a']);
  });

  it('applies the "delayed" quick filter and toggles it off on a second call', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setQuickFilter('delayed'));
    expect(result.current.quickFilter).toBe('delayed');
    expect(result.current.filteredFlights.map(f => f.id)).toEqual(['b']);

    act(() => result.current.setQuickFilter('delayed'));
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('applies the "unassigned" quick filter to flights with no position or no agents', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setQuickFilter('unassigned'));
    expect(result.current.filteredFlights.map(f => f.id).sort()).toEqual(['b', 'c']);
  });

  it('resets all filters and the quick filter', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('airlineIata', 'AA'));
    act(() => result.current.setQuickFilter('delayed'));
    act(() => result.current.resetFilters());
    expect(result.current.filters.airlineIata).toBe('');
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });
});
