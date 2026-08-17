import { describe, expect, it } from 'vitest';
import {
  PUJ_COORDINATES,
  isStationRelated,
  extractDateFromIso,
  FLIGHT_FILTER_CHIPS,
  matchesChip,
  getFilterOptions,
  formatRemaining,
} from './flightMonitoringMappers';

function flight(overrides) {
  return {
    id: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    status: 'approaching',
    eta: '2026-08-06T14:20:00-04:00',
    ...overrides,
  };
}

describe('PUJ_COORDINATES', () => {
  it('is the fixed coordinate pair for Punta Cana International Airport', () => {
    expect(PUJ_COORDINATES).toEqual({ latitude: 18.5674, longitude: -68.3634 });
  });
});

describe('isStationRelated', () => {
  it('is true when the flight originates at the station', () => {
    expect(isStationRelated(flight({ origin: 'PUJ', destination: 'JFK' }))).toBe(true);
  });

  it('is true when the flight lands at the station', () => {
    expect(isStationRelated(flight({ origin: 'MIA', destination: 'PUJ' }))).toBe(true);
  });

  it('is false when neither origin nor destination is the station', () => {
    expect(isStationRelated(flight({ origin: 'MIA', destination: 'JFK' }))).toBe(false);
  });
});

describe('extractDateFromIso', () => {
  it('extracts the YYYY-MM-DD prefix regardless of timezone offset', () => {
    expect(extractDateFromIso('2026-08-06T23:59:00-04:00')).toBe('2026-08-06');
  });
});

describe('matchesChip', () => {
  it('matches everything for the "all" chip', () => {
    expect(matchesChip(flight({ status: 'cancelled' }), 'all')).toBe(true);
  });

  it('groups en-route-family statuses under the "enRoute" chip', () => {
    expect(matchesChip(flight({ status: 'approaching' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'taxiing' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'leftGate' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'taxiingToGate' }), 'enRoute')).toBe(true);
    expect(matchesChip(flight({ status: 'delayed' }), 'enRoute')).toBe(false);
  });

  it('groups landed and arrived under the "landed" chip', () => {
    expect(matchesChip(flight({ status: 'landed' }), 'landed')).toBe(true);
    expect(matchesChip(flight({ status: 'arrived' }), 'landed')).toBe(true);
    expect(matchesChip(flight({ status: 'scheduled' }), 'landed')).toBe(false);
  });

  it('is a strict 1:1 match for chips without a group', () => {
    expect(matchesChip(flight({ status: 'delayed' }), 'delayed')).toBe(true);
    expect(matchesChip(flight({ status: 'scheduled' }), 'delayed')).toBe(false);
  });

  it('exposes exactly the seven chips from the brief, in order', () => {
    expect(FLIGHT_FILTER_CHIPS.map(chip => chip.id)).toEqual([
      'all',
      'scheduled',
      'enRoute',
      'delayed',
      'landed',
      'cancelled',
      'diverted',
    ]);
  });
});

describe('getFilterOptions', () => {
  it('returns deduplicated, sorted option lists per dimension', () => {
    const flights = [
      flight({ airline: 'Arajet', status: 'approaching', origin: 'MIA', destination: 'PUJ' }),
      flight({ airline: 'American', status: 'delayed', origin: 'PUJ', destination: 'MIA' }),
      flight({ airline: 'Arajet', status: 'approaching', origin: 'MIA', destination: 'PUJ' }),
    ];
    const options = getFilterOptions(flights);
    expect(options.airlines).toEqual(['American', 'Arajet']);
    expect(options.statuses).toEqual(['approaching', 'delayed']);
    expect(options.origins).toEqual(['MIA', 'PUJ']);
    expect(options.destinations).toEqual(['MIA', 'PUJ']);
  });
});

describe('formatRemaining', () => {
  it('shows a future countdown in minutes', () => {
    expect(formatRemaining('2026-08-06T08:05:00-04:00', '2026-08-06T07:20:00-04:00')).toBe('En 45 min');
  });

  it('shows an elapsed countdown in minutes', () => {
    expect(formatRemaining('2026-08-06T08:05:00-04:00', '2026-08-06T08:50:00-04:00')).toBe('Hace 45 min');
  });

  it('shows "Ahora" when eta matches now', () => {
    expect(formatRemaining('2026-08-06T08:05:00-04:00', '2026-08-06T08:05:00-04:00')).toBe('Ahora');
  });
});
