import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { OCC_PALETTES, OCC_THEMES, occColor } from '../../occ-ui/occPalette';
import { qaPoint } from '../testing/mapFixtures';
import { basemapLayers } from './basemapLayers';
import { createImageResolver } from './mapImages';
import { BASEMAP_COLORS, BASEMAP_THEMES } from './mapTheme';
import {
  BASEMAP_SOURCE_ID, FONT_STACKS, GLYPHS_URL, OPENFREEMAP_TILEJSON, SLOT_GROUP, SLOT_ORDER, THRESHOLD_NAMES,
  GLOBE_MERCATOR_ZOOM, PROJECTIONS, buildOccStyle, globeSky, groupLayerIds, nextSlot, slotMarkerId,
} from './occStyle';
import { MAP_COLORS } from './mapColors';

// An overlay shaped like the stand polygons of the positions map: layers in three slots, state colours from the OCC
// palette (one of them see-through), an icon and a pattern from mapImages.js, a pick target and a derived threshold.
// A stand box of the invented airport of the fixtures: no stand of Punta Cana is written by hand.
const STAND_BOX = [qaPoint(0, 0), qaPoint(40, 0), qaPoint(40, 50), qaPoint(0, 50), qaPoint(0, 0)];
const STAND_OVERLAY = {
  sources: {
    'occ-stands': {
      type: 'geojson',
      promoteId: 'code',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: 'A1' }, geometry: { type: 'Polygon', coordinates: [STAND_BOX] } }] },
    },
  },
  layers: [
    {
      slot: 'stands',
      id: 'occ-stands-slab',
      type: 'fill',
      source: 'occ-stands',
      filter: ['match', ['get', 'state'], ['arriving', 'occupied', 'releasing'], true, false],
      paint: {
        'fill-color': ['match', ['get', 'state'], 'arriving', occColor('arriving-fill'), occColor('panel-raised')],
      },
      metadata: { 'occ:group': 'stands', 'occ:pick': 'stand', 'occ:pickId': 'code' },
    },
    {
      slot: 'stands',
      id: 'occ-stands-frame',
      type: 'line',
      source: 'occ-stands',
      paint: {
        'line-color': ['match', ['get', 'state'], 'planned', occColor('muted'), occColor('line-strong')],
        'line-width': 1.5,
        'line-dasharray': [2, 2],
      },
      metadata: { 'occ:group': 'stands' },
    },
    {
      slot: 'stands',
      id: 'occ-stands-hatch',
      type: 'fill',
      source: 'occ-stands',
      filter: ['==', ['get', 'state'], 'disabled'],
      paint: { 'fill-pattern': 'stand-hatch-pattern' },
      metadata: { 'occ:group': 'stands' },
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
      layout: { 'icon-image': 'glyph-aircraft', 'icon-allow-overlap': true },
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
    for (const options of [{}, { basemap: false }, { overlays: [STAND_OVERLAY] }, { basemap: false, overlays: [STAND_OVERLAY] },
      { theme: 'light', overlays: [STAND_OVERLAY] }]) {
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
    expect(groupLayerIds(style, 'stands')).toEqual(['occ-stands-slab', 'occ-stands-frame', 'occ-stands-hatch', 'occ-stand-codes']);
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

  it('accepts raster overlay sources with https tiles and rejects other types', () => {
    // A satellite image of PR M8: its own https tiles, taken as given, with no data; its layer in the weather slot.
    const tiles = ['https://gibs.example/wmts/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'];
    const raster = (source, layer = {}) => ({
      sources: { clouds: source },
      layers: [{ slot: 'weather', id: 'clouds-image', type: 'raster', source: 'clouds', metadata: { 'occ:group': 'weather.goes' },
        ...layer }],
    });
    const style = buildOccStyle({ overlays: [raster({ type: 'raster', tiles, tileSize: 256, maxzoom: 6, attribution: 'NASA GIBS' })] });
    expect(style.sources.clouds).toEqual({ type: 'raster', tiles, tileSize: 256, maxzoom: 6, attribution: 'NASA GIBS' });
    expect(style.layers.map(layer => layer.id).indexOf('clouds-image'))
      .toBe(style.layers.map(layer => layer.id).indexOf('slot-weather') + 1);
    expect(validateStyleMin(style)).toEqual([]);
    // The tiles are copied: the style never shares an array with its overlay.
    expect(style.sources.clouds.tiles).not.toBe(tiles);
    // Only https tiles, at least one, and no TileJSON of its own; a vector, image or video source is refused too.
    for (const source of [
      { type: 'raster', tiles: [] },
      { type: 'raster', tiles: ['http://gibs.example/{z}/{x}/{y}.png'] },
      { type: 'raster', tiles: ['//gibs.example/{z}/{x}/{y}.png'] },
      { type: 'raster', tiles: [42] },
      { type: 'raster', url: 'https://gibs.example/tiles.json' },
      { type: 'raster', url: 'https://gibs.example/tiles.json', tiles },
      { type: 'vector', tiles },
      { type: 'image', url: 'https://gibs.example/a.png', coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    ]) {
      expect(() => buildOccStyle({ overlays: [raster(source)] }), JSON.stringify(source))
        .toThrow(/must be a GeoJSON source or a raster source with https tiles/);
    }
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
  });

  it('the tile aeroway ends at the derived airfield threshold (metadata) and keeps no fixed maxzoom', () => {
    // The boundary of Aeródromo for the airfield, and from PR M8 the boundary of Aproximación for the range rings.
    expect(THRESHOLD_NAMES).toEqual(['polygons', 'codes', 'threeLine', 'airfield', 'approach']);
    const style = buildOccStyle();
    const aeroway = style.layers.filter(layer => layer['source-layer'] === 'aeroway');
    expect(aeroway).toHaveLength(5);
    for (const layer of aeroway) {
      // The engine sets the range from the fitted views (contracts 2.3): no zoom is written in the style.
      expect(layer.metadata, layer.id).toEqual({ 'occ:group': 'airfield', 'occ:maxThreshold': 'airfield', 'occ:slot': 'airfield' });
      expect(layer, layer.id).not.toHaveProperty('maxzoom');
    }
    // The 3D buildings of the tiles end there too (M9, 2026-11-27): from the airfield on, the airport's own raised
    // terminals and jet bridges (style/airfieldLayers.js) take over, and the tile buildings would rise through them.
    const tileBuildings = style.layers.find(layer => layer.id === 'building-3d');
    expect(tileBuildings.metadata).toEqual({ 'occ:group': 'buildings-3d', 'occ:maxThreshold': 'airfield', 'occ:slot': 'extrusions' });
    expect(tileBuildings.minzoom).toBe(13);
    // Nothing else of the base map names a threshold: the land, the roads and the labels keep every zoom.
    const others = style.layers.filter(layer => layer['source-layer'] !== 'aeroway' && layer.id !== 'building-3d'
      && !layer.id.startsWith('slot-'));
    expect(others.filter(layer => layer.metadata['occ:minThreshold'] || layer.metadata['occ:maxThreshold'])).toEqual([]);
    // An overlay may start at that threshold too.
    const overlay = {
      sources: { extra: { type: 'geojson' } },
      layers: [{ slot: 'airfield', id: 'extra', type: 'line', source: 'extra', metadata: { 'occ:group': 'x', 'occ:minThreshold': 'airfield' } }],
    };
    expect(validateStyleMin(buildOccStyle({ overlays: [overlay] }))).toEqual([]);
    const rings = { ...overlay, layers: [{ ...overlay.layers[0], metadata: { 'occ:group': 'x', 'occ:maxThreshold': 'approach' } }] };
    expect(validateStyleMin(buildOccStyle({ overlays: [rings] }))).toEqual([]);
    const unknown = { ...overlay, layers: [{ ...overlay.layers[0], metadata: { 'occ:group': 'x', 'occ:maxThreshold': 'region' } }] };
    expect(() => buildOccStyle({ overlays: [unknown] })).toThrow(/unknown threshold in occ:maxThreshold: region/);
  });

  it.each(OCC_THEMES)('overlay colours are OCC palette values and base-map colours come from mapTheme (%s)', theme => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY], theme });
    const colours = BASEMAP_THEMES[theme];
    const tokenValues = new Set(Object.values(OCC_PALETTES[theme]));
    const baseValues = new Set(Object.values(colours));
    for (const layer of style.layers) {
      for (const colour of paintColours(layer)) {
        if (OVERLAY_IDS.has(layer.id)) expect(tokenValues.has(colour), `${layer.id}: ${colour}`).toBe(true);
        else expect(baseValues.has(colour) || tokenValues.has(colour), `${layer.id}: ${colour}`).toBe(true);
      }
    }
    // The only token a tile layer paints is the runway designator, in --occ-text (it reads on the lighter runway).
    const tokensOnTiles = style.layers.filter(layer => !OVERLAY_IDS.has(layer.id))
      .flatMap(layer => paintColours(layer).filter(colour => !baseValues.has(colour)).map(colour => [layer.id, colour]));
    expect(tokensOnTiles).toEqual([['airfield-runway-ref', occColor('text', theme)]]);

    const paintOf = (id, property) => style.layers.find(layer => layer.id === id).paint[property];
    expect(paintOf('base-background', 'background-color')).toBe(colours.land);
    expect(paintOf('base-water', 'fill-color')).toBe(colours.sea);
    expect(paintOf('base-coastline', 'line-color')).toBe(colours.coastline);
    expect(paintOf('base-boundary-country', 'line-color')).toBe(colours.boundary);
    expect(paintOf('base-road', 'line-color')).toBe(colours.road);
    expect(paintOf('base-road-major', 'line-color')).toBe(colours.roadMajor);
    expect(paintOf('base-building', 'fill-color')).toBe(colours.building);
    expect(paintOf('building-3d', 'fill-extrusion-color')).toBe(colours.buildingExtrusion);
    expect(paintOf('airfield-runway', 'line-color')).toBe(colours.runway);
    expect(paintOf('airfield-taxiway', 'line-color')).toBe(colours.taxiway);
    expect(paintOf('airfield-apron', 'fill-color')).toBe(colours.apron);
    expect(paintOf('base-label-city', 'text-color')).toBe(colours.placeLabel);
    expect(paintOf('base-label-water', 'text-color')).toBe(colours.waterLabel);
    expect(paintOf('base-label-water', 'text-halo-color')).toBe(colours.labelHalo);

  });

  it('carries every overlay colour of the dark palette, an rgba() trail included, to the light theme', () => {
    const accent = OCC_PALETTES.dark['--occ-accent'];
    const [red, green, blue] = [1, 3, 5].map(index => Number.parseInt(accent.slice(index, index + 2), 16));
    const overlay = {
      sources: { trail: { type: 'geojson' } },
      layers: [{
        slot: 'traffic', id: 'trail', type: 'line', source: 'trail', metadata: { 'occ:group': 'traffic' },
        paint: { 'line-color': ['case', ['get', 'x'], `rgba(${red}, ${green}, ${blue}, 0.5)`, occColor('nav')] },
        layout: { 'text-field': ['format', 'A', { 'text-color': occColor('muted') }] },
      }],
    };
    const paint = theme => buildOccStyle({ basemap: false, overlays: [overlay], theme }).layers.find(layer => layer.id === 'trail');
    expect(paint('dark').paint['line-color']).toEqual(overlay.layers[0].paint['line-color']);
    const light = paint('light');
    const lightAccent = OCC_PALETTES.light['--occ-accent'];
    const channels = [1, 3, 5].map(index => Number.parseInt(lightAccent.slice(index, index + 2), 16));
    expect(light.paint['line-color']).toEqual(['case', ['get', 'x'], `rgba(${channels.join(', ')}, 0.5)`, occColor('nav', 'light')]);
    expect(light.layout['text-field'][2]).toEqual({ 'text-color': occColor('muted', 'light') });
    // The base map of the light theme is its own.
    const background = buildOccStyle({ theme: 'light' }).layers.find(layer => layer.id === 'base-background');
    expect(background.paint['background-color']).toBe(BASEMAP_THEMES.light.land);
  });

  it('basemapLayers draws whatever palette it is given', () => {
    // basemapLayers draws whatever palette it is given: no base-map colour is written into the layers.
    const marked = Object.fromEntries(Object.keys(BASEMAP_COLORS).map((key, index) => [key, `#0000${String(index).padStart(2, '0')}`]));
    const markedValues = new Set(Object.values(marked));
    const drawn = Object.values(basemapLayers({ colors: marked })).flat().flatMap(paintColours);
    expect(drawn.filter(colour => !markedValues.has(colour))).toEqual([occColor('text')]);
  });

  it('every icon-image and fill-pattern the style names resolves through createImageResolver', () => {
    const style = buildOccStyle({ overlays: [STAND_OVERLAY] });
    const named = [...new Set(style.layers.flatMap(layer => {
      const value = layer.layout?.['icon-image'];
      return value === undefined ? [] : imageIdsIn(value);
    }))];
    expect(named).toEqual(['airport-arp', 'glyph-aircraft']);
    const resolve = createImageResolver({ rasterize: squareRasterizer });
    for (const id of named) expect(resolve(id), id).toMatchObject({ sdf: true });
    // An SDF cannot be a pattern: a pattern the style names is an image painted in its token.
    const patterns = style.layers.flatMap(layer => Object.entries(layer.paint ?? {})
      .filter(([property]) => property.endsWith('-pattern')).map(([, value]) => value));
    expect(patterns).toEqual(['stand-hatch-pattern']);
    for (const id of patterns) expect(resolve(id), id).toMatchObject({ sdf: false });
  });

  it('a screen opts into the globe at start (M8): projection globe and a themed atmosphere; Mercator names neither', () => {
    expect(PROJECTIONS).toEqual(['mercator', 'globe']);
    expect(GLOBE_MERCATOR_ZOOM).toBe(12);
    const mercator = buildOccStyle({ overlays: [STAND_OVERLAY] });
    expect(mercator).not.toHaveProperty('projection');
    expect(mercator).not.toHaveProperty('sky');
    expect(buildOccStyle({ projection: 'mercator' })).toEqual(buildOccStyle());

    for (const theme of ['dark', 'light']) {
      const globe = buildOccStyle({ overlays: [STAND_OVERLAY], theme, projection: 'globe' });
      expect(validateStyleMin(globe), theme).toEqual([]);
      expect(globe.projection).toEqual({ type: 'globe' });
      expect(globe.sky).toEqual(globeSky(theme));
      expect(globe.sky['sky-color']).toBe(MAP_COLORS[theme].sky.space);
      expect(globe.sky['horizon-color']).toBe(MAP_COLORS[theme].sky.horizon);
      expect(globe.sky['fog-color']).toBe(MAP_COLORS[theme].sky.fog);
      // Only the projection and the sky differ: the layers are the same as in Mercator.
      expect(globe.layers).toEqual(buildOccStyle({ overlays: [STAND_OVERLAY], theme }).layers);
    }
    // The atmosphere shows from afar and is gone from zoom 7, before the Región view.
    expect(globeSky()['atmosphere-blend']).toEqual(['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0]);
    expect(globeSky('light')['sky-color']).not.toBe(globeSky('dark')['sky-color']);
    // A globe without the sky, or with one of its own; an unknown projection throws.
    expect(buildOccStyle({ projection: 'globe', sky: false })).not.toHaveProperty('sky');
    expect(buildOccStyle({ projection: 'globe', sky: { 'sky-color': '#000000' } }).sky).toEqual({ 'sky-color': '#000000' });
    expect(buildOccStyle({ sky: { 'sky-color': '#000000' } })).not.toHaveProperty('sky');
    expect(() => buildOccStyle({ projection: 'equal-earth' })).toThrow(/Unknown map projection/);
  });
});
