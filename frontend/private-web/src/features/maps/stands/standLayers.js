import { occColor } from '../../occ-ui/occPalette';
import { STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { standFrameImage } from '../style/mapImages';
import { FONT_STACKS } from '../style/occStyle';
import { SELECTION_SOURCE, STAND_ICON_SIZE } from '../style/selectionLayers';

// The stands of the OCC maps as points (until PR M4 brings their polygons), drawn in the vocabulary of
// occ-ui/statusVocabulary.js: each state is a fill, a frame and a glyph made of the SDF images of style/mapImages.js,
// painted in OCC tokens. Normal states carry no hue; the selection casing is the selection overlay's. The stands
// belong to the Aeródromo and Rampa views: below the derived `polygons` threshold nothing of them is drawn, so the
// region and approach views show the airport's reference point. Clusters gather them until they can be told apart
// (below the ramp view; on the console's apron, below the airfield view) and carry no hue either. Pure: OccMap adds
// the overlay and fills the source with stands/standFeatures.js.

export const STAND_SOURCE = 'occ-stands';
export const STAND_GROUP = 'stands';
/** The layer that draws each stand on its own (its frame, the pick target), and the one that draws the clusters. */
export const STAND_FRAME_LAYER = 'occ-stands-frame';
export const STAND_CLUSTER_LAYER = 'occ-stands-clusters';
/** The layers whose rendered features say what the map draws of the stands (drawnStands). */
export const STAND_DRAWN_LAYERS = Object.freeze([STAND_FRAME_LAYER, STAND_CLUSTER_LAYER]);
/** `dashboard` is the console's apron map: codes from the airfield view on, planned and selected codes first. */
export const STAND_LABEL_MODES = Object.freeze(['default', 'dashboard']);

const CLUSTER_RADIUS_PX = Object.freeze({ default: 50, dashboard: 35 });
// Where the clusters stopped before M2, until the fitted zooms of the screen give their limit (standClusterOptions).
const INITIAL_CLUSTER_MAX_ZOOM = Object.freeze({ default: 14, dashboard: 12 });

const FILL_IMAGES = Object.freeze({ tint: 'stand-slab', solid: 'stand-slab', hatch: 'stand-hatch' });

// What the markers meant before M2, in the vocabulary: an aircraft inside the stand while a visit holds it (planned,
// occupied, releasing), the axis mark of an empty stand (free, unverified), and the clock that tells «Por liberar»
// from «Ocupada». «Llegando» stays empty, its aircraft is not there yet; «Inhabilitada» shows its hatch.
const GLYPHS = Object.freeze({
  available: { centre: 'glyph-axis', badge: null },
  planned: { centre: 'glyph-aircraft', badge: null },
  arriving: { centre: null, badge: null },
  occupied: { centre: 'glyph-aircraft', badge: null },
  releasing: { centre: 'glyph-aircraft', badge: 'glyph-clock' },
  disabled: { centre: null, badge: null },
  unverified: { centre: 'glyph-axis', badge: null },
});

// The clock sits on the top right corner of the stand square, clear of the aircraft (icon units, scaled by size).
const BADGE_OFFSET = Object.freeze([9, -9]);

/**
 * How a stand state is drawn: `{ fill, frame, glyph, badge }`, each `{ image, color }` or `null`. The images are ids
 * of style/mapImages.js, the frame the one drawn at the width and dash of the state's outline, and the colours the
 * tokens the vocabulary names: the fill token, and the outline token for the frame and its marks.
 */
export function standAppearance(state) {
  if (!Object.hasOwn(STAND_STATES, state)) throw new RangeError(`Unknown stand state: ${String(state)}`);
  const { fill, outline, dash } = STAND_STATES[state];
  const mark = image => (image === null ? null : { image, color: occColor(outline.token) });
  return {
    fill: fill.kind === 'none' ? null : { image: FILL_IMAGES[fill.kind], color: occColor(fill.token) },
    frame: { image: standFrameImage(outline.width, dash), color: occColor(outline.token) },
    glyph: mark(GLYPHS[state].centre),
    badge: mark(GLYPHS[state].badge),
  };
}

const STATUS = ['get', 'status'];
const IS_POINT = ['!', ['has', 'point_count']];
const IS_CLUSTER = ['has', 'point_count'];
const fonts = () => [...FONT_STACKS.bold];
// Every layer of the stands starts at the derived stand threshold (airfield fit − 0.3, contracts 2.3).
const FROM_AIRFIELD = Object.freeze({ 'occ:minThreshold': 'polygons' });
// The threshold the clusters end below, by label mode: the stand codes outside the console, the stands on its apron.
const CLUSTER_END = Object.freeze({ default: 'codes', dashboard: 'polygons' });

const statesWith = part => STAND_STATE_KEYS.filter(state => standAppearance(state)[part] !== null);
// A `match` on the stand state over `states`; the fallback is never reached when the layer filters on those states.
const byState = (states, value) => ['match', STATUS, ...states.flatMap(state => [state, value(state)]), value(states[0])];
const onStates = states => ['all', IS_POINT, ['match', STATUS, [...states], true, false]];

function markLayer(id, part, extra = {}) {
  const states = statesWith(part);
  return {
    slot: 'stands',
    id,
    type: 'symbol',
    source: STAND_SOURCE,
    filter: onStates(states),
    layout: {
      'icon-image': byState(states, state => standAppearance(state)[part].image),
      'icon-size': [...STAND_ICON_SIZE],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      ...extra.layout,
    },
    paint: { 'icon-color': byState(states, state => standAppearance(state)[part].color), ...extra.paint },
    metadata: { 'occ:group': STAND_GROUP, ...FROM_AIRFIELD, ...extra.metadata },
  };
}

const codeLayout = ({ size, offset = null, priority }) => ({
  'text-field': ['get', 'code'],
  'text-font': fonts(),
  'text-size': size,
  ...(offset === null ? {} : { 'text-offset': offset }),
  'text-allow-overlap': priority,
  'text-optional': !priority,
});

// Outside the console a code goes below its stand, and where a close neighbour's mark or code already sits there,
// above it or beside it, so the stands of a tight row or column keep readable codes instead of hiding one another.
const CODE_ANCHORS = Object.freeze(['top', 'bottom', 'left', 'right']);
const CODE_SIZE_PX = 12;
const CODE_GAP_PX = 7;
// The stand square is 24 px at STAND_ICON_SIZE, and 24 px of the 32 px slab image (mapImages.js) the keep-out draws.
const SQUARE_HALF_PX = 12;
const SQUARE_SHARE = 24 / 32;
// The marks ignore placement (every stand is always drawn), so a code would never see them. This invisible copy of
// the stand square sits above the codes and is placed before them (MapLibre places the upper layer first): the codes
// then keep off every stand.
const KEEP_OUT_LAYER = 'occ-stands-keep-out';

// An expression on the zoom stops of STAND_ICON_SIZE whose value follows the mark's size at every zoom.
function withMarkSize(value) {
  const stops = [];
  for (let index = 3; index < STAND_ICON_SIZE.length; index += 2) {
    stops.push(STAND_ICON_SIZE[index], Math.round(value(STAND_ICON_SIZE[index + 1]) * 1000) / 1000);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

/** How far a code sits from its stand's centre, in ems of the code: half the mark plus a 7 px gap, at every zoom. */
export const CODE_OFFSET = withMarkSize(size => (SQUARE_HALF_PX * size + CODE_GAP_PX) / CODE_SIZE_PX);
/** The size of the invisible keep-out: the stand square only, without the image's clear margin. */
export const KEEP_OUT_SIZE = withMarkSize(size => size * SQUARE_SHARE);

const codePaint = haloWidth => ({
  // «Sin verificar» keeps its code muted (the vocabulary's muted code); every other code reads in the text colour.
  'text-color': ['match', STATUS, 'unverified', occColor('faint'), occColor('text')],
  'text-halo-color': occColor('nav'),
  'text-halo-width': haloWidth,
});

function labelLayers(labels) {
  const count = {
    slot: 'standLabels',
    id: 'occ-stands-cluster-count',
    type: 'symbol',
    source: STAND_SOURCE,
    filter: IS_CLUSTER,
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': fonts(),
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': occColor('text') },
    metadata: { 'occ:group': STAND_GROUP, ...FROM_AIRFIELD },
  };
  if (labels === 'default') {
    return [count, {
      slot: 'standLabels',
      id: 'occ-stands-codes',
      type: 'symbol',
      source: STAND_SOURCE,
      filter: IS_POINT,
      layout: {
        ...codeLayout({ size: CODE_SIZE_PX, priority: false }),
        'text-variable-anchor': [...CODE_ANCHORS],
        'text-radial-offset': [...CODE_OFFSET],
      },
      paint: codePaint(1.2),
      metadata: { 'occ:group': STAND_GROUP, 'occ:minThreshold': 'codes' },
    }, {
      slot: 'standLabels',
      id: KEEP_OUT_LAYER,
      type: 'symbol',
      source: STAND_SOURCE,
      filter: IS_POINT,
      layout: {
        'icon-image': 'stand-slab',
        'icon-size': [...KEEP_OUT_SIZE],
        'icon-padding': 0,
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
      },
      paint: { 'icon-opacity': 0 },
      metadata: { 'occ:group': STAND_GROUP, 'occ:minThreshold': 'codes' },
    }];
  }
  // The console keeps its codes on from the airfield view, with planned stands placed before the others and the
  // selected stand above everything. Layers higher in the slot are placed first.
  return [count, {
    slot: 'standLabels',
    id: 'occ-stands-codes',
    type: 'symbol',
    source: STAND_SOURCE,
    filter: ['all', IS_POINT, ['!=', STATUS, 'planned']],
    layout: codeLayout({ size: ['interpolate', ['linear'], ['zoom'], 14, 12, 17, 13], offset: [0, 1.9], priority: false }),
    paint: codePaint(2),
    metadata: { 'occ:group': STAND_GROUP, 'occ:minThreshold': 'polygons' },
  }, {
    slot: 'standLabels',
    id: 'occ-stands-codes-planned',
    type: 'symbol',
    source: STAND_SOURCE,
    filter: ['all', IS_POINT, ['==', STATUS, 'planned']],
    layout: codeLayout({ size: ['interpolate', ['linear'], ['zoom'], 14, 12, 17, 14], offset: [0, 2], priority: true }),
    paint: codePaint(2.3),
    metadata: { 'occ:group': STAND_GROUP, 'occ:minThreshold': 'polygons' },
  }, {
    slot: 'standLabels',
    id: 'occ-stands-code-selected',
    type: 'symbol',
    source: SELECTION_SOURCE,
    filter: ['==', ['get', 'kind'], 'stand'],
    layout: {
      'text-field': ['get', 'id'],
      'text-font': fonts(),
      'text-size': 14,
      'text-offset': [0, 2.1],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': occColor('accent'), 'text-halo-color': occColor('nav'), 'text-halo-width': 2.5 },
    metadata: { 'occ:group': STAND_GROUP },
  }];
}

function assertLabels(labels) {
  if (!STAND_LABEL_MODES.includes(labels)) throw new RangeError(`Unknown stand label mode: ${String(labels)}`);
}

/**
 * The overlay of the stands for buildOccStyle: the clustered point source `occ-stands` and its layers. In the
 * `stands` slot the clusters (a circle on the raised slab with a strong line), then the fill, the frame (the pick
 * target, `occ:pick: 'stand'`), the glyph and the clock of each stand; in the `standLabels` slot the cluster count
 * and the codes, behind the derived `codes` threshold (`polygons` on the console), and outside the console the
 * invisible keep-out that keeps the codes off the marks. Every other layer starts at the derived `polygons` threshold.
 */
export function standOverlay({ labels = 'default' } = {}) {
  assertLabels(labels);
  return {
    sources: {
      [STAND_SOURCE]: {
        type: 'geojson',
        promoteId: 'code',
        cluster: true,
        clusterRadius: CLUSTER_RADIUS_PX[labels],
        clusterMaxZoom: INITIAL_CLUSTER_MAX_ZOOM[labels],
      },
    },
    layers: [
      {
        slot: 'stands',
        id: STAND_CLUSTER_LAYER,
        type: 'circle',
        source: STAND_SOURCE,
        filter: IS_CLUSTER,
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 15, 26],
          'circle-color': occColor('panel-raised'),
          'circle-stroke-color': occColor('line-strong'),
          'circle-stroke-width': 1,
        },
        metadata: { 'occ:group': STAND_GROUP, ...FROM_AIRFIELD, 'occ:pick': 'cluster', 'occ:pickId': 'cluster_id' },
      },
      markLayer('occ-stands-fill', 'fill'),
      markLayer(STAND_FRAME_LAYER, 'frame', { metadata: { 'occ:pick': 'stand', 'occ:pickId': 'code' } }),
      markLayer('occ-stands-glyph', 'glyph'),
      markLayer('occ-stands-clock', 'badge', {
        layout: { 'icon-offset': [...BADGE_OFFSET] },
        paint: { 'icon-halo-color': occColor('panel-raised'), 'icon-halo-width': 1.5 },
      }),
      ...labelLayers(labels),
    ],
  };
}

/**
 * The cluster options once the screen's thresholds are known: clusters stop one zoom below the threshold of the label
 * mode (`floor(codes) − 1` outside the console, `floor(polygons) − 1` on its apron, never below 1). The stand points
 * are fixed-size marks a few metres apart, so outside the console they are gathered through the airfield view and
 * drawn one by one from the ramp view on, as before M2. MapLibre 6.16 sets `cluster` from every call, so the call
 * always carries `cluster: true`. `null` before the thresholds.
 */
export function standClusterOptions(thresholds, { labels = 'default' } = {}) {
  assertLabels(labels);
  const end = thresholds?.[CLUSTER_END[labels]];
  if (!Number.isFinite(end) || !Number.isFinite(thresholds?.polygons)) return null;
  return {
    cluster: true,
    clusterRadius: CLUSTER_RADIUS_PX[labels],
    clusterMaxZoom: Math.max(1, Math.floor(end) - 1),
  };
}

/**
 * How the stands are drawn at `zoom` with the screen's thresholds: `hidden` below the stand threshold (the region and
 * approach views), `grouped` while MapLibre still gathers them into clusters (a GeoJSON source clusters by the whole
 * zoom of its tiles, up to clusterMaxZoom) and `points` from there on. Before the thresholds are known the layers have
 * no zoom range yet and every stand counts as a point.
 */
export function standDisplayAt(zoom, thresholds, { labels = 'default' } = {}) {
  const clusters = standClusterOptions(thresholds, { labels });
  if (!Number.isFinite(zoom) || clusters === null) return 'points';
  if (zoom < thresholds.polygons) return 'hidden';
  return Math.floor(zoom) <= clusters.clusterMaxZoom ? 'grouped' : 'points';
}

/**
 * What the map draws of the stands, read from the features queryRenderedFeatures answers for STAND_DRAWN_LAYERS:
 * `{ codes, grouped }`, the codes of the stands drawn on their own and whether a cluster is drawn. While MapLibre
 * gathers the stands into clusters, a stand with no neighbour within the cluster radius is still drawn on its own,
 * with its state, so the zoom alone cannot tell. A feature drawn in two tiles is answered twice and counts once. Pure.
 */
export function drawnStands(features) {
  const codes = new Set();
  let grouped = false;
  for (const feature of features ?? []) {
    const layer = feature?.layer?.id;
    if (layer === STAND_CLUSTER_LAYER) grouped = true;
    else if (layer === STAND_FRAME_LAYER && feature.properties?.code != null) codes.add(String(feature.properties.code));
  }
  return { codes, grouped };
}
