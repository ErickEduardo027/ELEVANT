import { describe, expect, it } from 'vitest';
import { OCC_PALETTE } from '../../occ-ui/occPalette';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { ALTITUDE_STOPS_FT, MAP_COLORS, altitudeColourExpression, altitudeGradient, mapColorsFor } from './mapColors';

const HEX = /^#[0-9a-f]{6}$/;
// Every colour of a palette with its path, the stand fills by their colour.
function coloursOf(value, path = '') {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => coloursOf(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).filter(([key]) => key !== 'opacity')
      .flatMap(([key, inner]) => coloursOf(inner, path ? `${path}.${key}` : key));
  }
  return [];
}
const shape = value => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)])) : typeof value);

describe('map colours (owner request of 2026-11-15)', () => {
  it('a dark and a light palette of the same shape, frozen, every colour an opaque #rrggbb', () => {
    expect(Object.keys(MAP_COLORS)).toEqual(['dark', 'light']);
    expect(Object.isFrozen(MAP_COLORS.dark.basemap)).toBe(true);
    expect(shape(MAP_COLORS.light)).toEqual(shape(MAP_COLORS.dark));
    for (const theme of ['dark', 'light']) {
      const colours = coloursOf(MAP_COLORS[theme]).filter(([path]) => !/\]\[0\]$/.test(path));
      expect(colours.length, theme).toBeGreaterThanOrEqual(40);
      for (const [path, colour] of colours) expect(colour, `${theme}.${path}`).toMatch(HEX);
    }
  });

  it('copies no OCC token value', () => {
    const tokens = new Set(Object.values(OCC_PALETTE).map(value => value.toLowerCase()));
    for (const theme of ['dark', 'light']) {
      expect(coloursOf(MAP_COLORS[theme]).filter(([, colour]) => tokens.has(String(colour).toLowerCase()))).toEqual([]);
    }
  });

  it('mapColorsFor picks the theme and falls back to dark', () => {
    expect(mapColorsFor()).toBe(MAP_COLORS.dark);
    expect(mapColorsFor('light')).toBe(MAP_COLORS.light);
    expect(mapColorsFor('sepia')).toBe(MAP_COLORS.dark);
  });

  it('the altitude scale: eleven stops from the ground to 40 000 ft, as the owner asked', () => {
    expect([...ALTITUDE_STOPS_FT]).toEqual([0, 500, 1000, 2000, 4000, 6000, 8000, 10000, 20000, 30000, 40000]);
    expect(MAP_COLORS.dark.altitude.stops.map(([, colour]) => colour)).toEqual(['#f06a20', '#f08a20', '#f0a020',
      '#f0b420', '#e0c800', '#b8d000', '#60c820', '#20c060', '#20b8c8', '#3060f0', '#b020e0']);
    const expression = altitudeColourExpression();
    expect(expression[0]).toBe('case');
    expect(expression.at(-1).slice(0, 3)).toEqual(['interpolate', ['linear'], ['get', 'altFt']]);
    expect(altitudeGradient()).toMatch(/^linear-gradient\(to right, #f06a20 0%, .* #b020e0 100%\)$/);
    expect(altitudeGradient('dark', ALTITUDE_STOPS_FT.map((_, index) => index * 5))).toContain('#b020e0 50%');
  });

  it('one fill per stand state, each its own colour', () => {
    for (const theme of ['dark', 'light']) {
      const { stands } = MAP_COLORS[theme];
      expect(Object.keys(stands).sort()).toEqual([...STAND_STATE_KEYS].sort());
      expect(new Set(Object.values(stands).map(fill => fill.color)).size).toBe(STAND_STATE_KEYS.length);
      for (const fill of Object.values(stands)) expect(fill.opacity).toBeGreaterThan(0);
    }
  });
});
