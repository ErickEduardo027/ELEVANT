import { describe, expect, it } from 'vitest';
import {
  isPendingAssignment,
  computeKpis,
  extractDateFromIso,
  groupFlightsByHour,
  formatCountdown,
  getFilterOptions,
} from './planningMappers';

function flight(overrides) {
  return {
    id: 'flt-x',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    estimatedTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    station: 'PUJ',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    teams: [],
    services: [],
    conflict: null,
    observations: '',
    history: [],
    ...overrides,
  };
}

describe('isPendingAssignment', () => {
  it('is true when there is no position', () => {
    expect(isPendingAssignment(flight({ position: null }))).toBe(true);
  });

  it('is true when there are no agents', () => {
    expect(isPendingAssignment(flight({ agents: [] }))).toBe(true);
  });

  it('is false when both position and agents are present', () => {
    expect(isPendingAssignment(flight({ position: 'A5', agents: ['M. Castillo'] }))).toBe(false);
  });
});

describe('computeKpis', () => {
  it('counts flights, pending assignment, distinct occupied positions, and conflicts', () => {
    const flights = [
      flight({ id: 'a', position: 'A5', agents: ['M. Castillo'], conflict: null }),
      flight({ id: 'b', position: 'A5', agents: [], conflict: { reason: 'x' } }),
      flight({ id: 'c', position: null, agents: [], conflict: null }),
      flight({ id: 'd', position: 'B21', agents: ['R. Peña'], conflict: { reason: 'y' } }),
    ];
    expect(computeKpis(flights)).toEqual({
      flightsToday: 4,
      pendingAssignment: 2,
      positionsOccupied: 2,
      conflicts: 2,
    });
  });
});

describe('extractDateFromIso', () => {
  it('extracts the YYYY-MM-DD prefix regardless of timezone offset', () => {
    expect(extractDateFromIso('2026-08-05T23:59:00-04:00')).toBe('2026-08-05');
  });
});

describe('groupFlightsByHour', () => {
  it('sorts by scheduled time and groups consecutive flights sharing an hour', () => {
    const flights = [
      flight({ id: 'b', scheduledTime: '2026-08-05T09:10:00-04:00' }),
      flight({ id: 'a', scheduledTime: '2026-08-05T08:05:00-04:00' }),
      flight({ id: 'c', scheduledTime: '2026-08-05T08:45:00-04:00' }),
    ];
    const groups = groupFlightsByHour(flights);
    expect(groups.map(group => group.hourLabel)).toEqual(['08:00', '09:00']);
    expect(groups[0].flights.map(f => f.id)).toEqual(['a', 'c']);
    expect(groups[1].flights.map(f => f.id)).toEqual(['b']);
  });
});

describe('formatCountdown', () => {
  it('shows a future countdown in minutes', () => {
    expect(formatCountdown('2026-08-05T08:05:00-04:00', '2026-08-05T07:20:00-04:00')).toBe('En 45 min');
  });

  it('shows an elapsed countdown in minutes', () => {
    expect(formatCountdown('2026-08-05T08:05:00-04:00', '2026-08-05T08:50:00-04:00')).toBe('Hace 45 min');
  });

  it('shows "Ahora" when scheduled time matches now', () => {
    expect(formatCountdown('2026-08-05T08:05:00-04:00', '2026-08-05T08:05:00-04:00')).toBe('Ahora');
  });
});

describe('getFilterOptions', () => {
  it('returns deduplicated, sorted option lists per dimension, excluding null/empty values', () => {
    const flights = [
      flight({ airlineIata: 'DM', status: 'scheduled', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['M. Castillo'] }),
      flight({ airlineIata: 'AA', status: 'delayed', aircraftType: 'B787', position: null, supervisor: null, agents: [] }),
      flight({ airlineIata: 'DM', status: 'scheduled', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['R. Peña'] }),
    ];
    const options = getFilterOptions(flights);
    expect(options.airlines).toEqual(['AA', 'DM']);
    expect(options.statuses).toEqual(['delayed', 'scheduled']);
    expect(options.aircraftTypes).toEqual(['A320', 'B787']);
    expect(options.positions).toEqual(['A5']);
    expect(options.supervisors).toEqual(['J. Ramírez']);
    expect(options.agents).toEqual(['M. Castillo', 'R. Peña']);
  });
});
