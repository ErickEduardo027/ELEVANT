import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTES, OCC_THEMES, occColor } from '../../occ-ui/occPalette';
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

// Slate sits with the OCC tokens: little saturation, on the hue of --occ-canvas. Navy is a saturated blue past 215°.
function slateProblems(colours, theme = 'dark') {
  const canvasHue = hueAndSaturation(occColor('canvas', theme)).hue;
  return Object.entries(colours).flatMap(([name, value]) => {
    const { hue, saturation } = hueAndSaturation(value);
    const problems = [];
    if (saturation > 0.3) problems.push(`${name} is saturated (${saturation.toFixed(2)})`);
    if (saturation > 0.05 && Math.abs(hue - canvasHue) > 12) problems.push(`${name} leaves the slate hue (${hue.toFixed(0)}°)`);
    if (hue >= 215 && hue <= 250 && saturation > 0.2) problems.push(`${name} reads as navy`);
    return problems;
  });
}

describe('base-map theme', () => {
  it('keeps one base map per theme, dark by default', () => {
    expect(Object.keys(BASEMAP_THEMES)).toEqual(OCC_THEMES);
    expect(BASEMAP_COLORS).toBe(BASEMAP_THEMES.dark);
    expect(basemapColorsFor('light')).toBe(BASEMAP_THEMES.light);
    for (const other of ['dark', undefined, 'sepia']) expect(basemapColorsFor(other)).toBe(BASEMAP_THEMES.dark);
    expect(basemapThemeColor(BASEMAP_COLORS.runway, 'light')).toBe(BASEMAP_THEMES.light.runway);
    expect(basemapThemeColor(BASEMAP_COLORS.runway, 'dark')).toBe(BASEMAP_COLORS.runway);
    expect(basemapThemeColor('#123456', 'light')).toBe('#123456');
  });

  it.each(OCC_THEMES)('base-map colours are a neutral slate: low saturation and no navy hue (%s)', theme => {
    const colours = BASEMAP_THEMES[theme];
    expect(Object.isFrozen(colours)).toBe(true);
    expect(Object.keys(colours)).toEqual(BASE_MAP_KEYS);
    expect(Object.values(colours).every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    expect(slateProblems(colours, theme)).toEqual([]);
    // The check bites: the navy sea and land of the first map design, and plain navy, fail it.
    for (const navy of ['#07111f', '#101d2e', '#000080']) expect(slateProblems({ navy }), navy).not.toEqual([]);
  });

  it.each(OCC_THEMES)('the sea is darker than --occ-canvas and the land sits close to it (%s)', theme => {
    const colours = BASEMAP_THEMES[theme];
    expect(relativeLuminance(colours.sea)).toBeLessThan(relativeLuminance(occColor('canvas', theme)));
    expect(contrastRatio(colours.land, occColor('canvas', theme))).toBeLessThanOrEqual(1.15);
    // Water and land stay apart, and the pavement reads on the land: lighter than it in the dark theme, darker in
    // the light one.
    expect(contrastRatio(colours.land, colours.sea)).toBeGreaterThan(1.05);
    const ladder = ['runway', 'taxiway', 'apron', 'land'].map(key => relativeLuminance(colours[key]));
    const steps = ladder.slice(1).map((value, index) => Math.sign(ladder[index] - value));
    expect(steps).toEqual(Array(3).fill(theme === 'dark' ? 1 : -1));
  });

  it.each(OCC_THEMES)('labels reach 4.5:1 on the colour they sit on (%s)', theme => {
    const colours = BASEMAP_THEMES[theme];
    const pairs = [
      ['place label on land', colours.placeLabel, colours.land],
      ['water name on sea', colours.waterLabel, colours.sea],
      ['--occ-text code on land', occColor('text', theme), colours.land],
      ['--occ-text code on apron', occColor('text', theme), colours.apron],
      // The runway designators of the tiles are drawn in --occ-muted on the runway.
      ['--occ-muted runway designator on runway', occColor('muted', theme), colours.runway],
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

  it('mapTheme copies no OCC token value: state colours are imported from occPalette.js', () => {
    const tokenValues = new Set(OCC_THEMES.flatMap(theme => Object.values(OCC_PALETTES[theme]))
      .map(value => value.toLowerCase()));
    for (const theme of OCC_THEMES) {
      expect(Object.entries(BASEMAP_THEMES[theme]).filter(([, value]) => tokenValues.has(value)), theme).toEqual([]);
    }

    const source = readFileSync('src/features/maps/style/mapTheme.js', 'utf8');
    const literals = source.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi) ?? [];
    expect(literals.length).toBe(BASE_MAP_KEYS.length * OCC_THEMES.length);
    expect(literals.filter(literal => tokenValues.has(literal.toLowerCase()))).toEqual([]);
  });
});
