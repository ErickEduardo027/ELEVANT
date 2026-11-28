import { occColor } from '../../occ-ui/occPalette';
import { SIGNALS, STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapColorsFor } from '../style/mapColors';
import { FONT_STACKS } from '../style/occStyle';
import { SELECTION_SOURCE } from '../style/selectionLayers';

// The stands of the OCC maps as polygons with their state (PR M4, design D2), drawn in the vocabulary of
// occ-ui/statusVocabulary.js: each state is a fill (none, a see-through tint, the raised slab or the hatch), an outline
// with its width and dash, and the marks that go with it (the aircraft of a stand with an aircraft on it, the clock of
// «Por liberar», the emphasised lead-in of «Llegando», the link of a stand a combined stand cancels). Normal states
// carry no hue; cyan is the selection, amber and red the signals, and a plain notice is a diamond without colour. What
// the map draws depends on the zoom, through the thresholds derived from the fitted views (contracts 2.3, never a fixed
// zoom): one chip per terminal from the airfield threshold up to the stand polygons; the polygons, their marks and
// signals from `polygons` (the airfield fit − 0.3); codes, flights, lead-ins and the aircraft to scale from `codes` (the
// ramp fit − 0.3; the console's apron shows its codes from `polygons`); the three-line labels and the progress of a
// turnaround from `threeLine` (the ramp fit + 0.8). Hover, selection, related and same-agent marks are feature-state, so
// a pointer or a selection never rewrites the data; the selected stand's label comes from the selection source, and its
// own label leaves the stand labels by their filter (standLabelFilter, N29). «Ubicar en el mapa» draws its boxes from a
// source of its own in the top slot. Pure: OccMap adds the overlay, fills the five stand sources with
// stands/standFeatures.js and the placing source with stands/placing.js, and sets the labels' filter.
//
// PR M6 (design D3): the aircraft of a stand at true size (aircraft/footprint.js), solid while it is on the stand and
// dashed while it is still to come, so one sees whether it fits; below `codes`, where a footprint is too small to read,
// the aircraft glyph stands in for it, and from `codes` on the glyph stays only on a stand whose aircraft has no type to
// draw. The progress bar of the turnaround runs along the stand's rear edge: the milestones recorded out of 25, with no
// «late» colour (no target time exists per milestone).

export const STAND_SOURCE = 'occ-stands';
export const STAND_AUX_SOURCE = 'occ-stand-aux';
export const STAND_LABEL_SOURCE = 'occ-stand-labels';
export const STAND_GROUP_SOURCE = 'occ-stand-groups';
/** The aircraft of the stands at true size (PR M6, design D2): one polygon per stand that draws one. */
export const STAND_FOOTPRINT_SOURCE = 'occ-aircraft-footprints';
/** The source of «Ubicar en el mapa»: the box that follows the pointer and the pending location (stands/placing.js). */
export const STAND_GHOST_SOURCE = 'occ-stand-ghost';
/** The source of each collection of buildStandFeatures (stands/standFeatures.js). */
export const STAND_SOURCES = Object.freeze({
  polygons: STAND_SOURCE, aux: STAND_AUX_SOURCE, labels: STAND_LABEL_SOURCE, groups: STAND_GROUP_SOURCE,
  footprints: STAND_FOOTPRINT_SOURCE,
});
export const STAND_GROUP = 'stands';
/**
 * The group of the aircraft to scale on the stands: the layers menu's «Aviones a escala» of design E7 when it comes,
 * and what the 3D layer of PR M7 hides where it draws the models.
 */
export const FOOTPRINT_GROUP = 'stands.footprints';
/** The layer that paints every stand's polygon: the pick target of a stand. */
export const STAND_FILL_LAYER = 'occ-stands-fill';
/** The layer of the terminal chips: the pick target of a terminal. */
export const STAND_CHIP_LAYER = 'occ-stand-groups';
/** The layers of the stands' own labels, which leave out the selected stand's (standLabelFilter). */
export const STAND_LABEL_LAYER_IDS = Object.freeze(['occ-stand-labels', 'occ-stand-labels-3']);
/** `dashboard` is the console's apron map: codes from the stand polygons on, planned stands placed first. */
export const STAND_LABEL_MODES = Object.freeze(['default', 'dashboard']);
/** The feature-state keys of a stand polygon: hover, selection, the stand of the selected flight, the same agent. */
export const STAND_FEATURE_STATES = Object.freeze(['hover', 'selected', 'related', 'sameAgent']);

const STATE = ['get', 'state'];
const KIND = ['get', 'kind'];
const fonts = () => [...FONT_STACKS.bold];
const LABEL_SIZE = 12;
const CHIP_TEXT_SIZE = 13;
// The selection casing hugs the outline: 0.5 px clear of it on both sides, 2 px of cyan beyond.
const CASING_CLEARANCE = 1;
const SAME_AGENT_CLEARANCE = 6;
const HOVER_OPACITY = 0.55;
// The aircraft of a stand stays inside its box at every zoom: a silhouette about 30 m across on the ground, sized with
// the map (twice as large for each zoom step). It stands in for the aircraft to scale (PR M6) where that is too small to
// read, and where the aircraft has no type to draw. Up to zoom 22, the ultra-close zoom of Mapa de posiciones (M9).
export const STAND_GLYPH_SIZE = Object.freeze(['interpolate', ['exponential', 2], ['zoom'], 13, 0.17, 16, 1.32, 19.5, 14.93, 22, 84.46]);
// Where the signal and the clock sit: the upper corners of the stand around its centre, about 15 m out on the ground
// (8 px when the stands are small), so they keep clear of the label in the middle as the map grows.
// The signal sits above the stand's box and the clock of «Por liberar» below it, on the stand's axis on screen: outside
// the label in the middle of the box, whatever the length of its code. From the codes on, the gap clears a two-line
// label (2 × 13.8 px) and, from the three lines on, a four-line one, with the 20 px image; both grow with the stand
// (about 13 px from its centre to its edge at zoom 16, twice as far for each zoom step). Below 15, where no label shows,
// they stay close to the small box.
const ICON_GAP_STOPS = Object.freeze([[14, 8], [15, 10], [15.5, 24], [16, 25], [17, 42], [18, 64], [19, 116], [20, 220], [21, 440], [22, 880]]);
const outsideOffset = side => ['interpolate', ['linear'], ['zoom'],
  ...ICON_GAP_STOPS.flatMap(([zoom, gap]) => [zoom, ['literal', [0, gap * side]]])];
// A label moves above or below the stand's centre when its neighbours leave no room in the middle.
const LABEL_ANCHORS = Object.freeze(['center', 'bottom', 'top']);
const LABEL_OFFSET_EM = 1.2;
// The selected stand's label takes only its own room (N29): a margin of 2 px, so the labels of the stands beside it keep
// their place, and its longest lines broken at about 14 em (on one line, «El avión ya está en la posición. Registra la
// llegada.» is about 24 em, wider than the stands on both sides). The same stand's own label leaves the stand labels by
// a layer filter (standLabelFilter), never by its opacity: an invisible label would still take its room. Until N29 a
// margin of 44 px kept that label away, and the labels of the neighbours with it.
const SELECTED_LABEL_PADDING = 2;
const SELECTED_LABEL_MAX_WIDTH_EM = 14;

// The marks the vocabulary's `extra` of a state asks the polygon layers for.
const AIRCRAFT_EXTRAS = new Set(['footprint-progress', 'clock']);

/**
 * How «Ubicar en el mapa» draws, in the actionable colour (cyan): the box that follows the pointer is dashed while it
 * floats and solid once it fits the stand's outline in the layout; the pending location is a solid, wider outline over
 * a light wash, with a dot at its centre. Widths and dashes in pixels.
 */
export const PLACING_PAINT = Object.freeze({
  ghost: Object.freeze({ width: 2, dash: Object.freeze([4, 3]) }),
  pending: Object.freeze({ width: 2.5, fillOpacity: 0.2, centreRadius: 3 }),
});

/**
 * The fill of each stand state (owner request of 2026-11-15, style/mapColors.js): `{ color, opacity }`, its own soft
 * colour per state (Libre green, Planificada blue, Llegando cyan, Ocupada amber, Por liberar violet, Inhabilitada grey
 * under its hatch, Sin verificar a faint neutral) under the vocabulary's outline, dash and marks, which still tell every
 * state apart without colour.
 */
export function standFill(state, theme = 'dark') {
  if (!Object.hasOwn(STAND_STATES, state)) throw new RangeError(`Unknown stand state: ${String(state)}`);
  return mapColorsFor(theme).stands[state];
}

/**
 * How the aircraft to scale are drawn (PR M6, design D3), widths and dashes in pixels, tokens of occPalette.js: the
 * aircraft on a stand is a light silhouette over the stand's slab with a hairline in the text colour; the one still to
 * come only its outline, dashed 4-3 in the muted colour, as the outline of a planned stand. No hue: they are normal
 * states.
 */
export const FOOTPRINT_PAINT = Object.freeze({
  solid: Object.freeze({ fillToken: 'muted', fillOpacity: 0.35, outlineToken: 'text', width: 1 }),
  planned: Object.freeze({ token: 'muted', width: 1.5, dash: Object.freeze([4, 3]) }),
});

/**
 * The progress bar of a turnaround along the stand's rear edge (PR M6, design D3): its track in the strong line colour
 * and the part done in the text colour, 3 px wide. One colour whatever the time: there is no «late» colour.
 */
export const PROGRESS_PAINT = Object.freeze({ width: 3, trackToken: 'line-strong', doneToken: 'text' });

function dashName(dash) {
  if (dash === null) return 'solid';
  return `${dash[0] <= 1 ? 'dot' : 'dash'}-${dash.join('-')}`;
}

/**
 * How a stand state is drawn, from the vocabulary: `{ fill, outline, glyph, clock, leadIn, link, mutedCode }`.
 * - `fill`: `{ kind ('none' | 'tint' | 'solid' | 'hatch'), token, color, opacity }`, the colour of the token or `null`;
 * - `outline`: `{ token, color, width, dash, layer }`, the width and dash in pixels and the outline layer that draws it
 *   (one layer per dash of the vocabulary, Decision D-1);
 * - `glyph`: `aircraft` for a stand with an aircraft on it (Ocupada, Por liberar), else `null`;
 * - `clock` (Por liberar), `leadIn` (Llegando: the lead-in emphasised), `link` (Inhabilitada: the link to the stand that
 *   cancels it) and `mutedCode` (Sin verificar: its code in the faint token). A RangeError for any other state.
 */
export function standPaint(state) {
  if (!Object.hasOwn(STAND_STATES, state)) throw new RangeError(`Unknown stand state: ${String(state)}`);
  const { fill, outline, dash, extra } = STAND_STATES[state];
  return {
    fill: { kind: fill.kind, token: fill.token, color: fill.token ? occColor(fill.token) : null, opacity: fill.opacity },
    outline: {
      token: outline.token,
      color: occColor(outline.token),
      width: outline.width,
      dash: dash === null ? null : [...dash],
      layer: `occ-stands-outline-${dashName(dash)}`,
    },
    glyph: AIRCRAFT_EXTRAS.has(extra) ? 'aircraft' : null,
    clock: extra === 'clock',
    leadIn: extra === 'lead-in',
    link: extra === 'combined-link',
    mutedCode: extra === 'muted-code',
  };
}

const statesWhere = predicate => STAND_STATE_KEYS.filter(state => predicate(standPaint(state)));
// A `match` on the stand state over `states`, with `value(state)` for each; the fallback is the first state's value.
const byState = (states, value) => ['match', STATE, ...states.flatMap(state => [state, value(state)]), value(states[0])];
const inStates = states => ['match', STATE, [...states], true, false];
const featureState = key => ['boolean', ['feature-state', key], false];
const metadata = (extra = {}) => ({ 'occ:group': STAND_GROUP, 'occ:minThreshold': 'polygons', ...extra });

function standLayer(id, type, { source = STAND_SOURCE, filter, layout, paint, meta } = {}) {
  return {
    slot: 'stands',
    id,
    type,
    source,
    ...(filter ? { filter } : {}),
    ...(layout ? { layout } : {}),
    paint,
    metadata: metadata(meta),
  };
}

// One outline layer per dash of the vocabulary, its dash constant (in line widths, as MapLibre counts it). States that
// share a dash but not a width get a layer each, so the dash stays the vocabulary's in pixels.
function outlineLayers() {
  const groups = new Map();
  for (const state of STAND_STATE_KEYS) {
    const { outline } = standPaint(state);
    const key = outline.dash === null ? outline.layer : `${outline.layer}|${outline.width}`;
    if (!groups.has(key)) groups.set(key, { outline, states: [] });
    groups.get(key).states.push(state);
  }
  const ids = [...groups.values()].map(group => group.outline.layer);
  return [...groups.values()].map(({ outline, states }) => {
    const shared = ids.filter(id => id === outline.layer).length > 1;
    const id = shared ? `${outline.layer}-${String(outline.width).replace('.', '-')}px` : outline.layer;
    return standLayer(id, 'line', {
      filter: inStates(states),
      layout: { 'line-join': 'miter' },
      paint: {
        'line-color': byState(states, state => standPaint(state).outline.color),
        'line-width': byState(states, state => standPaint(state).outline.width),
        ...(outline.dash === null ? {} : { 'line-dasharray': outline.dash.map(length => length / outline.width) }),
      },
    });
  });
}

// A casing around every stand outline, as wide as the outline plus `clearance`, shown by feature-state.
function casingLayer(id, { color, width, clearance, opacity, dash }) {
  return standLayer(id, 'line', {
    layout: { 'line-join': 'miter' },
    paint: {
      'line-color': color,
      'line-width': width,
      'line-gap-width': byState(STAND_STATE_KEYS, state => standPaint(state).outline.width + clearance),
      ...(dash ? { 'line-dasharray': dash.map(length => length / width) } : {}),
      'line-opacity': opacity,
    },
  });
}

function polygonLayers(theme) {
  const hatched = statesWhere(paint => paint.fill.kind === 'hatch');
  const emphasised = statesWhere(paint => paint.leadIn);
  const linked = statesWhere(paint => paint.link);
  const lead = standPaint(emphasised[0]).outline;
  const link = standPaint(linked[0]).outline;
  return [
    // Every state, so every stand is a pick target, in its own colour (standFill); the hatch has a layer of its own.
    standLayer(STAND_FILL_LAYER, 'fill', {
      paint: {
        'fill-color': byState(STAND_STATE_KEYS, state => standFill(state, theme).color),
        'fill-opacity': byState(STAND_STATE_KEYS, state => standFill(state, theme).opacity),
      },
      meta: { 'occ:pick': 'stand', 'occ:pickId': 'code' },
    }),
    standLayer('occ-stands-hatch', 'fill', { filter: inStates(hatched), paint: { 'fill-pattern': 'stand-hatch-pattern' } }),
    ...outlineLayers(),
    // Where the aircraft taxis in: a hairline from the codes on, and the arriving stand's, as wide as its outline, from
    // the polygons on. It never moves.
    standLayer('occ-stands-leadin', 'line', {
      source: STAND_AUX_SOURCE,
      filter: ['==', KIND, 'leadIn'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': occColor('line-strong'), 'line-width': 1 },
      meta: { 'occ:minThreshold': 'codes' },
    }),
    standLayer('occ-stands-leadin-arriving', 'line', {
      source: STAND_AUX_SOURCE,
      filter: ['all', ['==', KIND, 'leadIn'], inStates(emphasised)],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': lead.color, 'line-width': lead.width },
    }),
    // The link from a stand a combined stand cancels to the stand that cancels it, in the cancelled stand's outline.
    standLayer('occ-stands-combined-link', 'line', {
      source: STAND_AUX_SOURCE,
      filter: ['==', KIND, 'combinedLink'],
      paint: {
        'line-color': link.color,
        'line-width': link.width,
        'line-dasharray': link.dash.map(length => length / link.width),
      },
    }),
    // The code-C box inside a larger stand limited to narrow-body aircraft, dotted.
    standLayer('occ-stands-narrow-inner', 'line', {
      source: STAND_AUX_SOURCE,
      filter: ['==', KIND, 'narrowInner'],
      paint: { 'line-color': occColor('line-strong'), 'line-width': 1, 'line-dasharray': [1, 2] },
      meta: { 'occ:minThreshold': 'codes' },
    }),
    // The progress of the turnaround on the stand (PR M6): the whole bar, then the milestones done over it, with the
    // three-line labels.
    standLayer('occ-stands-progress-track', 'line', {
      source: STAND_AUX_SOURCE,
      filter: ['==', KIND, 'progressTrack'],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': occColor(PROGRESS_PAINT.trackToken), 'line-width': PROGRESS_PAINT.width },
      meta: { 'occ:minThreshold': 'threeLine' },
    }),
    standLayer('occ-stands-progress-done', 'line', {
      source: STAND_AUX_SOURCE,
      filter: ['==', KIND, 'progressDone'],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': occColor(PROGRESS_PAINT.doneToken), 'line-width': PROGRESS_PAINT.width },
      meta: { 'occ:minThreshold': 'threeLine' },
    }),
    // The selection: a 2 px cyan casing; the stand under the pointer gets it lighter.
    casingLayer('occ-stands-selection', {
      color: occColor('accent'),
      width: 2,
      clearance: CASING_CLEARANCE,
      opacity: ['case', featureState('selected'), 1, featureState('hover'), HOVER_OPACITY, 0],
    }),
    // The stand of the selected flight: a dashed cyan casing (never on the selected stand itself).
    casingLayer('occ-stands-related', {
      color: occColor('accent'),
      width: 1.5,
      clearance: CASING_CLEARANCE,
      dash: [3, 2],
      opacity: ['case', ['all', featureState('related'), ['!', featureState('selected')]], 1, 0],
    }),
    // Stands covered by the same agent as the selected or hovered one: a neutral line set off from the outline.
    casingLayer('occ-stands-same-agent', {
      color: occColor('muted'),
      width: 1,
      clearance: SAME_AGENT_CLEARANCE,
      opacity: ['case', featureState('sameAgent'), 1, 0],
    }),
  ];
}

// The aircraft of the stands at true size (PR M6), in the slot above the stands and the chosen flight's route: from the
// codes on, where a footprint is large enough to read.
function footprintLayers() {
  const { solid, planned } = FOOTPRINT_PAINT;
  const layer = (id, type, kind, paint) => ({
    slot: 'footprints',
    id,
    type,
    source: STAND_FOOTPRINT_SOURCE,
    filter: ['==', KIND, kind],
    ...(type === 'line' ? { layout: { 'line-join': 'round' } } : {}),
    paint,
    metadata: metadata({ 'occ:group': FOOTPRINT_GROUP, 'occ:minThreshold': 'codes' }),
  });
  return [
    layer('occ-footprints-fill', 'fill', 'solid', {
      'fill-color': occColor(solid.fillToken), 'fill-opacity': solid.fillOpacity,
    }),
    layer('occ-footprints-outline', 'line', 'solid', {
      'line-color': occColor(solid.outlineToken), 'line-width': solid.width,
    }),
    layer('occ-footprints-planned', 'line', 'planned', {
      'line-color': occColor(planned.token),
      'line-width': planned.width,
      'line-dasharray': planned.dash.map(length => length / planned.width),
    }),
  ];
}

function labelLayer(id, { source = STAND_LABEL_SOURCE, filter, layout, paint, meta, closeUp = 'hide' }) {
  return {
    slot: 'standLabels',
    id,
    type: 'symbol',
    source,
    ...(filter ? { filter } : {}),
    layout,
    paint,
    // M4: the designators are hidden close up (core/mapEngine.js: setCloseUp); the signals are not.
    metadata: metadata({ ...(closeUp ? { 'occ:closeUp': closeUp } : {}), ...meta }),
  };
}

const textLayout = (field, { placed = 'centre' } = {}) => ({
  'text-field': field,
  'text-font': fonts(),
  'text-size': LABEL_SIZE,
  'text-line-height': 1.15,
  'text-max-width': 30,
  'text-justify': 'center',
  ...(placed === 'variable'
    ? { 'text-variable-anchor': [...LABEL_ANCHORS], 'text-radial-offset': LABEL_OFFSET_EM }
    : { 'text-anchor': 'center' }),
  'text-padding': 1,
});

// The selected stand's label: always drawn, in the middle of its stand, with its own small room (N29).
const selectedLabelLayout = field => ({
  ...textLayout(field),
  'text-max-width': SELECTED_LABEL_MAX_WIDTH_EM,
  'text-allow-overlap': true,
  'text-padding': SELECTED_LABEL_PADDING,
});

const codeColour = () => byState(STAND_STATE_KEYS, state => occColor(standPaint(state).mutedCode ? 'faint' : 'text'));

// The aircraft glyph of a stand, sized with the map so it stays inside the box at every zoom.
const glyphLayout = () => ({
  'icon-image': 'glyph-aircraft',
  'icon-size': [...STAND_GLYPH_SIZE],
  'icon-rotate': ['get', 'heading'],
  'icon-rotation-alignment': 'map',
  'icon-pitch-alignment': 'map',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
});

// The image and the colour of each signal (SIGNALS): the amber triangle, the red octagon, and the plain notice, a diamond
// without a hue in the text colour.
const SIGNAL_IMAGE = ['match', ['get', 'signal'], 'urgent', 'signal-urgent', 'notice', 'signal-notice', 'signal-attention'];
const signalColour = () => ['match', ['get', 'signal'],
  'urgent', occColor(SIGNALS.urgent.colorToken),
  'notice', occColor('text'),
  occColor(SIGNALS.attention.colorToken)];

function labelLayers(labels) {
  const aircraft = statesWhere(paint => paint.glyph === 'aircraft');
  const textPaint = { 'text-color': codeColour(), 'text-halo-color': occColor('nav'), 'text-halo-width': 1.5 };
  const selectedPaint = { 'text-color': occColor('accent'), 'text-halo-color': occColor('nav'), 'text-halo-width': 2 };
  const isStand = ['==', KIND, 'stand'];
  return [
    // One chip per terminal while the stands are too small to draw: «A · 3/16», on the raised slab with a 1 px joint.
    // A click on it opens the terminal's view.
    labelLayer(STAND_CHIP_LAYER, {
      source: STAND_GROUP_SOURCE,
      layout: {
        'text-field': ['get', 'text'],
        'text-font': fonts(),
        'text-size': CHIP_TEXT_SIZE,
        'icon-image': 'stand-chip',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 6, 2, 6],
        'icon-allow-overlap': true,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': occColor('text'),
        'icon-color': occColor('panel-raised'),
        'icon-halo-color': occColor('line-strong'),
        'icon-halo-width': 1,
      },
      meta: { 'occ:minThreshold': 'airfield', 'occ:maxThreshold': 'polygons', 'occ:pick': 'terminal', 'occ:pickId': 'terminal' },
    }),
    // A flight arriving at one of the terminal's stands: an arrow down at the chip.
    labelLayer('occ-stand-groups-arriving', {
      source: STAND_GROUP_SOURCE,
      filter: ['==', ['get', 'arriving'], true],
      layout: {
        'icon-image': 'glyph-arriving',
        'icon-anchor': 'bottom',
        'icon-offset': [0, -10],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-color': occColor('text'), 'icon-halo-color': occColor('nav'), 'icon-halo-width': 1 },
      meta: { 'occ:minThreshold': 'airfield', 'occ:maxThreshold': 'polygons' },
    }),
    // The aircraft on a stand, its nose along the stand's heading, in the outline's token: below the codes, where the
    // aircraft to scale is too small to read (PR M6), on every stand with an aircraft on it; from the codes on only on
    // one whose aircraft has no type to draw, since the others show their footprint.
    labelLayer('occ-stand-glyph', {
      filter: ['==', ['get', 'glyph'], 'aircraft'],
      layout: glyphLayout(),
      paint: { 'icon-color': byState(aircraft, state => standPaint(state).outline.color) },
      meta: { 'occ:maxThreshold': 'codes' },
    }),
    labelLayer('occ-stand-glyph-unsized', {
      filter: ['all', ['==', ['get', 'glyph'], 'aircraft'], ['!=', ['get', 'footprint'], 'solid']],
      layout: glyphLayout(),
      paint: { 'icon-color': byState(aircraft, state => standPaint(state).outline.color) },
      meta: { 'occ:minThreshold': 'codes' },
    }),
    // The clock of «Por liberar», below the stand's box, on the slab's colour. Always drawn, and the labels give way to
    // it (MapLibre places the upper layers first).
    labelLayer('occ-stand-clock', {
      filter: ['==', ['get', 'clock'], true],
      layout: {
        'icon-image': 'glyph-clock',
        'icon-offset': outsideOffset(1),
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
        'icon-padding': 0,
      },
      paint: { 'icon-color': occColor('text'), 'icon-halo-color': occColor('panel-raised'), 'icon-halo-width': 1.5 },
    }),
    // Code, or code and flight («Anulada por 9A» for a cancelled stand), from the codes on and up to the three lines.
    labelLayer('occ-stand-labels', {
      layout: {
        ...textLayout(['case', ['==', STATE, 'available'], ['get', 'label1'], ['get', 'label2']], { placed: 'variable' }),
        'symbol-sort-key': ['get', 'sortKey'],
      },
      paint: textPaint,
      meta: {
        'occ:minThreshold': labels === 'dashboard' ? 'polygons' : 'codes',
        'occ:maxThreshold': 'threeLine',
      },
    }),
    labelLayer('occ-stand-labels-3', {
      layout: { ...textLayout(['get', 'label3'], { placed: 'variable' }), 'symbol-sort-key': ['get', 'sortKey'] },
      paint: textPaint,
      meta: { 'occ:minThreshold': 'threeLine' },
    }),
    // The selected stand's label, from the selection source: above the others, so MapLibre places it first, and the
    // same stand's own label is left out of the layers below (standLabelFilter). It keeps only a margin of 2 px, so the
    // labels beside it give way only where they would touch it (N29). From the polygons on, whatever the codes threshold.
    labelLayer('occ-stand-label-selected', {
      source: SELECTION_SOURCE,
      filter: isStand,
      layout: selectedLabelLayout(['get', 'label2']),
      paint: selectedPaint,
      meta: { 'occ:maxThreshold': 'threeLine' },
    }),
    labelLayer('occ-stand-label-selected-3', {
      source: SELECTION_SOURCE,
      filter: isStand,
      layout: selectedLabelLayout(['get', 'label3']),
      paint: selectedPaint,
      meta: { 'occ:minThreshold': 'threeLine' },
    }),
    // The signals, on top of everything of the stands: amber triangle (attention), red octagon (urgent) or the plain
    // notice's diamond without a hue (PR M6), above the stand's box with a dark halo that fills their «!». Always drawn,
    // never over the stand's code: the labels are placed after them and give way.
    labelLayer('occ-stand-signal', {
      closeUp: null,
      filter: ['to-boolean', ['get', 'signal']],
      layout: {
        'icon-image': [...SIGNAL_IMAGE],
        'icon-offset': outsideOffset(-1),
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
        'icon-padding': 0,
      },
      paint: {
        'icon-color': signalColour(),
        'icon-halo-color': occColor('nav'),
        'icon-halo-width': 1.5,
      },
    }),
  ];
}

// The placing layers, in the top slot above everything of the stands and the selection ring, at every zoom: a person
// may place a stand from the airfield view as well.
function placingLayers() {
  const accent = occColor('accent');
  const { ghost, pending } = PLACING_PAINT;
  const snapped = ['==', ['get', 'snapped'], true];
  const layer = (id, type, { filter, layout, paint }) => ({
    slot: 'selection', id, type, source: STAND_GHOST_SOURCE, filter, ...(layout ? { layout } : {}), paint,
    metadata: { 'occ:group': STAND_GROUP },
  });
  return [
    layer('occ-stand-ghost-fill', 'fill', {
      filter: ['==', KIND, 'pending'],
      paint: { 'fill-color': accent, 'fill-opacity': pending.fillOpacity },
    }),
    layer('occ-stand-ghost-pending', 'line', {
      filter: ['==', KIND, 'pending'],
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': accent, 'line-width': pending.width },
    }),
    layer('occ-stand-ghost-outline', 'line', {
      filter: ['all', ['==', KIND, 'ghost'], ['!', snapped]],
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': accent, 'line-width': ghost.width, 'line-dasharray': ghost.dash.map(length => length / ghost.width) },
    }),
    layer('occ-stand-ghost-snapped', 'line', {
      filter: ['all', ['==', KIND, 'ghost'], snapped],
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': accent, 'line-width': ghost.width },
    }),
    layer('occ-stand-ghost-centre', 'circle', {
      filter: ['==', KIND, 'centre'],
      paint: {
        'circle-radius': pending.centreRadius,
        'circle-color': accent,
        'circle-stroke-color': occColor('nav'),
        'circle-stroke-width': 1.5,
      },
    }),
  ];
}

function assertLabels(labels) {
  if (!STAND_LABEL_MODES.includes(labels)) throw new RangeError(`Unknown stand label mode: ${String(labels)}`);
}

/**
 * The overlay of the stands for buildOccStyle: the six sources (the polygons `occ-stands`, their lines
 * `occ-stand-aux`, the label points `occ-stand-labels`, the terminal chips `occ-stand-groups`, the aircraft to scale
 * `occ-aircraft-footprints`, each keyed by the property buildStandFeatures promotes, and the placing boxes
 * `occ-stand-ghost`) and their layers. In the `stands` slot: the fill (the pick target), the hatch, one outline per
 * dash, the lead-ins, the combined links, the narrow-body boxes, the progress bars and the three casings of the feature
 * state. In the `footprints` slot: the aircraft on a stand (fill and outline) and the one to come (dashed). In the
 * `standLabels` slot: the chips, the aircraft glyph (below the codes, and from them where no type is drawn), the clock,
 * the labels in two variants (STAND_LABEL_LAYER_IDS, which leave out the selected stand's: standLabelFilter), the
 * selected stand's label (from the selection source) and the signals. In the `selection` slot: the pending location of
 * «Ubicar en el mapa» and the box that follows the pointer.
 * `labels: 'dashboard'` starts the codes at the polygons.
 */
export function standOverlay({ labels = 'default', theme = 'dark' } = {}) {
  assertLabels(labels);
  return {
    sources: {
      [STAND_SOURCE]: { type: 'geojson', promoteId: 'code' },
      [STAND_AUX_SOURCE]: { type: 'geojson', promoteId: 'id' },
      [STAND_LABEL_SOURCE]: { type: 'geojson', promoteId: 'code' },
      [STAND_GROUP_SOURCE]: { type: 'geojson', promoteId: 'terminal' },
      [STAND_FOOTPRINT_SOURCE]: { type: 'geojson', promoteId: 'id' },
      [STAND_GHOST_SOURCE]: { type: 'geojson', promoteId: 'id' },
    },
    layers: [...polygonLayers(theme), ...footprintLayers(), ...labelLayers(labels), ...placingLayers()],
  };
}

/**
 * The filter of the stand labels (STAND_LABEL_LAYER_IDS) while stand `code` is selected (N29): every stand's label but
 * that stand's, whose cyan label comes from the selection source alone; `null` (no filter) without a selected stand.
 * `code` is the code the label points carry (buildStandFeatures: the normalized code). A layer filter, and not the
 * labels' opacity: an invisible label would still take its room from the labels beside it. The two layers have no
 * filter of their own for it to replace.
 */
export function standLabelFilter(code) {
  return typeof code === 'string' && code !== '' ? ['!=', ['get', 'code'], code] : null;
}

/**
 * How the stands are drawn at `zoom` with the screen's thresholds: `hidden` below the airfield threshold (the region
 * and approach views), `chips` from there up to the polygon threshold (one chip per terminal) and `polygons` from it
 * on. Before the thresholds are known the layers have no zoom range yet: the polygons are drawn.
 */
export function standDisplayAt(zoom, thresholds) {
  if (!Number.isFinite(zoom) || !Number.isFinite(thresholds?.polygons) || zoom >= thresholds.polygons) return 'polygons';
  return Number.isFinite(thresholds.airfield) && zoom >= thresholds.airfield ? 'chips' : 'hidden';
}
