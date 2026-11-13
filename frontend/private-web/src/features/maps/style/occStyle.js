import { BASEMAP_SOURCE_ID, FONT_STACKS, basemapLayers } from './basemapLayers';

// The one style document of the OCC maps, built in code and handed to the map as an object: the NOC base map over
// the OpenFreeMap vector tiles, an invisible marker at the base of every slot, and the overlay layers of the screen
// with their GeoJSON sources born empty (the map engine fills them). There is no theme parameter and no sprite: the
// OCC is dark only, icons are generated as SDF images (mapImages.js), and the style is never swapped after start.

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

/** Zoom thresholds derived at run time from the fitted views (contracts 2.3), named in layer metadata. */
export const THRESHOLD_NAMES = Object.freeze(['polygons', 'codes', 'threeLine']);

const THRESHOLD_KEYS = ['occ:minThreshold', 'occ:maxThreshold'];
const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) });

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

/**
 * Builds the style. `basemap: false` leaves out the vector source and every tile layer (the land colour stays as the
 * background), which the map lab uses to render without the network. An overlay is
 * `{ sources: { id: GeoJSONSourceSpecification }, layers: [{ slot, ...LayerSpecification }] }`: every layer names
 * its slot and its `metadata['occ:group']`, may name a threshold in `occ:minThreshold` / `occ:maxThreshold`, and
 * keeps its order inside the slot. Duplicate ids, unknown slots or thresholds and missing sources throw.
 */
export function buildOccStyle({ basemap = true, overlays = [] } = {}) {
  const sources = {};
  const slots = new Map(SLOT_ORDER.map(slot => [slot, []]));
  const layers = basemapLayers();

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
      if (source?.type !== 'geojson') throw new Error(`Overlay source ${id} must be a GeoJSON source`);
      sources[id] = { ...source, data: EMPTY_COLLECTION };
    }
  }
  for (const overlay of overlays) {
    for (const { slot, ...layer } of overlay?.layers ?? []) {
      const problem = overlayLayerProblem(layer, slot);
      if (problem !== null) throw new Error(`Overlay layer ${String(layer.id)} ${problem}`);
      if (layer.source !== undefined && !Object.hasOwn(sources, layer.source)) {
        throw new Error(`Overlay layer ${layer.id} reads a source the style does not have: ${layer.source}`);
      }
      slots.get(slot).push(layer);
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
