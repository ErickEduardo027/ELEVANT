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

export const AIRFIELD_SOURCE = 'occ-airfield';
export const AIRFIELD_GROUP = 'airfield';
export const AIRFIELD_SLOT = 'airfield';

/** What the legend lists of the airfield, in its order (owner request: only what is on screen). */
export const AIRFIELD_LEGEND_KINDS = Object.freeze(['runway', 'taxiway', 'holdBar', 'apron', 'terminal']);

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
const DESIGNATOR_SIZE = ['interpolate', ['exponential', 2], ['zoom'], 16.5, LABEL_SIZE, 19.5, 44];

function airfieldLayer(id, type, filter, { layout, paint, pick } = {}) {
  return {
    slot: AIRFIELD_SLOT,
    id,
    type,
    source: AIRFIELD_SOURCE,
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

/**
 * The overlay of the airfield for buildOccStyle: the GeoJSON source `occ-airfield`, born empty and carrying the credit
 * of its data (AIRFIELD_ATTRIBUTION), and its layers from the bottom: aprons, terminal buildings with their outline,
 * taxiways and taxilanes, each runway as its axis (the narrowest the tiles draw) and its pavement, the dashed
 * centreline, the threshold bars, the holding bars, the taxiway names along their line and the designators.
 */
export function airfieldOverlay() {
  return {
    sources: { [AIRFIELD_SOURCE]: { type: 'geojson', attribution: AIRFIELD_ATTRIBUTION } },
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
        paint: labelPaint(occColor('faint')),
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
    ],
  };
}

/** The ids of the airfield's layers, in drawing order (what OccMap asks the map about for the legend). */
export const AIRFIELD_LAYER_IDS = Object.freeze(airfieldOverlay().layers.map(layer => layer.id));
const AIRFIELD_LAYERS = new Set(AIRFIELD_LAYER_IDS);

/**
 * What the map draws of the airfield, from the features queryRenderedFeatures answers for AIRFIELD_LAYER_IDS: the
 * legend items on screen (`runway`, `taxiway`, `holdBar`, `apron`, `terminal`), in the legend's order. Features of other
 * layers are ignored. Pure.
 */
export function airfieldKindsOnScreen(features) {
  const present = new Set();
  for (const feature of features ?? []) {
    if (!AIRFIELD_LAYERS.has(feature?.layer?.id)) continue;
    const kind = feature.properties?.kind;
    if (typeof kind === 'string' && Object.hasOwn(LEGEND_KIND, kind)) present.add(LEGEND_KIND[kind]);
  }
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
