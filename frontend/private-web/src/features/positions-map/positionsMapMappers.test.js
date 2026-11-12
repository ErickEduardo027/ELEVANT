import { describe, expect, it } from 'vitest';
import {
  matchesTerminalFilter,
  mapOccupancyToRampPositions,
  matchesPositionSearch,
  findPositionByQuery,
  computePositionsSummary,
  getCombinedConfigExplanation,
  buildDisabledToast,
} from './positionsMapMappers';

function position(overrides) {
  return {
    id: 'A1',
    terminal: 'A',
    latitude: 18.56,
    longitude: -68.36,
    status: 'available',
    flightId: null,
    flightNumber: null,
    airline: null,
    aircraftRegistration: null,
    aircraftType: null,
    combinedConfiguration: null,
    linkedPositionId: null,
    ...overrides,
  };
}

describe('matchesTerminalFilter', () => {
  it('matches everything for "all"', () => {
    expect(matchesTerminalFilter(position({ terminal: 'B' }), 'all')).toBe(true);
  });

  it('matches only the requested terminal', () => {
    expect(matchesTerminalFilter(position({ terminal: 'A' }), 'A')).toBe(true);
    expect(matchesTerminalFilter(position({ terminal: 'B' }), 'A')).toBe(false);
  });
});

describe('matchesPositionSearch', () => {
  it('matches by position id case-insensitively', () => {
    expect(matchesPositionSearch(position({ id: 'BN8' }), 'bn8')).toBe(true);
  });

  it('matches by flight number or registration', () => {
    const occupied = position({ id: 'A5', flightNumber: 'AC1876', aircraftRegistration: 'C-1876AC' });
    expect(matchesPositionSearch(occupied, 'AC1876')).toBe(true);
    expect(matchesPositionSearch(occupied, 'c-1876ac')).toBe(true);
  });

  it('is permissive (matches everything) for an empty query', () => {
    expect(matchesPositionSearch(position(), '')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesPositionSearch(position({ id: 'A1' }), 'ZZZ')).toBe(false);
  });
});

describe('findPositionByQuery', () => {
  const positions = [
    position({ id: 'A1' }),
    position({ id: 'B24', terminal: 'B', flightNumber: 'DM161', aircraftRegistration: 'HI1024' }),
  ];

  it('finds an exact position id', () => {
    expect(findPositionByQuery(positions, 'a1')?.id).toBe('A1');
  });

  it('finds by flight number', () => {
    expect(findPositionByQuery(positions, 'dm161')?.id).toBe('B24');
  });

  it('finds by aircraft registration', () => {
    expect(findPositionByQuery(positions, 'HI1024')?.id).toBe('B24');
  });

  it('returns null when nothing matches', () => {
    expect(findPositionByQuery(positions, 'ZZZ99')).toBeNull();
  });

  it('returns null for an empty query', () => {
    expect(findPositionByQuery(positions, '   ')).toBeNull();
  });
});

describe('computePositionsSummary', () => {
  it('computes totals dynamically from the given positions', () => {
    const summary = computePositionsSummary([
      position({ status: 'available' }),
      position({ status: 'available' }),
      position({ status: 'occupied' }),
      position({ status: 'disabled' }),
      position({ status: 'releasing' }),
    ]);
    expect(summary).toEqual({ total: 5, planned: 0, unverified: 0, available: 2, occupied: 1, disabled: 1, releasing: 1 });
  });

  it('returns all-zero totals for an empty list', () => {
    expect(computePositionsSummary([])).toEqual({ total: 0, planned: 0, unverified: 0, available: 0, occupied: 0, disabled: 0, releasing: 0 });
  });
});

describe('getCombinedConfigExplanation', () => {
  it('returns null for a position that is not disabled', () => {
    expect(getCombinedConfigExplanation(position({ status: 'occupied', combinedConfiguration: '9-Alfa' }))).toBeNull();
  });

  it('returns null for a disabled position with no combined configuration', () => {
    expect(getCombinedConfigExplanation(position({ status: 'disabled' }))).toBeNull();
  });

  it('derives the exact reason/relation text from combinedConfiguration and linkedPositionId only', () => {
    const explanation = getCombinedConfigExplanation(
      position({ id: 'A10', status: 'disabled', combinedConfiguration: '9-Alfa', linkedPositionId: 'A9' })
    );
    expect(explanation).toEqual({
      reason: 'Configuración 9-Alfa activa.',
      relation: 'Esta configuración utiliza A9 y bloquea temporalmente A10.',
    });
  });
});

describe('buildDisabledToast', () => {
  it('builds the two-line toast copy from the position id and its combined configuration', () => {
    expect(buildDisabledToast(position({ id: 'B30', combinedConfiguration: '29-Bravo' }))).toEqual({
      title: 'Posición B30 inhabilitada',
      description: 'Configuración 29-Bravo activa.',
    });
  });
});
describe('mapOccupancyToRampPositions with OCC locations (ADR-0027)', () => {
  const reference = [{ id: 'A1', terminal: 'A', lat: 18.5641, lon: -68.3602 }];
  const stand = (code, extra = {}) => ({ standId: `id-${code}`, code, terminalCode: 'A', standType: 'Contact', status: 'available',
    turnarounds: [], ...extra });

  it('prefers the coordinates OCC saved and marks the source', () => {
    const [placed] = mapOccupancyToRampPositions(reference, { positions: [stand('A01', { latitude: 18.6, longitude: -68.4 })] });
    expect(placed).toMatchObject({ id: 'A1', latitude: 18.6, longitude: -68.4, locationSource: 'occ' });
    const [fallback] = mapOccupancyToRampPositions(reference, { positions: [stand('A01')] });
    expect(fallback).toMatchObject({ latitude: 18.5641, longitude: -68.3602, locationSource: 'reference' });
  });

  it('adds stands OCC placed that the reference does not know, and skips unplaced unknown ones', () => {
    const positions = mapOccupancyToRampPositions(reference, {
      positions: [stand('A01'), stand('C07', { latitude: 18.57, longitude: -68.37 }), stand('C08')] });
    expect(positions.map(item => item.id)).toEqual(['A1', 'C7']);
    expect(positions[1]).toMatchObject({ standId: 'id-C07', locationSource: 'occ' });
  });
});

describe('mapOccupancyToRampPositions with coverage and combined stands (ADR-0030)', () => {
  const reference = [{ id: 'A1', terminal: 'A', lat: 18.5641, lon: -68.3602 }, { id: 'A2', terminal: 'A', lat: 18.5642, lon: -68.3603 }];
  const stand = (code, extra = {}) => ({ standId: `id-${code}`, code, terminalCode: 'A', standType: 'Contact', status: 'available',
    turnarounds: [], hasBoardingBridge: false, isRemote: false, maxAircraftSize: null, cancelledBy: null, narrowbodyOnly: false,
    coveredBy: [], ...extra });

  it('disables a free stand cancelled by an occupied combined stand and names the covering agent', () => {
    const [a1, a2] = mapOccupancyToRampPositions(reference, { positions: [
      stand('A01', { status: 'occupied', coveredBy: ['Riley Ramp'] }), stand('A02', { cancelledBy: 'A01' })] });
    expect(a1).toMatchObject({ status: 'occupied', assignedAgent: 'Riley Ramp' });
    expect(a2).toMatchObject({ status: 'disabled', combinedConfiguration: 'A01', linkedPositionId: 'A1' });
  });
});

describe('mapOccupancyToRampPositions with demo flights (ADR-0041)', () => {
  const reference = [{ id: 'A1', terminal: 'A', lat: 18.5641, lon: -68.3602 }, { id: 'A2', terminal: 'A', lat: 18.5642, lon: -68.3603 },
    { id: 'A3', terminal: 'A', lat: 18.5643, lon: -68.3604 }];
  const turnaround = (id, extra = {}) => ({ turnaroundId: id, operationCode: `PUJ-${id}`, airlineName: 'Demo Airlines',
    arrivalFlightNumber: 'ZZ9001', departureFlightNumber: 'ZZ9002', arrivedAt: null, status: 'Confirmed', ...extra });
  const stand = (code, turnarounds) => ({ standId: `id-${code}`, code, terminalCode: 'A', status: turnarounds.length ? 'planned' : 'available',
    turnarounds });

  it('carries isDemo from the flight the stand shows, and only when the server marks it true', () => {
    const [demo, real, free] = mapOccupancyToRampPositions(reference, { positions: [
      // The parked flight is the one the stand shows, even when a demo flight comes next.
      stand('A01', [turnaround('t-1', { isDemo: true })]),
      stand('A02', [turnaround('t-2', { arrivedAt: '2026-11-12T14:00:00Z' }), turnaround('t-3', { isDemo: true })]),
      stand('A03', [])] });
    expect(demo).toMatchObject({ id: 'A1', isDemo: true });
    expect(real).toMatchObject({ id: 'A2', isDemo: false, flightNumber: 'ZZ9001' });
    expect(free).toMatchObject({ id: 'A3', isDemo: false });
    // The listed turnarounds keep their own mark for the drawer.
    expect(real.turnarounds.map(item => item.isDemo === true)).toEqual([false, true]);
  });
});
