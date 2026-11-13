import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_POSITIONS, RETIRED_DASHBOARD_POSITIONS, unlocatedStandAssignments } from './dashboardPositions';
import { RAMP_POSITIONS } from './positionsData';
import { mapTurnaroundsToRampPositions } from '../positions-map/positionsMapMappers';

describe('dashboard internal parking catalog', () => {
  it('preserves all 42 original records and keeps B33 historical', () => {
    expect(RAMP_POSITIONS).toHaveLength(42);
    expect(DASHBOARD_POSITIONS).toHaveLength(41);
    expect(RETIRED_DASHBOARD_POSITIONS.map(position => position.id)).toEqual(['B33']);
    const ids = new Set(DASHBOARD_POSITIONS.map(position => position.id));
    for (const id of ['A1', 'AN1', 'BN13', 'B34', 'B35', 'B36', 'B37']) expect(ids.has(id)).toBe(true);
    expect(ids.has('B33')).toBe(false);
    for (const id of ['B23A', 'B23B', '1', '1A']) expect(ids.has(id)).toBe(false);
  });

  it('marks B33 retired in the data, not in the code', () => {
    // ADR-0041: the flag is the rule. The API's Punta Cana catalogue holds the rows without it (DemoStationCatalogParityTests).
    expect(RAMP_POSITIONS.filter(position => 'retired' in position).map(position => position.id)).toEqual(['B33']);
    expect(RAMP_POSITIONS.find(position => position.id === 'B33').retired).toBe(true);
    expect(RETIRED_DASHBOARD_POSITIONS).toEqual(RAMP_POSITIONS.filter(position => position.retired === true));
    expect(DASHBOARD_POSITIONS).toEqual(RAMP_POSITIONS.filter(position => position.retired !== true));
    // No stand code is written in the filter itself (the path is relative to this package, as in standCodes.test.js).
    expect(readFileSync('src/features/dashboard/dashboardPositions.js', 'utf8')).not.toMatch(/['"]B33['"]/);
  });

  it('keeps the original internal coordinates for all thirteen B20–B32 entries', () => {
    const expected = [
      ['B20', 18.563333, -68.367972], ['B21', 18.563139, -68.369194],
      ['B22', 18.563667, -68.367972], ['B23', 18.563667, -68.369194],
      ['B24', 18.564028, -68.368028], ['B25', 18.564333, -68.369278],
      ['B26', 18.564444, -68.368028], ['B27', 18.562556, -68.370806],
      ['B28', 18.563, -68.370833], ['B29', 18.563528, -68.370833],
      ['B30', 18.564167, -68.370944], ['B31', 18.564306, -68.37175],
      ['B32', 18.564278, -68.372167],
    ];
    expect(DASHBOARD_POSITIONS.filter(position => /^B(2\d|3[0-2])$/.test(position.id))
      .map(({ id, lat, lon }) => [id, lat, lon])).toEqual(expected);
  });

  it('matches only exact planning codes and leaves unknown or withdrawn codes unlocated', () => {
    const turnarounds = [
      { id: 'one', operationCode: 'OP-1', stand: { code: 'A1' } },
      { id: 'two', operationCode: 'OP-2', stand: { code: 'B33' } },
      { id: 'three', operationCode: 'OP-3', stand: { code: 'B20' } },
      { id: 'four', operationCode: 'OP-4', stand: { code: '1' } },
      { id: 'five', operationCode: 'OP-5', stand: { code: 'B23A' } },
    ];
    const mapped = mapTurnaroundsToRampPositions(DASHBOARD_POSITIONS, turnarounds);
    expect(mapped.find(position => position.id === 'A1').plannedTurnarounds).toHaveLength(1);
    expect(mapped.find(position => position.id === 'B20').plannedTurnarounds).toHaveLength(1);
    expect(unlocatedStandAssignments(turnarounds).map(item => item.code)).toEqual(['B33', '1', 'B23A']);
  });
});
