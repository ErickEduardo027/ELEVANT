import { occColor } from '../../occ-ui/occPalette';
import { OURAIRPORTS_ATTRIBUTION } from '../core/attribution';
import { NAVAID_IMAGES } from './referenceImages';
import { FONT_STACKS } from './basemapLayers';
import { mapColorsFor } from './mapColors';
import { AIRPORT_KINDS, airportKind, airportLabel } from '../traffic/referenceFeatures';

export { ourAirportsFeatures, referenceFeatures } from '../traffic/referenceFeatures';

// The fixed references of every OCC map: the aerodrome reference point of Punta Cana with its «PUJ» label (it replaces
// the airport marker of Monitoreo), and from PR M8 (design E6) the range rings, the extended runway centrelines with the
// runway in use, the airports of the region, the navaids and the night. From the ramp view on the stands take over, so
// the mark of PUJ hides behind the derived `codes` threshold. Its label sits above the mark: the stands lie south of the
// reference point, so in the airfield view it stays clear of them. The tile label of the same airport, and those of the
// region's airports, are left out of the base map (basemapLayers.js), so each is written once. Pure: OccMap adds the
// overlay and fills its three sources (traffic/referenceFeatures.js and traffic/nightShade.js). What is drawn from
// OurAirports data (the extended centrelines, from the thresholds and headings of the runway ends, the region's
// airports and the navaids) has a source of its own that carries the credit of OurAirports, so MapLibre lists it only
// while one of those layers is drawn (design A7), as the airfield source does with its own.
//
// The mark of the home airport lies in the `airfield` slot, above the pavement and the base-map labels: in the
// `reference` slot a runway drawn over it, or a place name placed before it, hid the airport the map is about (seen
// in the map lab). The other references stay in the `reference` slot, under the base-map labels and the airfield, and
// the night in the `shade` slot, right above the land and the sea. Each group is a key of the layers menu
// (core/layersMenu.js): rings, centrelines, reference.airports, navaids and daynight. All of it but the airports is
// quiet: thin lines and dim words in the neutral tokens, no hue (contracts 2.4); the runway in use is the one line
// drawn wider and lighter. The airports keep the colours by kind the owner asked for (style/mapColors.js).

export const REFERENCE_SOURCE = 'occ-reference';
/**
 * The source of the references drawn from OurAirports data (traffic/referenceFeatures.js: ourAirportsFeatures), with
 * its credit (core/attribution.js: OURAIRPORTS_ATTRIBUTION).
 */
export const OURAIRPORTS_SOURCE = 'occ-reference-ourairports';
/** The source of the night shade (traffic/nightShade.js), rewritten on the minute. */
export const NIGHT_SOURCE = 'occ-night';
/** The group of the mark of PUJ: never a key of the layers menu, so it always shows. */
export const REFERENCE_GROUP = 'reference';
/**
 * The airports of the region (owner request of 2026-11-15): the 32 of airport/data/region.context.json (OurAirports,
 * public domain), a dot coloured by kind with its ICAO/IATA code in yellow, from the Región and Aproximación views
 * (below the derived `airfield` threshold) and in the layers menu («Referencias»). Above the base-map labels, so the
 * tile label of the same airport gives way to it. The airport of a flight of today (PR M8) is a larger dot ringed in
 * the text colour, its code larger and placed first: the ring tells it apart, not the colour alone. They read the
 * OurAirports source, so its credit shows while they are drawn.
 */
export const AIRPORTS_GROUP = 'reference.airports';
/** The kinds of the region's airports, in the legend's order (traffic/referenceFeatures.js: airportKind). */
export { AIRPORT_KINDS, airportKind, airportLabel };
const AIRPORT_RADIUS = Object.freeze({ home: 7, international: 5, regional: 4.5, other: 3.5 });

function airportLayers(theme) {
  const { airports: colours } = mapColorsFor(theme);
  const kind = ['get', 'airportKind'];
  const byKind = value => ['match', kind, ...AIRPORT_KINDS.slice(0, -1).flatMap(name => [name, value(name)]),
    value(AIRPORT_KINDS.at(-1))];
  const counterpart = ['==', ['get', 'counterpart'], true];
  const metadata = { 'occ:group': AIRPORTS_GROUP, 'occ:maxThreshold': 'airfield' };
  const isAirport = ['==', ['get', 'kind'], 'airport'];
  return [
    {
      slot: ARP_SLOT,
      id: 'occ-region-airports',
      type: 'circle',
      source: OURAIRPORTS_SOURCE,
      filter: isAirport,
      paint: {
        'circle-radius': ['+', byKind(name => AIRPORT_RADIUS[name]), ['case', counterpart, 1.5, 0]],
        'circle-color': byKind(name => colours[name]),
        'circle-stroke-color': ['case', counterpart, occColor('text'), colours.halo],
        'circle-stroke-width': ['case', counterpart, 2, 1.5],
      },
      metadata,
    },
    {
      slot: ARP_SLOT,
      id: 'occ-region-airport-labels',
      type: 'symbol',
      source: OURAIRPORTS_SOURCE,
      filter: isAirport,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': [...FONT_STACKS.bold],
        'text-size': ['case', ['any', counterpart, ['==', kind, 'home']], 13, 12],
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'symbol-sort-key': ['case', ['==', kind, 'home'], 0, counterpart, 1,
          ['match', kind, 'international', 2, 'regional', 3, 4]],
      },
      paint: { 'text-color': colours.label, 'text-halo-color': colours.halo, 'text-halo-width': 1.5 },
      metadata,
    },
  ];
}
/** The slot of the home airport's mark. */
export const ARP_SLOT = 'airfield';
export const REFERENCE_SLOT = 'reference';
export const NIGHT_SLOT = 'shade';

/** The layers-menu keys of the references (design E7), each the `occ:group` of its layers. */
export const REFERENCE_GROUPS = Object.freeze({
  rings: 'rings', centrelines: 'centrelines', airports: AIRPORTS_GROUP, navaids: 'navaids', daynight: 'daynight',
});

const LABEL_SIZE = 12;
const KIND = ['get', 'kind'];
const kindIs = (...kinds) => ['match', KIND, kinds, true, false];
const fonts = stack => [...FONT_STACKS[stack]];
const IN_USE = ['==', ['get', 'inUse'], true];
// The dark of the map under every word and mark of the references, so they read over the land, the sea and the lines.
const HALO = Object.freeze({ 'text-halo-color': occColor('nav'), 'text-halo-width': 1.2 });
function referenceLayer(id, type, group, { slot = REFERENCE_SLOT, source = REFERENCE_SOURCE, filter, layout, paint,
  thresholds = {} }) {
  return {
    slot,
    id,
    type,
    source,
    filter,
    ...(layout ? { layout } : {}),
    paint,
    // M4: the words and marks are hidden close up (core/mapEngine.js: setCloseUp).
    metadata: { 'occ:group': group, ...thresholds, ...(type === 'symbol' ? { 'occ:closeUp': 'hide' } : {}) },
  };
}

// The rings of a scope: their lines and their «20 NM» labels, from and up to the derived thresholds of contracts 2.3.
function ringLayers(scope, thresholds) {
  const filter = ['all', kindIs('ring'), ['==', ['get', 'scope'], scope]];
  return [
    referenceLayer(`occ-reference-rings-${scope}`, 'line', REFERENCE_GROUPS.rings, {
      filter,
      paint: { 'line-color': occColor('line-strong'), 'line-width': 1 },
      thresholds,
    }),
    referenceLayer(`occ-reference-ring-labels-${scope}`, 'symbol', REFERENCE_GROUPS.rings, {
      filter: ['all', kindIs('ringLabel'), ['==', ['get', 'scope'], scope]],
      layout: { 'text-field': ['get', 'label'], 'text-font': fonts('regular'), 'text-size': LABEL_SIZE, 'text-optional': true },
      paint: { 'text-color': occColor('faint'), ...HALO },
      thresholds,
    }),
  ];
}

/**
 * The overlay of the references for buildOccStyle: the sources `occ-reference`, `occ-reference-ourairports` (with the
 * credit of OurAirports) and `occ-night`, born empty, and their layers. In the airfield slot, the region's airports
 * (unless `airports: false`, a map without traffic) in the colours of `theme` (style/mapColors.js), today's
 * counterparts ringed, and the mark of PUJ up to the codes threshold. In the reference slot: the rings of the Región
 * view below the `approach` threshold and those of Aproximación from it up to the airfield one, each with its label;
 * the extended centrelines, their ticks (from the `approach` threshold) and the label of the runway in use; and the
 * navaids, with their chart symbol and their ident and frequency, from the `approach` threshold until the stands turn
 * into polygons.
 * In the shade slot, the night, the line of its edge and its word, up to the airfield threshold. The centrelines, the
 * airports and the navaids read the OurAirports source; the mark of PUJ and the rings, the reference source.
 */
export function referenceOverlay({ theme = 'dark', airports = true } = {}) {
  // The night darkens the map in both themes (style/mapColors.js), so its colour is the theme's, never a token.
  const { night } = mapColorsFor(theme);
  return {
    sources: {
      [REFERENCE_SOURCE]: { type: 'geojson' },
      [OURAIRPORTS_SOURCE]: { type: 'geojson', attribution: OURAIRPORTS_ATTRIBUTION },
      [NIGHT_SOURCE]: { type: 'geojson' },
    },
    layers: [
      // The region's airports (unless `airports: false`, a map without traffic), under the mark of PUJ in the airfield
      // slot, so the mark keeps its place first.
      ...(airports ? airportLayers(theme) : []),
      {
        slot: ARP_SLOT,
        id: 'occ-reference-arp',
        type: 'symbol',
        source: REFERENCE_SOURCE,
        filter: ['==', ['get', 'kind'], 'arp'],
        layout: {
          'icon-image': 'airport-arp',
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-font': [...FONT_STACKS.bold],
          'text-size': 12,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.9],
          'text-optional': true,
        },
        paint: {
          'icon-color': occColor('text'),
          'icon-halo-color': occColor('nav'),
          'icon-halo-width': 1,
          'text-color': occColor('text'),
          'text-halo-color': occColor('nav'),
          'text-halo-width': 1.2,
        },
        metadata: { 'occ:group': REFERENCE_GROUP, 'occ:maxThreshold': 'codes', 'occ:closeUp': 'hide' },
      },
      ...ringLayers('region', { 'occ:maxThreshold': 'approach' }),
      ...ringLayers('approach', { 'occ:minThreshold': 'approach', 'occ:maxThreshold': 'airfield' }),
      // The runway in use wider and in the text colour; every other end a thin line in line-strong.
      referenceLayer('occ-reference-centrelines', 'line', REFERENCE_GROUPS.centrelines, {
        source: OURAIRPORTS_SOURCE,
        filter: kindIs('centreline'),
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': ['case', IN_USE, occColor('text'), occColor('line-strong')],
          'line-width': ['case', IN_USE, 1.5, 1],
        },
      }),
      referenceLayer('occ-reference-centreline-ticks', 'line', REFERENCE_GROUPS.centrelines, {
        source: OURAIRPORTS_SOURCE,
        filter: kindIs('tick'),
        paint: {
          'line-color': ['case', IN_USE, occColor('text'), occColor('line-strong')],
          'line-width': ['case', IN_USE, 1.5, 1],
        },
        thresholds: { 'occ:minThreshold': 'approach' },
      }),
      referenceLayer('occ-reference-centreline-label', 'symbol', REFERENCE_GROUPS.centrelines, {
        source: OURAIRPORTS_SOURCE,
        filter: kindIs('centrelineLabel'),
        layout: {
          'text-field': ['get', 'label'],
          'text-font': fonts('regular'),
          'text-size': LABEL_SIZE,
          'text-anchor': ['match', ['get', 'anchor'], 'left', 'left', 'right'],
          // One line: «Pista 08 (estimada por el viento)» reads as one name.
          'text-max-width': 30,
          'text-optional': true,
        },
        paint: { 'text-color': occColor('muted'), ...HALO },
      }),
      // Both navaids stand on the airport, a few pixels from the mark of PUJ in the Aproximación view: their symbols are
      // always drawn, under the mark, and their ident and frequency where there is room. They end where the stands turn
      // into polygons (PCA lies by terminal A), so nothing of them sits over the stands.
      referenceLayer('occ-reference-navaids', 'symbol', REFERENCE_GROUPS.navaids, {
        source: OURAIRPORTS_SOURCE,
        filter: ['all', kindIs('navaid'), ['match', ['get', 'type'], Object.keys(NAVAID_IMAGES), true, false]],
        layout: {
          'icon-image': ['match', ['get', 'type'], 'NDB', NAVAID_IMAGES.NDB, NAVAID_IMAGES['VOR-DME']],
          'icon-size': 0.9,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'label'],
          'text-font': fonts('regular'),
          'text-size': LABEL_SIZE,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 0.9,
          'text-optional': true,
        },
        paint: {
          'icon-color': occColor('muted'),
          'icon-halo-color': occColor('nav'),
          'icon-halo-width': 1,
          'text-color': occColor('faint'),
          ...HALO,
        },
        thresholds: { 'occ:minThreshold': 'approach', 'occ:maxThreshold': 'polygons' },
      }),
      // The night: the land and the sea a little darker past the edge of the civil twilight, and the edge itself a thin
      // line, so it reads over the sea too.
      referenceLayer('occ-night', 'fill', REFERENCE_GROUPS.daynight, {
        slot: NIGHT_SLOT,
        source: NIGHT_SOURCE,
        filter: kindIs('night'),
        paint: { 'fill-color': night.color, 'fill-opacity': night.opacity },
        thresholds: { 'occ:maxThreshold': 'airfield' },
      }),
      referenceLayer('occ-night-edge', 'line', REFERENCE_GROUPS.daynight, {
        slot: NIGHT_SLOT,
        source: NIGHT_SOURCE,
        filter: kindIs('nightEdge'),
        paint: { 'line-color': occColor('line'), 'line-width': 1 },
        thresholds: { 'occ:maxThreshold': 'airfield' },
      }),
      // «Noche» on the night side of the edge: over the sea the shade barely darkens the map, so a word says it.
      referenceLayer('occ-night-label', 'symbol', REFERENCE_GROUPS.daynight, {
        slot: NIGHT_SLOT,
        source: NIGHT_SOURCE,
        filter: kindIs('nightLabel'),
        layout: { 'text-field': ['get', 'label'], 'text-font': fonts('regular'), 'text-size': LABEL_SIZE, 'text-optional': true },
        paint: { 'text-color': occColor('faint'), ...HALO },
        thresholds: { 'occ:maxThreshold': 'airfield' },
      }),
    ],
  };
}

const REFERENCE_LAYERS = referenceOverlay().layers;

/**
 * The layers OccMap asks the map about for the legend (what is drawn of each reference, read back from the map): the
 * rings, the centrelines and their ticks, the airports, the navaids and the night, in drawing order. The labels and
 * the mark of PUJ are not legend items.
 */
export const REFERENCE_LAYER_IDS = Object.freeze(REFERENCE_LAYERS
  .filter(layer => Object.values(REFERENCE_GROUPS).includes(layer.metadata['occ:group']))
  .filter(layer => !layer.id.includes('label') && layer.id !== 'occ-night-edge')
  .map(layer => layer.id));

/** The legend layers of REFERENCE_LAYER_IDS whose group is shown in `groups` (OccMap's shown groups). */
export function referenceLayersShown(groups) {
  return REFERENCE_LAYERS
    .filter(layer => REFERENCE_LAYER_IDS.includes(layer.id) && groups?.[layer.metadata['occ:group']] !== false)
    .map(layer => layer.id);
}
