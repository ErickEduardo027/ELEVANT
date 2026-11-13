import { occColor } from '../../occ-ui/occPalette';
import { BASEMAP_COLORS } from './mapTheme';

// The NOC base map on the OpenMapTiles schema of the OpenFreeMap vector tiles: water, land, coast, borders, the main
// roads (dim, from zoom 8), buildings, a few labels and the airfield as the tiles draw it. No points of interest, no
// road shields, no land cover. Every layer names its group in `metadata['occ:group']`; occStyle.js places the four
// lists in their slots.

/** The vector source of the base map (the id occStyle.js gives the OpenFreeMap TileJSON). */
export const BASEMAP_SOURCE_ID = 'openmaptiles';

// The OpenFreeMap glyph server serves these three stacks and nothing else, so no other font may appear in the style.
export const FONT_STACKS = Object.freeze({
  regular: Object.freeze(['Noto Sans Regular']),
  bold: Object.freeze(['Noto Sans Bold']),
  italic: Object.freeze(['Noto Sans Italic']),
});

const geometryIs = types => ['match', ['geometry-type'], types, true, false];
const IS_POLYGON = geometryIs(['Polygon', 'MultiPolygon']);
const IS_LINE = geometryIs(['LineString', 'MultiLineString']);
const IS_POINT = geometryIs(['Point', 'MultiPoint']);
const classIs = (...classes) => ['match', ['get', 'class'], classes, true, false];
// Spanish names where the tiles carry them, otherwise the local name.
const NAME = ['coalesce', ['get', 'name:es'], ['get', 'name']];
const LABEL_SIZE = 12;

const ROAD_WIDTH = ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.5, 12, 1.2, 16, 4];
const COAST_WIDTH = ['interpolate', ['linear'], ['zoom'], 4, 0.6, 12, 1.2];
// Pavement drawn close to its real width from zoom 14 (a 45 m runway, a 23 m taxiway at 18.6° N).
const RUNWAY_WIDTH = ['interpolate', ['exponential', 2], ['zoom'], 9, 1, 12, 3, 14, 6, 16, 20, 18, 80, 19.5, 226];
const TAXIWAY_WIDTH = ['interpolate', ['exponential', 2], ['zoom'], 12, 1, 14, 2.5, 16, 10, 18, 40, 19.5, 113];

const fonts = stack => [...FONT_STACKS[stack]];
const tileLayer = (sourceLayer, group, layer) => ({
  ...layer,
  source: BASEMAP_SOURCE_ID,
  'source-layer': sourceLayer,
  metadata: { 'occ:group': group },
});

function labelPaint(colour, halo) {
  return { 'text-color': colour, 'text-halo-color': halo, 'text-halo-width': 1.2 };
}

/**
 * The base-map layers by slot: `base` (background, water, coast, borders, roads, flat buildings), `baseLabels`,
 * `airfield` (runways, taxiways and aprons of the tiles) and `extrusions` (3D buildings, hidden until 3D is on).
 * The airfield has no maximum zoom yet: until the own MDPC dataset arrives (PR M3) the tiles draw the ramp too.
 */
export function basemapLayers({ colors = BASEMAP_COLORS } = {}) {
  const base = [
    { id: 'base-background', type: 'background', paint: { 'background-color': colors.land }, metadata: { 'occ:group': 'basemap' } },
    tileLayer('water', 'basemap', { id: 'base-water', type: 'fill', filter: IS_POLYGON, paint: { 'fill-color': colors.sea } }),
    tileLayer('water', 'basemap', {
      id: 'base-coastline',
      type: 'line',
      filter: ['all', IS_POLYGON, classIs('ocean')],
      paint: { 'line-color': colors.coastline, 'line-width': COAST_WIDTH },
    }),
    tileLayer('boundary', 'basemap', {
      id: 'base-boundary-country',
      type: 'line',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': colors.boundary, 'line-width': 1, 'line-dasharray': [3, 2] },
    }),
    tileLayer('boundary', 'basemap', {
      id: 'base-boundary-maritime',
      type: 'line',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 1]],
      paint: { 'line-color': colors.boundary, 'line-width': 0.8, 'line-dasharray': [2, 3] },
    }),
    tileLayer('transportation', 'basemap', {
      id: 'base-road',
      type: 'line',
      minzoom: 8,
      filter: ['all', IS_LINE, classIs('primary')],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.road, 'line-width': ROAD_WIDTH },
    }),
    tileLayer('transportation', 'basemap', {
      id: 'base-road-major',
      type: 'line',
      minzoom: 8,
      filter: ['all', IS_LINE, classIs('motorway', 'trunk')],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.roadMajor, 'line-width': ROAD_WIDTH },
    }),
    tileLayer('building', 'basemap', {
      id: 'base-building',
      type: 'fill',
      minzoom: 13,
      paint: { 'fill-color': colors.building },
    }),
  ];

  const baseLabels = [
    tileLayer('water_name', 'basemap.labels', {
      id: 'base-label-water',
      type: 'symbol',
      filter: IS_POINT,
      layout: { 'text-field': NAME, 'text-font': fonts('italic'), 'text-size': LABEL_SIZE, 'text-max-width': 8 },
      paint: labelPaint(colors.waterLabel, colors.labelHalo),
    }),
    tileLayer('place', 'basemap.labels', {
      id: 'base-label-city',
      type: 'symbol',
      filter: ['all', classIs('city'), ['!=', ['get', 'capital'], 2]],
      layout: { 'text-field': NAME, 'text-font': fonts('regular'), 'text-size': LABEL_SIZE, 'text-max-width': 8 },
      paint: labelPaint(colors.placeLabel, colors.labelHalo),
    }),
    tileLayer('place', 'basemap.labels', {
      id: 'base-label-capital',
      type: 'symbol',
      filter: ['==', ['get', 'capital'], 2],
      layout: { 'text-field': NAME, 'text-font': fonts('bold'), 'text-size': LABEL_SIZE, 'text-max-width': 8 },
      paint: labelPaint(colors.placeLabel, colors.labelHalo),
    }),
    tileLayer('place', 'basemap.labels', {
      id: 'base-label-country',
      type: 'symbol',
      filter: classIs('country'),
      layout: {
        'text-field': NAME,
        'text-font': fonts('bold'),
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 8, 14],
        'text-max-width': 7,
      },
      paint: labelPaint(colors.placeLabel, colors.labelHalo),
    }),
    // Airports by IATA code with the reference-point symbol, for the region and approach views only: from the
    // airfield view on, the airfield itself is on screen.
    tileLayer('aerodrome_label', 'basemap.labels', {
      id: 'base-label-aerodrome',
      type: 'symbol',
      minzoom: 7,
      maxzoom: 12,
      filter: ['has', 'iata'],
      layout: {
        'icon-image': 'airport-arp',
        'text-field': ['get', 'iata'],
        'text-font': fonts('bold'),
        'text-size': LABEL_SIZE,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-optional': true,
      },
      paint: {
        'icon-color': colors.placeLabel,
        'icon-halo-color': colors.labelHalo,
        'icon-halo-width': 1,
        ...labelPaint(colors.placeLabel, colors.labelHalo),
      },
    }),
  ];

  const airfield = [
    tileLayer('aeroway', 'airfield', {
      id: 'airfield-apron',
      type: 'fill',
      minzoom: 11,
      filter: ['all', IS_POLYGON, classIs('apron')],
      paint: { 'fill-color': colors.apron },
    }),
    tileLayer('aeroway', 'airfield', {
      id: 'airfield-runway-area',
      type: 'fill',
      minzoom: 11,
      filter: ['all', IS_POLYGON, classIs('runway')],
      paint: { 'fill-color': colors.runway },
    }),
    tileLayer('aeroway', 'airfield', {
      id: 'airfield-taxiway',
      type: 'line',
      minzoom: 12,
      filter: ['all', IS_LINE, classIs('taxiway')],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': colors.taxiway, 'line-width': TAXIWAY_WIDTH },
    }),
    tileLayer('aeroway', 'airfield', {
      id: 'airfield-runway',
      type: 'line',
      minzoom: 9,
      filter: ['all', IS_LINE, classIs('runway')],
      paint: { 'line-color': colors.runway, 'line-width': RUNWAY_WIDTH },
    }),
    // The designator the map publishes («08/26»); nothing here says whether a runway is in use.
    tileLayer('aeroway', 'airfield', {
      id: 'airfield-runway-ref',
      type: 'symbol',
      minzoom: 13,
      filter: ['all', IS_LINE, classIs('runway'), ['has', 'ref']],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'ref'],
        'text-font': fonts('bold'),
        'text-size': LABEL_SIZE,
      },
      paint: labelPaint(occColor('muted'), colors.labelHalo),
    }),
  ];

  // Only buildings with a published height are raised; none is guessed.
  const extrusions = [
    tileLayer('building', 'buildings-3d', {
      id: 'building-3d',
      type: 'fill-extrusion',
      minzoom: 13,
      filter: ['all', ['has', 'render_height'], ['!=', ['get', 'hide_3d'], true]],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': colors.buildingExtrusion,
        'fill-extrusion-height': ['to-number', ['get', 'render_height']],
        'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'render_min_height']], 0],
        'fill-extrusion-opacity': 0.85,
      },
    }),
  ];

  return { base, baseLabels, airfield, extrusions };
}
