import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTES, OCC_THEMES, occColor } from '../../occ-ui/occPalette';
import { MAP_COLORS } from './mapColors';
import {
  BASEMAP_COLORS, BASEMAP_THEMES, basemapColorsFor, basemapThemeColor, contrastRatio, relativeLuminance,
} from './mapTheme';

const BASE_MAP_KEYS = [
  'land', 'sea', 'coastline', 'boundary', 'road', 'roadMajor', 'building', 'buildingExtrusion', 'runway', 'taxiway',
  'apron', 'placeLabel', 'waterLabel', 'labelHalo',
];

// Hue in degrees and HSL saturation of an opaque #rrggbb colour.
function hueAndSaturation(hex) {
  const [red, green, blue] = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta > 0 && max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (delta > 0 && max === green) hue = 60 * ((blue - red) / delta + 2);
  else if (delta > 0) hue = 60 * ((red - green) / delta + 4);
  return { hue: (hue + 360) % 360, saturation };
}

describe('base-map theme', () => {
  it('keeps one base map per theme, dark by default, read from the palettes of mapColors.js', () => {
    expect(Object.keys(BASEMAP_THEMES)).toEqual(OCC_THEMES);
    for (const theme of OCC_THEMES) expect(BASEMAP_THEMES[theme]).toBe(MAP_COLORS[theme].basemap);
    expect(BASEMAP_COLORS).toBe(BASEMAP_THEMES.dark);
    expect(basemapColorsFor('light')).toBe(BASEMAP_THEMES.light);
    for (const other of ['dark', undefined, 'sepia']) expect(basemapColorsFor(other)).toBe(BASEMAP_THEMES.dark);
    expect(basemapThemeColor(BASEMAP_COLORS.runway, 'light')).toBe(BASEMAP_THEMES.light.runway);
    expect(basemapThemeColor(BASEMAP_COLORS.runway, 'dark')).toBe(BASEMAP_COLORS.runway);
    expect(basemapThemeColor('#123456', 'light')).toBe('#123456');
  });

  it.each(OCC_THEMES)('a blue sea under a blue-grey land, both on the blue hues, the sea the more saturated (%s)', theme => {
    const colours = BASEMAP_THEMES[theme];
    expect(Object.isFrozen(colours)).toBe(true);
    expect(Object.keys(colours)).toEqual(BASE_MAP_KEYS);
    expect(Object.values(colours).every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    const sea = hueAndSaturation(colours.sea);
    const land = hueAndSaturation(colours.land);
    expect(sea.hue).toBeGreaterThanOrEqual(200);
    expect(sea.hue).toBeLessThanOrEqual(230);
    expect(sea.saturation).toBeGreaterThan(0.5);
    expect(land.hue).toBeGreaterThanOrEqual(195);
    expect(land.hue).toBeLessThanOrEqual(225);
    expect(land.saturation).toBeLessThan(sea.saturation);
  });

  it('dark: the sea is darker than --occ-canvas and the land lighter (owner request of 2026-11-15, «más color»)', () => {
    expect(relativeLuminance(BASEMAP_COLORS.sea)).toBeLessThan(relativeLuminance(occColor('canvas')));
    expect(relativeLuminance(BASEMAP_COLORS.land)).toBeGreaterThan(relativeLuminance(occColor('canvas')));
  });

  it('light: the sea is darker than --occ-canvas and the land sits close to it', () => {
    const colours = BASEMAP_THEMES.light;
    expect(relativeLuminance(colours.sea)).toBeLessThan(relativeLuminance(occColor('canvas', 'light')));
    expect(contrastRatio(colours.land, occColor('canvas', 'light'))).toBeLessThanOrEqual(1.15);
  });

  it.each(OCC_THEMES)('water and land stay apart, the borders read on the land and the pavement on it (%s)', theme => {
    const colours = BASEMAP_THEMES[theme];
    expect(contrastRatio(colours.land, colours.sea)).toBeGreaterThan(1.25);
    expect(contrastRatio(colours.boundary, colours.land)).toBeGreaterThanOrEqual(4.5);
    // Lighter than the land toward the runway in the dark theme, darker in the light one.
    const ladder = ['runway', 'taxiway', 'apron', 'land'].map(key => relativeLuminance(colours[key]));
    const steps = ladder.slice(1).map((value, index) => Math.sign(ladder[index] - value));
    expect(steps).toEqual(Array(3).fill(theme === 'dark' ? 1 : -1));
    expect(contrastRatio(colours.runway, colours.land)).toBeGreaterThan(1.8);
  });

  it.each(OCC_THEMES)('labels reach 4.5:1 on the colour they sit on (%s)', theme => {
    const colours = BASEMAP_THEMES[theme];
    const pairs = [
      ['place label on land', colours.placeLabel, colours.land],
      ['water name on sea', colours.waterLabel, colours.sea],
      ['--occ-text code on land', occColor('text', theme), colours.land],
      ['--occ-text code on apron', occColor('text', theme), colours.apron],
      // The runway designators of the tiles are drawn in --occ-text on the runway.
      ['--occ-text runway designator on runway', occColor('text', theme), colours.runway],
      ['country and city names on the sea', colours.placeLabel, colours.sea],
    ];
    for (const [name, foreground, background] of pairs) {
      expect(contrastRatio(foreground, background), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('relativeLuminance and contrastRatio follow WCAG 2', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio(BASEMAP_COLORS.land, BASEMAP_COLORS.land)).toBe(1);
    expect(() => relativeLuminance('rgb(1 2 3)')).toThrow(TypeError);
  });

  it('mapTheme copies no OCC token value and writes no colour of its own: they live in mapColors.js', () => {
    const tokenValues = new Set(OCC_THEMES.flatMap(theme => Object.values(OCC_PALETTES[theme]))
      .map(value => value.toLowerCase()));
    for (const theme of OCC_THEMES) {
      expect(Object.keys(BASEMAP_THEMES[theme]), theme).toEqual(BASE_MAP_KEYS);
      expect(Object.entries(BASEMAP_THEMES[theme]).filter(([, value]) => tokenValues.has(value)), theme).toEqual([]);
    }
    const source = readFileSync('src/features/maps/style/mapTheme.js', 'utf8');
    expect(source.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/gi) ?? []).toEqual([]);
  });
});
