import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { MAP_COLORS } from './mapColors';
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

describe('base-map theme', () => {
  it('the dark base map is the dark palette of mapColors.js (owner request of 2026-11-15, «más color»)', () => {
    expect(BASEMAP_COLORS).toBe(MAP_COLORS.dark.basemap);
    expect(Object.isFrozen(BASEMAP_COLORS)).toBe(true);
    expect(Object.values(BASEMAP_COLORS).every(value => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
    // A deep navy sea and a blue-grey land: both on the blue hues, the sea the more saturated.
    const sea = hueAndSaturation(BASEMAP_COLORS.sea);
    const land = hueAndSaturation(BASEMAP_COLORS.land);
    expect(sea.hue).toBeGreaterThanOrEqual(200);
    expect(sea.hue).toBeLessThanOrEqual(230);
    expect(sea.saturation).toBeGreaterThan(0.5);
    expect(land.hue).toBeGreaterThanOrEqual(195);
    expect(land.hue).toBeLessThanOrEqual(225);
    expect(land.saturation).toBeLessThan(sea.saturation);
  });

  it('the sea is darker than --occ-canvas, the land lighter, and the borders read on the land', () => {
    expect(relativeLuminance(BASEMAP_COLORS.sea)).toBeLessThan(relativeLuminance(occColor('canvas')));
    expect(relativeLuminance(BASEMAP_COLORS.land)).toBeGreaterThan(relativeLuminance(occColor('canvas')));
    // Water and land stay well apart, and the pavement reads on the land, runways lightest.
    expect(contrastRatio(BASEMAP_COLORS.land, BASEMAP_COLORS.sea)).toBeGreaterThan(1.25);
    expect(contrastRatio(BASEMAP_COLORS.boundary, BASEMAP_COLORS.land)).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(BASEMAP_COLORS.runway)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.taxiway));
    expect(relativeLuminance(BASEMAP_COLORS.taxiway)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.apron));
    expect(relativeLuminance(BASEMAP_COLORS.apron)).toBeGreaterThan(relativeLuminance(BASEMAP_COLORS.land));
    expect(contrastRatio(BASEMAP_COLORS.runway, BASEMAP_COLORS.land)).toBeGreaterThan(1.8);
  });

  it('labels reach 4.5:1 on the colour they sit on (place on land, water names on sea, --occ-text codes on land and apron)', () => {
    const pairs = [
      ['place label on land', BASEMAP_COLORS.placeLabel, BASEMAP_COLORS.land],
      ['water name on sea', BASEMAP_COLORS.waterLabel, BASEMAP_COLORS.sea],
      ['--occ-text code on land', occColor('text'), BASEMAP_COLORS.land],
      ['--occ-text code on apron', occColor('text'), BASEMAP_COLORS.apron],
      // The runway designators of the tiles are drawn in --occ-text on the runway.
      ['--occ-text runway designator on runway', occColor('text'), BASEMAP_COLORS.runway],
      ['country and city names on the sea', BASEMAP_COLORS.placeLabel, BASEMAP_COLORS.sea],
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
    expect(Object.keys(BASEMAP_COLORS)).toEqual(BASE_MAP_KEYS);
    const tokenValues = new Set(Object.values(OCC_PALETTE).map(value => value.toLowerCase()));
    expect(Object.entries(BASEMAP_COLORS).filter(([, value]) => tokenValues.has(value))).toEqual([]);
    const source = readFileSync('src/features/maps/style/mapTheme.js', 'utf8');
    expect(source.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/gi) ?? []).toEqual([]);
  });
});
