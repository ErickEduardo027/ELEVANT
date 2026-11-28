import { occColor } from '../../occ-ui/occPalette';
import { AIRFIELD_ATTRIBUTION } from '../core/attribution';
import { FONT_STACKS, RUNWAY_WIDTH, TAXIWAY_WIDTH } from './basemapLayers';
import { BASEMAP_COLORS } from './mapTheme';

// The airfield of Punta Cana drawn from its own dataset (PR M3): aprons, terminal buildings, taxiways and taxilanes,
// runways with their designators, threshold bars and dashed centreline, and the holding points as short bars across
// their taxiway, all in the `airfield` slot and from the derived `airfield` threshold (the boundary of the Aeródromo
// view, contracts 2.3); below it the tiles draw the airfield as context (basemapLayers.js). The pavement takes the
// base-map palette (runways a lighter slate than the aprons, the widths of the tiles, so the hand-over shows no jump),
// the markings --occ-text and the taxiway names a dim token: no hue. The runway is drawn over the ends of the taxiways
// that meet it, so they join it cleanly. Runways and taxiways are the pick targets of the map tooltip. Pure: OccMap adds
// the overlay and fills its source with airport/airfieldFeatures.js.
//
// With `structures` (lane M9, Mapa de posiciones) the overlay also draws the airport in 3D from a second source that
// OccMap fills with airport/structures.js: the taxiway pavement at its estimated width under the taxiway lines, and in
// the `extrusions` slot the terminals raised to their estimated height and the jet bridges of B20–B26 (a tunnel and its
// rotunda on their supports), with each terminal named and its height labelled «est.». Every size there is an estimate.

export const AIRFIELD_SOURCE = 'occ-airfield';
export const AIRFIELD_GROUP = 'airfield';
export const AIRFIELD_SLOT = 'airfield';
/** The source of the airport's structures (M9): GeoJSON from airport/structures.js. */
export const AIRFIELD_STRUCTURES_SOURCE = 'occ-airfield-structures';
/** The slot of the raised structures: with the 3D buildings of the base map, under the aircraft models. */
export const AIRFIELD_EXTRUSION_SLOT = 'extrusions';

/**
 * What the legend lists of the airfield, in its order (owner request: only what is on screen). `taxiwayPavement`,
 * `building` and `jetBridge` are the structures of M9; a raised terminal stands in for its flat footprint.
 */
export const AIRFIELD_LEGEND_KINDS = Object.freeze([
  'runway', 'taxiway', 'taxiwayPavement', 'holdBar', 'apron', 'terminal', 'building', 'jetBridge',
]);

// The legend item each kind of feature belongs to: the markings are part of their runway, a taxilane is a taxiway.
const LEGEND_KIND = Object.freeze({
  runway: 'runway',
  runwayCentreline: 'runway',
  thresholdBar: 'runway',
  designator: 'runway',
  taxiway: 'taxiway',
  taxilane: 'taxiway',
  holdBar: 'holdBar',
  apron: 'apron',
  terminal: 'terminal',
  taxiwayPavement: 'taxiwayPavement',
  building: 'building',
  jetBridgeTunnel: 'jetBridge',
  jetBridgeRotunda: 'jetBridge',
});

const KIND = ['get', 'kind'];
const kindIs = (...kinds) => ['match', KIND, kinds, true, false];
const IS_POLYGON = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const IS_LINE = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const fonts = stack => [...FONT_STACKS[stack]];
const LABEL_SIZE = 12;
// Every layer of the airfield starts at the derived airfield threshold.
const FROM_AIRFIELD = Object.freeze({ 'occ:group': AIRFIELD_GROUP, 'occ:minThreshold': 'airfield' });

// The markings stay hairlines while the field is small and thicken as it grows.
const MARKING_WIDTH = ['interpolate', ['exponential', 2], ['zoom'], 13, 0.75, 16, 1.5, 18, 3];
const BAR_WIDTH = ['interpolate', ['exponential', 2], ['zoom'], 13, 1, 16, 2, 18, 4];
// The digits painted at a runway end are about 9 m tall: never smaller than the 12 px floor of the OCC, life size close in.
const DESIGNATOR_SIZE = ['interpolate', ['exponential', 2], ['zoom'], 16.5, LABEL_SIZE, 19.5, 44, 22, 249];

// The structures (M9). The jet bridges in a slate of the OCC, apart from the terminals in the base-map colour; both
// lit by MapLibre's vertical gradient (darker at the foot), opaque so the overlaps of the footprints show no seam.
const EXTRUSION_PAINT = Object.freeze({
  'fill-extrusion-base': ['to-number', ['get', 'baseM'], 0],
  'fill-extrusion-height': ['to-number', ['get', 'heightM'], 0],
  'fill-extrusion-opacity': 1,
  'fill-extrusion-vertical-gradient': true,
});

function airfieldLayer(id, type, filter, {
  layout, paint, pick, slot = AIRFIELD_SLOT, source = AIRFIELD_SOURCE,
} = {}) {
  return {
    slot,
    id,
    type,
    source,
    filter,
    ...(layout ? { layout } : {}),
    paint,
    metadata: { ...FROM_AIRFIELD, ...(pick ? { 'occ:pick': pick, 'occ:pickId': 'id' } : {}) },
  };
}

const labelPaint = colour => ({
  'text-color': colour,
  'text-halo-color': BASEMAP_COLORS.labelHalo,
  'text-halo-width': 1.2,
});

const structureLayer = (id, type, filter, options) => airfieldLayer(id, type, filter, {
  ...options, source: AIRFIELD_STRUCTURES_SOURCE,
});

// The taxiway pavement of the structures, in the taxiway colour (one tone, so the overlaps at the junctions merge).
const pavementLayers = () => [
  structureLayer('occ-airfield-taxiway-pavement', 'fill', ['all', IS_POLYGON, kindIs('taxiwayPavement')], {
    paint: { 'fill-color': BASEMAP_COLORS.taxiway, 'fill-opacity': 1 },
  }),
];

// The raised structures and the names of the terminals with their estimated height, over the extrusions.
const extrusionLayers = () => [
  structureLayer('occ-airfield-building-3d', 'fill-extrusion', ['all', IS_POLYGON, kindIs('building')], {
    slot: AIRFIELD_EXTRUSION_SLOT,
    paint: { 'fill-extrusion-color': BASEMAP_COLORS.buildingExtrusion, ...EXTRUSION_PAINT },
  }),
  structureLayer('occ-airfield-jet-bridge', 'fill-extrusion', [
    'all', IS_POLYGON, kindIs('jetBridgeTunnel', 'jetBridgeRotunda'),
  ], {
    slot: AIRFIELD_EXTRUSION_SLOT,
    paint: { 'fill-extrusion-color': occColor('line-strong'), ...EXTRUSION_PAINT },
  }),
  structureLayer('occ-airfield-building-label', 'symbol', ['all', IS_POLYGON, kindIs('building')], {
    slot: AIRFIELD_EXTRUSION_SLOT,
    layout: {
      'text-field': ['concat', ['coalesce', ['get', 'name'], ''], '\n', ['coalesce', ['get', 'heightLabel'], '']],
      'text-font': fonts('regular'),
      'text-size': LABEL_SIZE,
      'text-line-height': 1.15,
      'text-max-width': 12,
      'text-padding': 2,
    },
    paint: labelPaint(occColor('muted')),
  }),
];

/**
 * The overlay of the airfield for buildOccStyle: the GeoJSON source `occ-airfield`, born empty and carrying the credit
 * of its data (AIRFIELD_ATTRIBUTION), and its layers from the bottom: aprons, terminal buildings with their outline,
 * taxiways and taxilanes, each runway as its axis (the narrowest the tiles draw) and its pavement, the dashed
 * centreline, the threshold bars, the holding bars, the taxiway names along their line and the designators.
 * `structures: true` (M9) adds the source `occ-airfield-structures`, born empty, the taxiway pavement under the taxiway
 * lines and, in the `extrusions` slot, the raised terminals, the jet bridges and the terminal labels.
 */
export function airfieldOverlay({ structures = false } = {}) {
  return {
    sources: {
      [AIRFIELD_SOURCE]: { type: 'geojson', attribution: AIRFIELD_ATTRIBUTION },
      ...(structures ? { [AIRFIELD_STRUCTURES_SOURCE]: { type: 'geojson', attribution: AIRFIELD_ATTRIBUTION } } : {}),
    },
    layers: [
      airfieldLayer('occ-airfield-apron', 'fill', ['all', IS_POLYGON, kindIs('apron')], {
        paint: { 'fill-color': BASEMAP_COLORS.apron },
      }),
      airfieldLayer('occ-airfield-terminal', 'fill', ['all', IS_POLYGON, kindIs('terminal')], {
        paint: { 'fill-color': BASEMAP_COLORS.building },
      }),
      airfieldLayer('occ-airfield-terminal-outline', 'line', ['all', IS_POLYGON, kindIs('terminal')], {
        layout: { 'line-join': 'round' },
        paint: { 'line-color': occColor('line-strong'), 'line-width': 1 },
      }),
      ...(structures ? pavementLayers() : []),
      airfieldLayer('occ-airfield-taxiway', 'line', ['all', IS_LINE, kindIs('taxiway', 'taxilane')], {
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': BASEMAP_COLORS.taxiway, 'line-width': [...TAXIWAY_WIDTH] },
        pick: 'taxiway',
      }),
      airfieldLayer('occ-airfield-runway-axis', 'line', ['all', IS_LINE, kindIs('runway')], {
        paint: { 'line-color': BASEMAP_COLORS.runway, 'line-width': [...RUNWAY_WIDTH] },
        pick: 'runway',
      }),
      airfieldLayer('occ-airfield-runway', 'fill', ['all', IS_POLYGON, kindIs('runway')], {
        paint: { 'fill-color': BASEMAP_COLORS.runway },
        pick: 'runway',
      }),
      airfieldLayer('occ-airfield-centreline', 'line', ['all', IS_LINE, kindIs('runwayCentreline')], {
        paint: { 'line-color': occColor('text'), 'line-width': MARKING_WIDTH, 'line-dasharray': [6, 5] },
      }),
      airfieldLayer('occ-airfield-threshold', 'line', ['all', IS_LINE, kindIs('thresholdBar')], {
        paint: { 'line-color': occColor('text'), 'line-width': BAR_WIDTH },
      }),
      airfieldLayer('occ-airfield-hold', 'line', ['all', IS_LINE, kindIs('holdBar')], {
        paint: { 'line-color': occColor('text'), 'line-width': BAR_WIDTH },
      }),
      airfieldLayer('occ-airfield-taxiway-name', 'symbol', [
        'all', IS_LINE, kindIs('taxiway', 'taxilane'), ['to-boolean', ['get', 'ref']],
      ], {
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 320,
          'text-field': ['get', 'ref'],
          'text-font': fonts('regular'),
          'text-size': LABEL_SIZE,
          'text-max-angle': 30,
        },
        // Muted, not faint: it reads on the lighter taxiways of the coloured base map (mapColors.js).
        paint: labelPaint(occColor('muted')),
      }),
      // Each designator faces its runway end's heading, as painted: it reads from the approach.
      airfieldLayer('occ-airfield-designator', 'symbol', kindIs('designator'), {
        layout: {
          'text-field': ['get', 'ref'],
          'text-font': fonts('bold'),
          'text-size': DESIGNATOR_SIZE,
          'text-rotate': ['get', 'rotate'],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'map',
          'text-allow-overlap': true,
        },
        paint: labelPaint(occColor('text')),
      }),
      ...(structures ? extrusionLayers() : []),
    ],
  };
}

/** The ids of the airfield's layers, in drawing order (what OccMap asks the map about for the legend). */
export const AIRFIELD_LAYER_IDS = Object.freeze(airfieldOverlay().layers.map(layer => layer.id));
/** The ids of the layers `structures: true` adds (M9), in drawing order; the legend reads them with the others. */
export const AIRFIELD_STRUCTURE_LAYER_IDS = Object.freeze(airfieldOverlay({ structures: true }).layers
  .map(layer => layer.id).filter(id => !AIRFIELD_LAYER_IDS.includes(id)));
const AIRFIELD_LAYERS = new Set([...AIRFIELD_LAYER_IDS, ...AIRFIELD_STRUCTURE_LAYER_IDS]);

/**
 * What the map draws of the airfield, from the features queryRenderedFeatures answers for AIRFIELD_LAYER_IDS and
 * AIRFIELD_STRUCTURE_LAYER_IDS: the legend items on screen (AIRFIELD_LEGEND_KINDS), in the legend's order. A raised
 * terminal (`building`) stands in for the flat `terminal` it covers. Features of other layers are ignored. Pure.
 */
export function airfieldKindsOnScreen(features) {
  const present = new Set();
  for (const feature of features ?? []) {
    if (!AIRFIELD_LAYERS.has(feature?.layer?.id)) continue;
    const kind = feature.properties?.kind;
    if (typeof kind === 'string' && Object.hasOwn(LEGEND_KIND, kind)) present.add(LEGEND_KIND[kind]);
  }
  if (present.has('building')) present.delete('terminal');
  return AIRFIELD_LEGEND_KINDS.filter(kind => present.has(kind));
}

const TOOLTIP_KINDS = new Set(['runway', 'taxiway']);
const finiteOrNull = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * What the map tooltip shows for a pick (`{ kind, id, feature }`, as the map engine answers it): a runway's designator
 * pair, length and width, or a taxiway's name (`null` when it has none), read from the feature the dataset gave the
 * map. `null` for anything else.
 */
export function airfieldTooltip(hit) {
  if (!hit || !TOOLTIP_KINDS.has(hit.kind) || hit.id == null) return null;
  const properties = hit.feature?.properties ?? {};
  const ref = typeof properties.ref === 'string' && properties.ref.trim() !== '' ? properties.ref : null;
  if (hit.kind === 'taxiway') return { kind: 'taxiway', id: String(hit.id), ref };
  return {
    kind: 'runway',
    id: String(hit.id),
    ref: ref ?? String(hit.id),
    lengthM: finiteOrNull(properties.lengthM),
    widthM: finiteOrNull(properties.widthM),
  };
}
