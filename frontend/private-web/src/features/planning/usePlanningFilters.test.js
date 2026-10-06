import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePlanningFilters } from './usePlanningFilters';

function leg(flightNumber, origin, destination, scheduledAt, estimatedAt = null) {
  return {
    flightNumber,
    origin: { iataCode: origin, icaoCode: `K${origin}`, name: `${origin} Airport` },
    destination: { iataCode: destination, icaoCode: `K${destination}`, name: `${destination} Airport` },
    scheduledAt,
    estimatedAt,
  };
}

function flight(overrides = {}) {
  return {
    id: 'turnaround-1',
    operationCode: 'DEV-TAT-0002',
    status: 'Confirmed',
    airline: { iataCode: 'ZZ', icaoCode: 'DZZ', name: 'Demo Airlines' },
    aircraft: { icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320-200', registration: 'HI-DEV' },
    stand: { code: 'A02' },
    terminal: { code: 'A', name: 'Terminal A' },
    arrival: leg('ZZ102', 'SDQ', 'PUJ', '2026-08-19T12:15:00-04:00', '2026-08-19T12:20:00-04:00'),
    departure: leg('ZZ103', 'PUJ', 'JFK', '2026-08-19T14:00:00-04:00'),
    assignedAgents: [{ displayName: 'Riley Ramp', employeeNumber: 'DEV-RA-001', positionCode: 'RAMP', positionName: 'Ramp Agent' }],
    assignedEquipment: [{ assetCode: 'GPU-DEV-01', equipmentTypeCode: 'GPU', equipmentTypeName: 'Ground power unit' }],
    assignedServices: [{ code: 'BAGGAGE', name: 'Baggage handling' }],
    resourceState: { standAssigned: true, agentsAssigned: true },
    ...overrides,
  };
}

const FLIGHTS = [
  flight(),
  flight({
    id: 'turnaround-2',
    operationCode: 'DEV-TAT-0003',
    status: 'Scheduled',
    airline: { iataCode: 'AA', icaoCode: 'AAL', name: 'American Airlines' },
    aircraft: { icaoCode: 'B738', iataCode: '738', manufacturer: 'Boeing', model: '737-800', registration: 'N123AA' },
    stand: { code: 'B21' },
    terminal: { code: 'B', name: 'Terminal B' },
    arrival: null,
    departure: leg('AA904', 'PUJ', 'MIA', '2026-08-19T15:00:00-04:00'),
    assignedAgents: [],
    assignedEquipment: [],
    assignedServices: [],
    resourceState: { standAssigned: true, agentsAssigned: false },
  }),
  flight({
    id: 'turnaround-3',
    operationCode: 'DEV-TAT-0004',
    status: 'Scheduled',
    airline: { iataCode: 'B6', icaoCode: 'JBU', name: 'JetBlue' },
    aircraft: null,
    stand: null,
    terminal: null,
    arrival: leg('B6289', 'JFK', 'PUJ', '2026-08-19T16:00:00-04:00'),
    departure: null,
    assignedAgents: [],
    assignedEquipment: [],
    assignedServices: [],
    resourceState: { standAssigned: false, agentsAssigned: false },
  }),
];

describe('usePlanningFilters', () => {
  it('starts with only client-side operational filters and returns every item', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));

    expect(result.current.filters).toEqual({
      airlineIata: '',
      status: '',
      aircraftType: '',
      position: '',
      terminal: '',
      agent: '',
      search: '',
    });
    expect(result.current.filters).not.toHaveProperty('date');
    expect(result.current.filters).not.toHaveProperty('airportCode');
    expect(result.current.filteredFlights).toHaveLength(3);

    act(() => result.current.setFilter('date', '2026-08-20'));
    expect(result.current.filters).not.toHaveProperty('date');
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('filters by airline, turnaround status, aircraft, stand, terminal, and assigned agent', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));

    act(() => result.current.setFilter('airlineIata', 'ZZ'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-1']);
    act(() => result.current.setFilter('airlineIata', ''));
    act(() => result.current.setFilter('status', 'Confirmed'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-1']);
    act(() => result.current.setFilter('status', ''));
    act(() => result.current.setFilter('aircraftType', 'B738'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-2']);
    act(() => result.current.setFilter('aircraftType', ''));
    act(() => result.current.setFilter('position', 'A02'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-1']);
    act(() => result.current.setFilter('position', ''));
    act(() => result.current.setFilter('terminal', 'B'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-2']);
    act(() => result.current.setFilter('terminal', ''));
    act(() => result.current.setFilter('agent', 'Riley Ramp'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-1']);
  });

  it.each([
    ['dev-tat-0002', ['turnaround-1']],
    ['zz103', ['turnaround-1']],
    ['jfk', ['turnaround-1', 'turnaround-3']],
    ['hi-dev', ['turnaround-1']],
    ['dev-ra-001', ['turnaround-1']],
    ['gpu-dev-01', ['turnaround-1']],
    ['baggage', ['turnaround-1']],
    ['mia airport', ['turnaround-2']],
  ])('searches canonical operation, both legs, resources, and route for %j', (search, expectedIds) => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('search', search));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(expectedIds);
  });

  it('derives the delayed quick filter from the explicit leg estimate and toggles it', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setQuickFilter('delayed'));
    expect(result.current.quickFilter).toBe('delayed');
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-1']);

    act(() => result.current.setQuickFilter('delayed'));
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('shows resource gaps under unassigned without assuming equipment or services are mandatory', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setQuickFilter('unassigned'));
    expect(result.current.filteredFlights.map(item => item.id)).toEqual(['turnaround-2', 'turnaround-3']);
  });

  it('rejects today and tomorrow quick filters instead of consulting the browser clock', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));

    act(() => result.current.setQuickFilter('today'));
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
    act(() => result.current.setQuickFilter('tomorrow'));
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('resets every operational filter and the quick filter', () => {
    const { result } = renderHook(() => usePlanningFilters(FLIGHTS));
    act(() => result.current.setFilter('airlineIata', 'AA'));
    act(() => result.current.setQuickFilter('unassigned'));
    act(() => result.current.resetFilters());

    expect(result.current.filters.airlineIata).toBe('');
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });

  it('resets stale local filters when the server station or date scope changes', () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => usePlanningFilters(FLIGHTS, scopeKey),
      { initialProps: { scopeKey: 'station-a|2026-08-19' } }
    );

    act(() => result.current.setFilter('airlineIata', 'AA'));
    act(() => result.current.setQuickFilter('unassigned'));
    expect(result.current.filters.airlineIata).toBe('AA');
    expect(result.current.quickFilter).toBe('unassigned');

    rerender({ scopeKey: 'station-b|2026-08-20' });

    expect(result.current.filters.airlineIata).toBe('');
    expect(result.current.quickFilter).toBe('none');
    expect(result.current.filteredFlights).toHaveLength(3);
  });
});