import { describe, expect, it } from 'vitest';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { STAND_REFERENCE } from './standReference';

describe('STAND_REFERENCE', () => {
  it('lists the 41 non-retired stands with code, terminal and centre, without B33', () => {
    expect(STAND_REFERENCE).toHaveLength(41);
    expect(STAND_REFERENCE.map(stand => stand.code)).not.toContain('B33');
    expect(new Set(STAND_REFERENCE.map(stand => stand.code)).size).toBe(41);
    for (const stand of STAND_REFERENCE) {
      expect(Object.keys(stand).sort(), stand.code).toEqual(['code', 'latitude', 'longitude', 'terminal']);
      expect(['A', 'B', 'FBO'], stand.code).toContain(stand.terminal);
      // Around the Punta Cana ramp, never swapped: longitude west, latitude north.
      expect(stand.longitude, stand.code).toBeGreaterThan(-68.38);
      expect(stand.longitude, stand.code).toBeLessThan(-68.35);
      expect(stand.latitude, stand.code).toBeGreaterThan(18.55);
      expect(stand.latitude, stand.code).toBeLessThan(18.58);
    }
    // The same centres as the internal catalogue, only renamed.
    const a5 = RAMP_POSITIONS.find(position => position.id === 'A5');
    expect(STAND_REFERENCE.find(stand => stand.code === 'A5')).toEqual({
      code: 'A5', terminal: 'A', longitude: a5.lon, latitude: a5.lat,
    });
    expect(Object.isFrozen(STAND_REFERENCE)).toBe(true);
    expect(Object.isFrozen(STAND_REFERENCE[0])).toBe(true);
  });
});
