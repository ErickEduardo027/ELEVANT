import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTE, occColor } from '../../occ-ui/occPalette';
import { basemapLayers } from './basemapLayers';
import { createImageResolver } from './mapImages';
import { BASEMAP_COLORS } from './mapTheme';
import {
  BASEMAP_SOURCE_ID, FONT_STACKS, GLYPHS_URL, OPENFREEMAP_TILEJSON, SLOT_GROUP, SLOT_ORDER, buildOccStyle,
  groupLayerIds, nextSlot, slotMarkerId,
} from './occStyle';

// An overlay shaped like the point stands of the positions map: four layers in three slots, state colours from the
// OCC palette (one of them see-through), icons from mapImages.js, a pick target and a derived threshold.
const STAND_OVERLAY = {
  sources: {
    'occ-stands': {
      type: 'geojson',
      promoteId: 'code',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: 'A1' }, geometry: { type: 'Point', coordinates: [-68.36, 18.57] } }] },
    },
  },
  layers: [
    {
      slot: 'stands',
      id: 'occ-stands-slab',
      type: 'symbol',
      source: 'occ-stands',
      filter: ['match', ['get', 'state'], ['arriving', 'occupied', 'releasing'], true, false],
      layout: { 'icon-image': 'stand-slab', 'icon-allow-overlap': true },
      paint: {
        'icon-color': ['match', ['get', 'state'], 'arriving', occColor('arriving-fill'), occColor('panel-raised')],
      },
      metadata: { 'occ:group': 'stands' },
    },
    {
      slot: 'stands',
      id: 'occ-stands-frame',
      type: 'symbol',
      source: 'occ-stands',
      layout: {
        'icon-image': ['match', ['get', 'dash'], '4-3', 'stand-frame-dash-4-3', '2-2', 'stand-frame-dash-2-2', '1-3',
          'stand-frame-dot-1-3', 'stand-frame-solid'],
        'icon-allow-overlap': true,
      },
      paint: { 'icon-color': ['match', ['get', 'state'], 'planned', occColor('muted'), occColor('line-strong')] },
      metadata: { 'occ:group': 'stands', 'occ:pick': 'stand', 'occ:pickId': 'code' },
    },
    {
      slot: 'standLabels',
      id: 'occ-stand-codes',
      type: 'symbol',
      source: 'occ-stands',
      layout: { 'text-field': ['get', 'code'], 'text-font': FONT_STACKS.bold, 'text-size': 12, 'text-offset': [0, 1.6] },
      paint: { 'text-color': occColor('text'), 'text-halo-color': occColor('canvas'), 'text-halo-width': 1.2 },
      metadata: { 'occ:group': 'stands', 'occ:minThreshold': 'codes' },
    },
    {
      slot: 'selection',
      id: 'occ-stand-selected',
      type: 'symbol',
      source: 'occ-stands',
      filter: ['==', ['get', 'code'], ''],
      layout: { 'icon-image': 'stand-selected', 'icon-allow-overlap': true },
      paint: { 'icon-color': occColor('accent') },
      metadata: { 'occ:group': 'selection' },
    },
  ],
};
const OVERLAY_IDS = new Set(STAND_OVERLAY.layers.map(layer => layer.id));

const NOTO_STACKS = Object.values(FONT_STACKS).map(stack => JSON.stringify(stack));

// Fails on a text-font that is not one of the three stacks the glyph server has, or that it cannot read as one.
function assertNotoSansOnly(style) {
  const wrong = style.layers
    .filter(layer => layer.layout?.['text-font'] !== undefined)
    .filter(layer => !NOTO_STACKS.includes(JSON.stringify(layer.layout['text-font'])))
    .map(layer => `${layer.id}: ${JSON.stringify(layer.layout['text-font'])}`);
  if (wrong.length > 0) throw new Error(`Fonts the OpenFreeMap glyph server does not have: ${wrong.join(', ')}`);
}

const COLOUR = /^(?:#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\))$/i;
function coloursIn(value) {
  if (typeof value === 'string') return COLOUR.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(coloursIn);
  return [];
}
const paintColours = layer => Object.entries(layer.paint ?? {})
  .filter(([property]) => property.endsWith('-color'))
  .flatMap(([, value]) => coloursIn(value));

// The image ids an icon-image value can produce. Only plain names and the expressions below are allowed, so the test
// can read every id the style names.
function imageIdsIn(value) {
  if (typeof value === 'string') return [value];
  const [operator, ...args] = value;
  const outputs = values => values.filter((_, index) => index % 2 === 1 || index === values.length - 1);
  if (operator === 'match') return outputs(args.slice(1)).flatMap(imageIdsIn);
  if (operator === 'case') return outputs(args).flatMap(imageIdsIn);
  if (operator === 'coalesce') return args.flatMap(imageIdsIn);
  if (operator === 'image') return imageIdsIn(args[0]);
  throw new Error(`icon-image expression the test cannot read: ${JSON.stringify(value)}`);
}

const squareRasterizer = (shape, pixelRatio) => {
  const width = Math.round(shape.width * pixelRatio);
  const height = Math.round(shape.height * pixelRatio);
  return { width, height, alpha: new Uint8ClampedArray(width * height).fill(255, 0, width) };
};

const resourceUrls = style => [
  style.glyphs, style.sprite,
  ...Object.values(style.sources).flatMap(source => [source.url, ...(source.tiles ?? [])]),
].filter(url => url !== undefined);

describe('OCC map style', () => {
  it('the style passes the MapLibre style validator with and without the base map (validateStyleMin from @maplibre/maplibre-gl-style-spec)', () => {
    for (const options of [{}, { basemap: false }, { overlays: [STAND_OVERLAY] }, { basemap: false, overlays: [STAND_OVERLAY] }]) {
      expect(validateStyleMin(buildOccStyle(options)), JSON.stringify(Object.keys(options))).toEqual([]);
    }
    // The validator is not a rubber stamp: a broken layer is reported.
    const broken = buildOccStyle();
    broken.layers.find(layer => layer.id === 'base-water').paint['fill-color'] = 42;
    expect(validateStyleMin(broken).length).toBeGreaterThan(0);
  });

  it('every text-font is one of the three Noto Sans stacks and the style has no sprite (a helper fails on a fourth font)', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    expect(FONT_STACKS).toEqual({ regular: ['Noto Sans Regular'], bold: ['Noto Sans Bold'], italic: ['Noto Sans Italic'] });
    expect(style.layers.filter(layer => layer.layout?.['text-font']).length).toBeGreaterThan(5);
    expect(() => assertNotoSansOnly(style)).not.toThrow();
    expect(style).not.toHaveProperty('sprite');

    const withFourthFont = buildOccStyle();
    withFourthFont.layers.find(layer => layer.id === 'base-label-city').layout['text-font'] = ['Noto Sans Medium'];
    expect(() => assertNotoSansOnly(withFourthFont)).toThrow(/base-label-city/);
    const withExpression = buildOccStyle();
    withExpression.layers.find(layer => layer.id === 'base-label-city').layout['text-font'] = ['literal', ['Noto Sans Regular']];
    expect(() => assertNotoSansOnly(withExpression)).toThrow(/base-label-city/);
  });

  it('references OpenFreeMap only through its TileJSON and only tiles.openfreemap.org URLs', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    expect(style.sources[BASEMAP_SOURCE_ID]).toMatchObject({ type: 'vector', url: OPENFREEMAP_TILEJSON });
    expect(style.sources[BASEMAP_SOURCE_ID]).not.toHaveProperty('tiles');
    expect(OPENFREEMAP_TILEJSON).toBe('https://tiles.openfreemap.org/planet');
    expect(style.glyphs).toBe(GLYPHS_URL);
    expect(GLYPHS_URL).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    const urls = resourceUrls(style);
    expect(urls).toEqual([GLYPHS_URL, OPENFREEMAP_TILEJSON]);
    for (const url of urls) expect(new URL(url.replace(/[{}]/g, '')).origin).toBe('https://tiles.openfreemap.org');
    expect(resourceUrls(buildOccStyle({ basemap: false }))).toEqual([GLYPHS_URL]);
  });

  it('keeps the slot order and places every overlay layer inside its slot', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    const ids = style.layers.map(layer => layer.id);
    const markers = SLOT_ORDER.map(slotMarkerId);
    expect(ids.filter(id => id.startsWith('slot-'))).toEqual(markers);
    for (const marker of markers) {
      expect(style.layers.find(layer => layer.id === marker)).toMatchObject({
        type: 'background', layout: { visibility: 'none' }, metadata: { 'occ:group': SLOT_GROUP },
      });
    }
    style.layers.forEach((layer, index) => {
      const slot = layer.metadata['occ:slot'];
      const start = ids.indexOf(slotMarkerId(slot));
      const next = nextSlot(slot);
      const end = next === null ? ids.length : ids.indexOf(slotMarkerId(next));
      expect(index >= start && index < end, `${layer.id} in ${slot}`).toBe(true);
    });
    for (const { id, slot } of STAND_OVERLAY.layers) expect(style.layers.find(layer => layer.id === id).metadata['occ:slot']).toBe(slot);
    // Inside a slot the overlay keeps its order, above the slot marker.
    expect(ids.indexOf('occ-stands-slab')).toBe(ids.indexOf('slot-stands') + 1);
    expect(ids.indexOf('occ-stands-frame')).toBe(ids.indexOf('occ-stands-slab') + 1);
    // The base map sits in its own slots.
    for (const [id, slot] of [['base-water', 'base'], ['base-label-country', 'baseLabels'], ['airfield-runway', 'airfield'], ['building-3d', 'extrusions']]) {
      expect(style.layers.find(layer => layer.id === id).metadata['occ:slot']).toBe(slot);
    }
    expect(nextSlot('base')).toBe('shade');
    expect(nextSlot('models')).toBe('standLabels');
    expect(nextSlot('selection')).toBeNull();
    expect(() => nextSlot('ramp')).toThrow(RangeError);
    expect(() => slotMarkerId('ramp')).toThrow(RangeError);
  });

  it('every layer carries occ:group and layer and source ids are unique', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    for (const layer of style.layers) expect(typeof layer.metadata?.['occ:group'], layer.id).toBe('string');
    const ids = style.layers.map(layer => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groupLayerIds(style, 'stands')).toEqual(['occ-stands-slab', 'occ-stands-frame', 'occ-stand-codes']);
    expect(groupLayerIds(style, 'buildings-3d')).toEqual(['building-3d']);
    expect(style.layers.find(layer => layer.id === 'building-3d').layout.visibility).toBe('none');
    // Overlay sources are born empty; the engine fills them.
    expect(style.sources['occ-stands']).toEqual({
      type: 'geojson', promoteId: 'code', data: { type: 'FeatureCollection', features: [] },
    });

    const layerOf = (overrides, slot = 'stands') => ({
      sources: {}, layers: [{ slot, id: 'extra', type: 'background', metadata: { 'occ:group': 'extra' }, ...overrides }],
    });
    expect(() => buildOccStyle({ overlays: [layerOf({ id: 'base-water' })] })).toThrow(/defined twice/);
    expect(() => buildOccStyle({ overlays: [STAND_OVERLAY, STAND_OVERLAY] })).toThrow(/defined twice/);
    expect(() => buildOccStyle({ overlays: [layerOf({ metadata: {} })] })).toThrow(/occ:group/);
    expect(() => buildOccStyle({ overlays: [layerOf({}, 'ramp')] })).toThrow(/unknown slot/);
    expect(() => buildOccStyle({ overlays: [layerOf({ metadata: { 'occ:group': 'x', 'occ:minThreshold': 'z15' } })] }))
      .toThrow(/unknown threshold/);
    expect(() => buildOccStyle({ overlays: [layerOf({ type: 'circle', source: 'nowhere' })] })).toThrow(/source/);
    expect(() => buildOccStyle({ overlays: [{ sources: { raster: { type: 'raster', tiles: [] } }, layers: [] }] }))
      .toThrow(/GeoJSON/);
  });

  it('without the base map there is no vector source and the tile aeroway is gone', () => {
    const style = buildOccStyle({ basemap: false, overlays: [STAND_OVERLAY] });
    expect(style.sources).not.toHaveProperty(BASEMAP_SOURCE_ID);
    expect(Object.values(style.sources).every(source => source.type === 'geojson')).toBe(true);
    expect(style.layers.filter(layer => layer.source === BASEMAP_SOURCE_ID)).toEqual([]);
    expect(style.layers.filter(layer => layer['source-layer'] === 'aeroway')).toEqual([]);
    expect(style.layers.find(layer => layer.id === 'base-background').paint['background-color']).toBe(BASEMAP_COLORS.land);
    expect(style.layers.filter(layer => !layer.id.startsWith('slot-')).map(layer => layer.id))
      .toEqual(['base-background', ...OVERLAY_IDS]);

    const withBasemap = buildOccStyle();
    expect(withBasemap.layers.filter(layer => layer['source-layer'] === 'aeroway').map(layer => layer.id)).toEqual([
      'airfield-apron', 'airfield-runway-area', 'airfield-taxiway', 'airfield-runway', 'airfield-runway-ref',
    ]);
    // Until the MDPC dataset arrives (PR M3) the tile aeroway also draws the ramp: no maximum zoom.
    expect(withBasemap.layers.filter(layer => layer['source-layer'] === 'aeroway' && layer.maxzoom !== undefined)).toEqual([]);
  });

  it('overlay colours are OCC palette values and base-map colours come from mapTheme (parity)', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    const tokenValues = new Set(Object.values(OCC_PALETTE));
    const baseValues = new Set(Object.values(BASEMAP_COLORS));
    for (const layer of style.layers) {
      for (const colour of paintColours(layer)) {
        if (OVERLAY_IDS.has(layer.id)) expect(tokenValues.has(colour), `${layer.id}: ${colour}`).toBe(true);
        else expect(baseValues.has(colour) || tokenValues.has(colour), `${layer.id}: ${colour}`).toBe(true);
      }
    }
    // The only token a tile layer paints is the runway designator, in --occ-muted.
    const tokensOnTiles = style.layers.filter(layer => !OVERLAY_IDS.has(layer.id))
      .flatMap(layer => paintColours(layer).filter(colour => !baseValues.has(colour)).map(colour => [layer.id, colour]));
    expect(tokensOnTiles).toEqual([['airfield-runway-ref', occColor('muted')]]);

    const paintOf = (id, property) => style.layers.find(layer => layer.id === id).paint[property];
    expect(paintOf('base-background', 'background-color')).toBe(BASEMAP_COLORS.land);
    expect(paintOf('base-water', 'fill-color')).toBe(BASEMAP_COLORS.sea);
    expect(paintOf('base-coastline', 'line-color')).toBe(BASEMAP_COLORS.coastline);
    expect(paintOf('base-boundary-country', 'line-color')).toBe(BASEMAP_COLORS.boundary);
    expect(paintOf('base-road', 'line-color')).toBe(BASEMAP_COLORS.road);
    expect(paintOf('base-road-major', 'line-color')).toBe(BASEMAP_COLORS.roadMajor);
    expect(paintOf('base-building', 'fill-color')).toBe(BASEMAP_COLORS.building);
    expect(paintOf('building-3d', 'fill-extrusion-color')).toBe(BASEMAP_COLORS.buildingExtrusion);
    expect(paintOf('airfield-runway', 'line-color')).toBe(BASEMAP_COLORS.runway);
    expect(paintOf('airfield-taxiway', 'line-color')).toBe(BASEMAP_COLORS.taxiway);
    expect(paintOf('airfield-apron', 'fill-color')).toBe(BASEMAP_COLORS.apron);
    expect(paintOf('base-label-city', 'text-color')).toBe(BASEMAP_COLORS.placeLabel);
    expect(paintOf('base-label-water', 'text-color')).toBe(BASEMAP_COLORS.waterLabel);
    expect(paintOf('base-label-water', 'text-halo-color')).toBe(BASEMAP_COLORS.labelHalo);

    // basemapLayers draws whatever palette it is given: no base-map colour is written into the layers.
    const marked = Object.fromEntries(Object.keys(BASEMAP_COLORS).map((key, index) => [key, `#0000${String(index).padStart(2, '0')}`]));
    const markedValues = new Set(Object.values(marked));
    const drawn = Object.values(basemapLayers({ colors: marked })).flat().flatMap(paintColours);
    expect(drawn.filter(colour => !markedValues.has(colour))).toEqual([occColor('muted')]);
  });

  it('every icon-image the style names resolves through createImageResolver', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    const named = [...new Set(style.layers.flatMap(layer => {
      const value = layer.layout?.['icon-image'];
      return value === undefined ? [] : imageIdsIn(value);
    }))];
    expect(named).toEqual([
      'airport-arp', 'stand-slab', 'stand-frame-dash-4-3', 'stand-frame-dash-2-2', 'stand-frame-dot-1-3',
      'stand-frame-solid', 'stand-selected',
    ]);
    const resolve = createImageResolver({ rasterize: squareRasterizer });
    for (const id of named) expect(resolve(id), id).toMatchObject({ sdf: true });
    // SDF images cannot be patterns, so the style uses none.
    const patterns = style.layers.flatMap(layer => Object.keys(layer.paint ?? {}).filter(property => property.endsWith('-pattern')));
    expect(patterns).toEqual([]);
  });
});
