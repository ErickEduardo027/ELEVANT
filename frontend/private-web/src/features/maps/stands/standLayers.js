import { occColor } from '../../occ-ui/occPalette';
import { STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { FONT_STACKS } from '../style/occStyle';
import { SELECTION_SOURCE, STAND_ICON_SIZE } from '../style/selectionLayers';

// The stands of the OCC maps as points (until PR M4 brings their polygons), drawn in the vocabulary of
// occ-ui/statusVocabulary.js: each state is a fill, a frame and a glyph made of the SDF images of style/mapImages.js,
// painted in OCC tokens. Normal states carry no hue; the selection casing is the selection overlay's. Clusters gather
// the stands below the airfield view and carry no hue either. Pure: OccMap adds the overlay and fills the source with
// stands/standFeatures.js.

export const STAND_SOURCE = 'occ-stands';
export const STAND_GROUP = 'stands';
/** `dashboard` is the console's apron map: codes from the airfield view on, planned and selected codes first. */
export const STAND_LABEL_MODES = Object.freeze(['default', 'dashboard']);

const CLUSTER_RADIUS_PX = Object.freeze({ default: 50, dashboard: 35 });
// Where the clusters stopped before M2, until the fitted zooms of the screen give their limit (standClusterOptions).
const INITIAL_CLUSTER_MAX_ZOOM = Object.freeze({ default: 14, dashboard: 12 });

const FILL_IMAGES = Object.freeze({ tint: 'stand-slab', solid: 'stand-slab', hatch: 'stand-hatch' });
const FRAME_IMAGES = Object.freeze({
  solid: 'stand-frame-solid',
  '4-3': 'stand-frame-dash-4-3',
  '2-2': 'stand-frame-dash-2-2',
  '1-3': 'stand-frame-dot-1-3',
});

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
 * of style/mapImages.js and the colours the tokens the vocabulary names: the fill token, and the outline token for
 * the frame and its marks.
 */
export function standAppearance(state) {
  if (!Object.hasOwn(STAND_STATES, state)) throw new RangeError(`Unknown stand state: ${String(state)}`);
  const { fill, outline, dash } = STAND_STATES[state];
  const mark = image => (image === null ? null : { image, color: occColor(outline.token) });
  return {
    fill: fill.kind === 'none' ? null : { image: FILL_IMAGES[fill.kind], color: occColor(fill.token) },
    frame: { image: FRAME_IMAGES[dash === null ? 'solid' : dash.join('-')], color: occColor(outline.token) },
    glyph: mark(GLYPHS[state].centre),
    badge: mark(GLYPHS[state].badge),
  };
}

const STATUS = ['get', 'status'];
const IS_POINT = ['!', ['has', 'point_count']];
const IS_CLUSTER = ['has', 'point_count'];
const fonts = () => [...FONT_STACKS.bold];

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
    metadata: { 'occ:group': STAND_GROUP, ...extra.metadata },
  };
}

const codeLayout = ({ size, offset, priority }) => ({
  'text-field': ['get', 'code'],
  'text-font': fonts(),
  'text-size': size,
  'text-offset': offset,
  'text-allow-overlap': priority,
  'text-optional': !priority,
});

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
    metadata: { 'occ:group': STAND_GROUP },
  };
  if (labels === 'default') {
    return [count, {
      slot: 'standLabels',
      id: 'occ-stands-codes',
      type: 'symbol',
      source: STAND_SOURCE,
      filter: IS_POINT,
      layout: codeLayout({ size: 12, offset: [0, 1.6], priority: false }),
      paint: codePaint(1.2),
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
 * and the codes, behind the derived `codes` threshold (`polygons` on the console).
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
        id: 'occ-stands-clusters',
        type: 'circle',
        source: STAND_SOURCE,
        filter: IS_CLUSTER,
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 15, 26],
          'circle-color': occColor('panel-raised'),
          'circle-stroke-color': occColor('line-strong'),
          'circle-stroke-width': 1,
        },
        metadata: { 'occ:group': STAND_GROUP, 'occ:pick': 'cluster', 'occ:pickId': 'cluster_id' },
      },
      markLayer('occ-stands-fill', 'fill'),
      markLayer('occ-stands-frame', 'frame', { metadata: { 'occ:pick': 'stand', 'occ:pickId': 'code' } }),
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
 * The cluster options once the screen's thresholds are known: clusters stop one zoom below the stand threshold
 * (`floor(polygons) − 1`, never below 1), so from the airfield view on every stand is drawn on its own. MapLibre 6.16
 * sets `cluster` from every call, so the call always carries `cluster: true`. `null` before the thresholds.
 */
export function standClusterOptions(thresholds, { labels = 'default' } = {}) {
  assertLabels(labels);
  if (!Number.isFinite(thresholds?.polygons)) return null;
  return {
    cluster: true,
    clusterRadius: CLUSTER_RADIUS_PX[labels],
    clusterMaxZoom: Math.max(1, Math.floor(thresholds.polygons) - 1),
  };
}
