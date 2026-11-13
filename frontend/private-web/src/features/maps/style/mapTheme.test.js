import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { BASEMAP_COLORS, contrastRatio, relativeLuminance } from './mapTheme';

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
function slateProblems(colours) {
  const canvasHue = hueAndSaturation(occColor('canvas')).hue;
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
  it('base-map colours are a neutral slate: low saturation and no navy hue', () => {
    expect(Object.isFrozen(BASEMAP_COLORS)).toBe(true);
    expect(Object.values(BASEMAP_COLORS).every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    expect(slateProblems(BASEMAP_COLORS)).toEqual([]);
    // The check bites: the navy sea and land of the first map design, and plain navy, fail it.
    for (const navy of ['#07111f', '#101d2e', '#000080']) expect(slateProblems({ navy }), navy).not.toEqual([]);
  });

  it('the sea is darker than --occ-canvas and the land sits close to it', () => {
    expect(relativeLuminance(BASEMAP_COLORS.sea)).toBeLessThan(relativeLuminance(occColor('canvas')));
    expect(contrastRatio(BASEMAP_COLORS.land, occColor('canvas'))).toBeLessThanOrEqual(1.15);
    // Water and land stay apart, and the pavement reads on the land.
    expect(contrastRatio(BASEMAP_COLORS.land, BASEMAP_COLORS.sea)).toBeGreaterThan(1.05);
    expect(relativeLuminance(BASEMAP_COLORS.runway)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.taxiway));
    expect(relativeLuminance(BASEMAP_COLORS.taxiway)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.apron));
    expect(relativeLuminance(BASEMAP_COLORS.apron)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.land));
  });

  it('labels reach 4.5:1 on the colour they sit on (place on land, water names on sea, --occ-text codes on land and apron)', () => {
    const pairs = [
      ['place label on land', BASEMAP_COLORS.placeLabel, BASEMAP_COLORS.land],
      ['water name on sea', BASEMAP_COLORS.waterLabel, BASEMAP_COLORS.sea],
      ['--occ-text code on land', occColor('text'), BASEMAP_COLORS.land],
      ['--occ-text code on apron', occColor('text'), BASEMAP_COLORS.apron],
      // The runway designators of the tiles are drawn in --occ-muted on the runway.
      ['--occ-muted runway designator on runway', occColor('muted'), BASEMAP_COLORS.runway],
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
    expect(Object.keys(BASEMAP_COLORS)).toEqual(BASE_MAP_KEYS);
    const tokenValues = new Set(Object.values(OCC_PALETTE).map(value => value.toLowerCase()));
    expect(Object.entries(BASEMAP_COLORS).filter(([, value]) => tokenValues.has(value))).toEqual([]);

    const source = readFileSync('src/features/maps/style/mapTheme.js', 'utf8');
    const literals = source.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi) ?? [];
    expect(literals.length).toBe(BASE_MAP_KEYS.length);
    expect(literals.filter(literal => tokenValues.has(literal.toLowerCase()))).toEqual([]);
  });
});
