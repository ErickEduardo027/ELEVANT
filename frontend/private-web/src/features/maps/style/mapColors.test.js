import { describe, expect, it } from 'vitest';
import { OCC_PALETTES, OCC_THEMES } from '../../occ-ui/occPalette';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { ALTITUDE_STOPS_FT, MAP_COLORS, altitudeColourExpression, altitudeGradient, mapColorsFor } from './mapColors';
import { contrastRatio, relativeLuminance } from './mapTheme';

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

  it('copies no OCC token value of either theme', () => {
    const tokens = new Set(OCC_THEMES.flatMap(theme => Object.values(OCC_PALETTES[theme])).map(value => value.toLowerCase()));
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

  it('the light scale keeps the stops and the hues of the dark one, each a step deeper', () => {
    const light = MAP_COLORS.light.altitude.stops;
    const dark = MAP_COLORS.dark.altitude.stops;
    expect(light.map(([feet]) => feet)).toEqual([...ALTITUDE_STOPS_FT]);
    for (const [index, [feet, colour]] of light.entries()) {
      expect(relativeLuminance(colour), `${feet} ft`).toBeLessThan(relativeLuminance(dark[index][1]));
    }
    expect(altitudeGradient('light')).toContain(`${light[0][1]} 0%`);
    expect(altitudeGradient('light')).toContain(`${light.at(-1)[1]} 100%`);
    expect(altitudeColourExpression('light')[2]).toBe(MAP_COLORS.light.altitude.ground);
  });

  it.each(OCC_THEMES)('aircraft, airports and their codes read on the base map (%s)', theme => {
    const { basemap, altitude, airports } = MAP_COLORS[theme];
    // The halo edges every aircraft: on the light map a dark line that stands well off the land and the sea.
    if (theme === 'light') {
      for (const ground of [basemap.land, basemap.sea]) expect(contrastRatio(altitude.halo, ground)).toBeGreaterThanOrEqual(7);
      // Every stop of the scale stands at least 2.5:1 off the light land.
      for (const [feet, colour] of altitude.stops) {
        expect(contrastRatio(colour, basemap.land), `${feet} ft`).toBeGreaterThanOrEqual(2.5);
      }
    }
    // An aircraft on the ground reads on the land, and apart from one without an altitude.
    expect(contrastRatio(altitude.ground, basemap.land)).toBeGreaterThanOrEqual(4);
    expect(contrastRatio(altitude.ground, altitude.unknown)).toBeGreaterThan(1.3);
    // The airport codes reach 4.5:1 on their halo and on the land, and every dot 3:1 on the land.
    expect(contrastRatio(airports.label, airports.halo)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(airports.label, basemap.land)).toBeGreaterThanOrEqual(4.5);
    for (const kind of ['home', 'international', 'regional', 'other']) {
      expect(contrastRatio(airports[kind], basemap.land), kind).toBeGreaterThanOrEqual(3);
    }
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
