import { describe, expect, it } from 'vitest';
import {
  matchesTerminalFilter,
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
