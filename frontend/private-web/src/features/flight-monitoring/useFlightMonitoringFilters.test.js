import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';

function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    registration: 'HI1024',
    supervisor: 'Juan Pérez',
    status: 'scheduled',
    eta: '2026-08-06T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    ...overrides,
  };
}

const FLIGHTS = [
  flight({ id: 1, flightNumber: 'DM161', airline: 'Arajet', registration: 'HI1024', status: 'scheduled', origin: 'PUJ', destination: 'JFK' }),
  flight({ id: 2, flightNumber: 'AA904', airline: 'American', registration: 'N904AA', status: 'delayed', origin: 'PUJ', destination: 'MIA' }),
  flight({ id: 3, flightNumber: 'AA100', airline: 'American', registration: 'N100AA', status: 'enRoute', origin: 'MIA', destination: 'JFK' }),
];

describe('useFlightMonitoringFilters', () => {
  it('returns every flight when nothing is active', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('filters by airline', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setFilter('airline', 'American'));
    expect(result.current.filteredFlights.map(f => f.id).sort()).toEqual([2, 3]);
  });

  it('filters by free-text search across number, airline, registration, and supervisor', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setFilter('search', 'HI1024'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual([1]);
  });

  it('applies the "delayed" chip', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setActiveChip('delayed'));
    expect(result.current.filteredFlights.map(f => f.id)).toEqual([2]);
  });

  it('filters to only station-related flights when the toggle is on', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setOnlyStationRelated(true));
    expect(result.current.filteredFlights.map(f => f.id).sort()).toEqual([1, 2]);
  });

  it('uses the selected station instead of assuming PUJ', () => {
    const flights = [...FLIGHTS, flight({ id: 4, origin: 'MIA', destination: 'SDQ' })];
    const { result } = renderHook(() => useFlightMonitoringFilters(flights, 'SDQ'));
    act(() => result.current.setOnlyStationRelated(true));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual([4]);
  });

  it('combines a chip and the station toggle', () => {
    const { result } = renderHook(() => useFlightMonitoringFilters(FLIGHTS));
    act(() => result.current.setActiveChip('enRoute'));
    act(() => result.current.setOnlyStationRelated(true));
    expect(result.current.filteredFlights).toHaveLength(0); // the only enRoute flight (id 3) is not station-related
  });
});