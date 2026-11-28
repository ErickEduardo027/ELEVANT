import { occThemeColor } from '../../occ-ui/occPalette';
import { BASEMAP_SOURCE_ID, FONT_STACKS, basemapLayers } from './basemapLayers';
import { basemapThemeColor } from './mapTheme';

// The one style document of the OCC maps, built in code and handed to the map as an object: the NOC base map over
// the OpenFreeMap vector tiles, an invisible marker at the base of every slot, and the overlay layers of the screen
// with their GeoJSON sources born empty (the map engine fills them) and, from PR M8, the raster sources of the
// satellite images with their own https tiles (the engine pins them to the time of the image). `theme` (dark by
// default, or light) picks the base-map colours (mapTheme.js) and the OCC palette: the overlays are written with the
// dark palette, and every colour of theirs is carried to the same token (or base-map key) of the theme. There is no
// sprite: icons are generated as SDF images (mapImages.js), and the style is never swapped after start: a theme change
// re-creates the map (OccMap).

export { BASEMAP_SOURCE_ID, FONT_STACKS };

/** The OpenFreeMap planet as TileJSON: its dated tile path changes with every planet build. */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

/** The glyph server of OpenFreeMap; it only serves the three stacks of FONT_STACKS. */
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// The credit of the base map's data and tiles. It replaces the HTML of the remote TileJSON on the vector source, and
// core/attribution.js puts the same text first in every map's credit line: MapLibre drops a credit that another one
// contains, so it shows once.
const creditLink = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
export const OPENFREEMAP_ATTRIBUTION = [
  creditLink('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors'),
  creditLink('https://openfreemap.org', 'OpenFreeMap'),
  creditLink('https://www.openmaptiles.org/', '© OpenMapTiles'),
].join(' · ');

/** Slots from the bottom of the map to the top. */
export const SLOT_ORDER = Object.freeze([
  'base', 'shade', 'weather', 'reference', 'baseLabels', 'airfield', 'stands', 'routes', 'footprints', 'extrusions',
  'models', 'standLabels', 'traffic', 'selection',
]);

/** The group of the slot markers: never shown, never toggled. */
export const SLOT_GROUP = 'slot';

/**
 * Zoom thresholds derived at run time from the fitted views (contracts 2.3), named in layer metadata: `polygons`,
 * `codes` and `threeLine` for the stands, `airfield`, the boundary of the Aeródromo view, where the airfield of the
 * own dataset takes over from the tiles, and `approach`, the boundary between Región and Aproximación, where the range
 * rings of one view give way to the other's (PR M8).
 */
export const THRESHOLD_NAMES = Object.freeze(['polygons', 'codes', 'threeLine', 'airfield', 'approach']);

const THRESHOLD_KEYS = ['occ:minThreshold', 'occ:maxThreshold'];
const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) });

/**
 * The deepest zoom MapLibre cuts the GeoJSON overlays into tiles at (PR M2, 2026-11-28); beyond it those tiles are drawn
 * overzoomed. MapLibre's own default (18) cut «Seguir en 3D» (zoom 18.3, pitch 72) into some 25 tiles per source, and
 * the CPU profile had MapLibre choosing, clipping and drawing those tiles of 11 sources as the largest cost of the
 * main thread. At 16 a tile of the airfield is about 580 m wide, cut into 8192 units of 7 cm: under a third of a pixel
 * at the map's deepest zoom (19.5), so nothing drawn moves. A source that names its own `maxzoom` keeps it.
 */
export const OVERLAY_MAX_ZOOM = 16;

const RGBA = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/;
const hexOf = channels => `#${channels.map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;

// One colour written with the dark palette or the dark base map, as `theme` paints it. An `rgba()` colour (the fading
// trails) keeps its alpha.
function themeColour(value, theme) {
  const rgba = RGBA.exec(value);
  if (rgba === null) return basemapThemeColor(occThemeColor(value, theme), theme);
  const swapped = themeColour(hexOf(rgba.slice(1, 4)), theme);
  if (swapped === hexOf(rgba.slice(1, 4))) return value;
  const [red, green, blue] = [1, 3, 5].map(start => Number.parseInt(swapped.slice(start, start + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${rgba[4]})`;
}

// Every string of a paint or layout value (expressions included), carried to `theme`.
function themed(value, theme) {
  if (typeof value === 'string') return themeColour(value, theme);
  if (Array.isArray(value)) return value.map(item => themed(item, theme));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, themed(item, theme)]));
  }
  return value;
}

const themedLayer = (layer, theme) => (theme !== 'light' ? layer : {
  ...layer,
  ...(layer.paint ? { paint: themed(layer.paint, theme) } : {}),
  // A formatted label carries its colours in the layout (`format` sections).
  ...(layer.layout ? { layout: themed(layer.layout, theme) } : {}),
});

function slotIndex(slot) {
  const index = SLOT_ORDER.indexOf(slot);
  if (index < 0) throw new RangeError(`Unknown map slot: ${String(slot)}`);
  return index;
}

/** The id of the marker layer at the base of a slot. */
export function slotMarkerId(slot) {
  slotIndex(slot);
  return `slot-${slot}`;
}

/** The slot above `slot`, or `null` for the top one. */
export function nextSlot(slot) {
  return SLOT_ORDER[slotIndex(slot) + 1] ?? null;
}

/** The ids of the layers of a style whose `metadata['occ:group']` is `group`, in drawing order. */
export function groupLayerIds(style, group) {
  return (style?.layers ?? []).filter(layer => layer.metadata?.['occ:group'] === group).map(layer => layer.id);
}

const slotMarker = slot => ({
  id: slotMarkerId(slot),
  type: 'background',
  layout: { visibility: 'none' },
  paint: { 'background-opacity': 0 },
  metadata: { 'occ:group': SLOT_GROUP, 'occ:slot': slot },
});

function overlayLayerProblem(layer, slot) {
  if (typeof layer.id !== 'string' || layer.id === '') return 'has no id';
  if (!SLOT_ORDER.includes(slot)) return `names an unknown slot: ${String(slot)}`;
  if (typeof layer.metadata?.['occ:group'] !== 'string') return 'has no occ:group in its metadata';
  for (const key of THRESHOLD_KEYS) {
    const name = layer.metadata[key];
    if (name !== undefined && !THRESHOLD_NAMES.includes(name)) return `names an unknown threshold in ${key}: ${name}`;
  }
  return null;
}

// A raster source of an overlay (PR M8): its tiles are a list of https URL templates, and it has no TileJSON of its own.
const HTTPS_TILE = /^https:\/\/[^/\s]+\/\S*$/;
const isHttpsRaster = source => source?.type === 'raster' && source.url === undefined && Array.isArray(source.tiles)
  && source.tiles.length > 0 && source.tiles.every(tile => typeof tile === 'string' && HTTPS_TILE.test(tile));

/**
 * Builds the style. `basemap: false` leaves out the vector source and every tile layer (the land colour stays as the
 * background), which the map lab uses to render without the network. An overlay is
 * `{ sources: { id: GeoJSONSourceSpecification }, layers: [{ slot, ...LayerSpecification }] }`: every layer names
 * its slot and its `metadata['occ:group']`, may name a threshold in `occ:minThreshold` / `occ:maxThreshold`, and
 * keeps its order inside the slot. A source is GeoJSON, born empty, or (PR M8) a raster with its https `tiles`, taken
 * as given. Duplicate ids, other sources, unknown slots or thresholds and missing sources throw.
 */
export function buildOccStyle({ basemap = true, overlays = [], theme = 'dark' } = {}) {
  const sources = {};
  const slots = new Map(SLOT_ORDER.map(slot => [slot, []]));
  const layers = basemapLayers({ theme });

  if (basemap) {
    sources[BASEMAP_SOURCE_ID] = { type: 'vector', url: OPENFREEMAP_TILEJSON, attribution: OPENFREEMAP_ATTRIBUTION };
    slots.get('base').push(...layers.base);
    slots.get('baseLabels').push(...layers.baseLabels);
    slots.get('airfield').push(...layers.airfield);
    slots.get('extrusions').push(...layers.extrusions);
  } else {
    slots.get('base').push(...layers.base.filter(layer => layer.source === undefined));
  }

  for (const overlay of overlays) {
    for (const [id, source] of Object.entries(overlay?.sources ?? {})) {
      if (Object.hasOwn(sources, id)) throw new Error(`Map source ${id} is defined twice`);
      // A raster of PR M8 (the satellite images) is taken as given, with its own https tiles and no data.
      if (isHttpsRaster(source)) {
        sources[id] = { ...source, tiles: [...source.tiles] };
        continue;
      }
      if (source?.type !== 'geojson') {
        throw new Error(`Overlay source ${id} must be a GeoJSON source or a raster source with https tiles`);
      }
      sources[id] = { maxzoom: OVERLAY_MAX_ZOOM, ...source, data: EMPTY_COLLECTION };
    }
  }
  for (const overlay of overlays) {
    for (const { slot, ...layer } of overlay?.layers ?? []) {
      const problem = overlayLayerProblem(layer, slot);
      if (problem !== null) throw new Error(`Overlay layer ${String(layer.id)} ${problem}`);
      if (layer.source !== undefined && !Object.hasOwn(sources, layer.source)) {
        throw new Error(`Overlay layer ${layer.id} reads a source the style does not have: ${layer.source}`);
      }
      slots.get(slot).push(themedLayer(layer, theme));
    }
  }

  const ordered = SLOT_ORDER.flatMap(slot => [
    slotMarker(slot),
    ...slots.get(slot).map(layer => ({ ...layer, metadata: { ...layer.metadata, 'occ:slot': slot } })),
  ]);
  const seen = new Set();
  for (const { id } of ordered) {
    if (seen.has(id)) throw new Error(`Map layer ${id} is defined twice`);
    seen.add(id);
  }

  // A plain copy: nothing frozen or shared with the constants reaches MapLibre or the caller.
  return JSON.parse(JSON.stringify({ version: 8, name: 'OCC', glyphs: GLYPHS_URL, sources, layers: ordered }));
}
