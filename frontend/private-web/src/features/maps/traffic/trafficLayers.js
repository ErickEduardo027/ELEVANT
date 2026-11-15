import { occColor } from '../../occ-ui/occPalette';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { altitudeColourExpression } from '../style/mapColors';
import { FONT_STACKS } from '../style/occStyle';
import { DEMO_PLATE_IMAGE, ESTIMATED_RING_IMAGE, ROUTE_MARK_IMAGE, TAG_GLYPHS } from '../style/trafficImages';
import { ROUTE_SOURCE, TRAFFIC_SOURCE, TRAILS_SOURCE } from './trafficFeatures';

// The traffic of the OCC maps as one overlay for buildOccStyle (design E1, contracts 2.4), fed by OccMap: the aircraft
// (traffic/trafficFeatures.js) with updateData, their trails (traffic/trailStore.js) and the chosen flight's route
// with setData. Every aircraft is coloured by its altitude (owner request of 2026-11-15, style/mapColors.js: orange near
// the ground to violet at 40 000 ft, light grey on the ground, ui/AltitudeLegend.jsx explains it); only the chosen
// aircraft is cyan, with its ring. Estimated, stale and demo are told by a dashed ring, an age, a dimmed symbol and a
// striped plate, never by colour alone. Pure.
//
// Layers bottom to top. In the `routes` slot the chosen flight's route (PR M6, traffic/routeFeatures.js), in the
// selection's cyan and told apart by its line, never by a hue: flown as observed (solid), flown as estimated (thin and
// faint, «Trayecto estimado»), still to fly (dashed, static: only aircraft move) and its marked points (small rings, an
// apron hold with its words, «Posición por asignar»). In the
// `traffic` slot: the trails of other traffic (off until «Estelas de todo el tráfico»), the live trails fading toward
// their tail, the estimated ones dashed; other traffic on the ground (from the airfield threshold up) and in the air,
// each icon with its tag in one symbol; the tags of all other traffic (off until «Etiquetas de todo el tráfico»); the
// ELEVANT flights, the estimated ring, their tags and the «Demo» plate. In the `selection` slot the chosen aircraft's
// ring and the aircraft again, in cyan: both read its own feature, so they move with it in the same write, and the
// selection source (style/selectionLayers.js) keeps the stands and the flights a screen places itself.
// Placement: MapLibre places the layers from the top down and boxes a rotated icon with its whole image, so a tag must
// never meet its own icon in the collision index. Other traffic shares one symbol for its icon and its tag (the tag then
// ignores its own icon and draws above the icons of its layer). The tags of all other traffic sit above those icons, so
// they are placed before them: they keep off the ELEVANT symbols and off each other, never off their own aircraft. The
// ELEVANT tags carry images in their text, and MapLibre does not draw a layer's icons next to text with images, so they
// have a layer of their own above the icons: placed before them, they keep off the plates only, and they draw above
// every aircraft.

/** The layers-menu groups of the traffic (layers menu, PR M5 step c). */
export const TRAFFIC_GROUPS = Object.freeze({
  aviam: 'traffic.aviam', other: 'traffic.other', labels: 'traffic.labels', trails: 'traffic.trails', route: 'route',
});

const get = key => ['get', key];
// A flag of the features (trafficFeatures.js): true, or anything else as false.
const is = key => ['==', get(key), true];
const isNot = key => ['!=', get(key), true];
const AVIAM = ['==', get('kind'), 'aviam'];
const OTHER = ['==', get('kind'), 'other'];
// An ELEVANT aircraft parked in the stand that shows it is the stand's (PR M6, design F4: one owner per aircraft): its
// symbol and tag give way to the stand's footprint or glyph; the chosen aircraft is drawn all the same. Its marks stay:
// an estimated position keeps its dashed ring and a demo flight its «Demo» plate over the stand (contracts 2.4, «Tags»:
// whatever is estimated or simulated carries its mark on screen).
const NOT_PARKED = isNot('parkedOnStand');
// A stale position is dimmed to half; an aircraft fading out (PR M6: a cancelled demo, traffic that lost its signal)
// carries its own opacity, which multiplies it, so the icon, its ring, its tag and its plate fade together.
const DIMMED = ['*', ['case', is('stale'), 0.5, 1], ['coalesce', get('opacity'), 1]];
const FADED = ['coalesce', get('opacity'), 1];
const bold = () => ['literal', [...FONT_STACKS.bold]];

// An OCC colour with its alpha, for the fading trail: the token's own colour, never a new hue.
function withAlpha(token, alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(occColor(token));
  if (!match) throw new RangeError(`The trail needs a #rrggbb token, not ${token}`);
  const [red, green, blue] = match.slice(1).map(hex => parseInt(hex, 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const iconLayout = (extra = {}) => ({
  'icon-image': get('icon'),
  'icon-size': get('scale'),
  'icon-rotate': get('trk'),
  'icon-rotation-alignment': 'map',
  'icon-pitch-alignment': 'map',
  'icon-allow-overlap': true,
  // In the collision index, so the tags of other aircraft keep off it.
  'icon-ignore-placement': false,
  'icon-padding': 0,
  ...extra,
});

const iconPaint = (colour, haloWidth) => ({
  'icon-color': colour,
  'icon-halo-color': occColor('nav'),
  'icon-halo-width': haloWidth,
  'icon-opacity': DIMMED,
});

// The second line of every tag: type, altitude (GND on the ground) and knots.
const SECOND_LINE = ['\n', {}, get('tag2'), { 'font-scale': 0.9 }];
// «est.» or the age of a stale position, muted, after the name.
const SUFFIX = [['case', ['==', get('suffix'), ''], '', ['concat', ' ', get('suffix')]], { 'text-color': occColor('muted') }];

/** The tag of an ELEVANT flight: its arrival or departure glyph, its number, and the stand an arrival goes to. */
function aviamTag({ stand }) {
  return [
    'format',
    ['image', ['case', ['==', get('dir'), 'dep'], TAG_GLYPHS.departure, TAG_GLYPHS.arrival]], { 'vertical-align': 'center' },
    ' ', {},
    get('tag1'), { 'text-font': bold() },
    ...SUFFIX,
    ...SECOND_LINE,
    ...(stand ? ['  ', {}, ['image', TAG_GLYPHS.stand], { 'vertical-align': 'center' }, ' ', {}, get('tagStand'),
      { 'text-font': bold() }] : []),
  ];
}

/** The tag of other traffic: its callsign (or registration, or address) and the same second line. */
const OTHER_TAG = ['format', get('tag1'), { 'text-font': bold() }, ...SUFFIX, ...SECOND_LINE];
// No tag: the symbol is its icon alone.
const NO_TAG = ['format', '', {}];

// Beside the aircraft, wherever it fits best, clear of its silhouette: right first, then left, below, above.
const TAG_ANCHORS = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const tagLayout = (size, extra = {}) => ({
  'text-size': size,
  'text-font': [...FONT_STACKS.regular],
  'text-variable-anchor': TAG_ANCHORS,
  'text-radial-offset': ['+', ['/', get('radius'), size], 0.4],
  'text-justify': 'auto',
  'text-line-height': 1.15,
  'text-max-width': 24,
  'text-rotation-alignment': 'viewport',
  'text-pitch-alignment': 'viewport',
  ...extra,
});

// Other traffic: its icon, and its tag while it is chosen or under the pointer, placed after the rest of its layer so
// it keeps off the icons around it and draws above them.
const otherLayout = () => ({
  ...iconLayout(),
  ...tagLayout(11, {
    'text-field': ['case', is('forceTag'), OTHER_TAG, NO_TAG],
    'text-allow-overlap': true,
    'symbol-sort-key': ['case', is('forceTag'), 1, 0],
  }),
});

const tagPaint = colour => ({
  'text-color': colour,
  'text-halo-color': occColor('nav'),
  'text-halo-width': 1.5,
  'text-opacity': DIMMED,
});

// The «Demo» plate under the aircraft: its centre below the silhouette, further for larger ones (`radius`).
const PLATE_CENTRE_PX = Object.freeze([[0, 22], [12, 25], [14, 27], [16, 29], [18, 31]]);
const PLATE_TEXT_SIZE = 11;
const plateOffset = toUnit => ['step', get('radius'), ['literal', [0, toUnit(PLATE_CENTRE_PX[0][1])]],
  ...PLATE_CENTRE_PX.slice(1).flatMap(([radius, centre]) => [radius, ['literal', [0, toUnit(centre)]]])];
const ems = pixels => Math.round((pixels / PLATE_TEXT_SIZE) * 1000) / 1000;

const ACCENT = occColor('accent');
// The colour of every aircraft but the chosen one: its altitude (style/mapColors.js).
const ALTITUDE = altitudeColourExpression();
// The ring of the chosen aircraft: the selection's own ring (style/selectionLayers.js: occ-selection-ring), 2 px of
// cyan clear of the silhouette.
const SELECTED_RING_RADIUS_PX = 18;
const SELECTED_RING_WIDTH_PX = 2;

/** How the parts of the chosen flight's route are drawn (design E5): width in px, opacity, dashes. */
export const ROUTE_STYLE = Object.freeze({
  flownObserved: Object.freeze({ width: 2.5, opacity: 1 }),
  flownEstimated: Object.freeze({ width: 1.5, opacity: 0.55 }),
  remaining: Object.freeze({ width: 1.5, opacity: 1, dash: Object.freeze([2, 2]) }),
});

// One line layer per part of the route, filtered by its `part`.
function routeLine(id, part) {
  const { width, opacity, dash } = ROUTE_STYLE[part];
  return {
    slot: 'routes',
    id,
    type: 'line',
    source: ROUTE_SOURCE,
    filter: ['==', get('part'), part],
    layout: dash ? { 'line-join': 'round' } : { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ACCENT,
      'line-width': width,
      ...(opacity === 1 ? {} : { 'line-opacity': opacity }),
      ...(dash ? { 'line-dasharray': [...dash] } : {}),
    },
    metadata: { 'occ:group': TRAFFIC_GROUPS.route },
  };
}

/** The ids of the route's layers, one per part of traffic/routeFeatures.js's ROUTE_PARTS. */
export const ROUTE_LAYER_IDS = Object.freeze({
  flownObserved: 'occ-route-flown',
  flownEstimated: 'occ-route-flown-estimated',
  remaining: 'occ-route-remaining',
  mark: 'occ-route-marks',
});

/** The overlay of the traffic for buildOccStyle; its three sources start empty. */
export function trafficOverlay() {
  return {
    sources: {
      [TRAFFIC_SOURCE]: { type: 'geojson', promoteId: 'id' },
      [TRAILS_SOURCE]: { type: 'geojson', lineMetrics: true },
      [ROUTE_SOURCE]: { type: 'geojson' },
    },
    layers: [
      // What it flew estimated, under what it flew observed, under what it still has to fly.
      routeLine(ROUTE_LAYER_IDS.flownEstimated, 'flownEstimated'),
      routeLine(ROUTE_LAYER_IDS.flownObserved, 'flownObserved'),
      routeLine(ROUTE_LAYER_IDS.remaining, 'remaining'),
      {
        slot: 'routes',
        id: ROUTE_LAYER_IDS.mark,
        type: 'symbol',
        source: ROUTE_SOURCE,
        filter: ['==', get('part'), 'mark'],
        layout: {
          'icon-image': ROUTE_MARK_IMAGE,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'map',
          // Only an apron hold has words: «Posición por asignar», beside its ring.
          'text-field': ['coalesce', get('label'), ''],
          'text-font': [...FONT_STACKS.bold],
          'text-size': 12,
          'text-anchor': 'left',
          'text-offset': [0.8, 0],
          'text-optional': true,
          'text-rotation-alignment': 'viewport',
          'text-pitch-alignment': 'viewport',
        },
        paint: {
          'icon-color': ACCENT,
          'icon-halo-color': occColor('nav'),
          'icon-halo-width': 1.5,
          'text-color': ACCENT,
          'text-halo-color': occColor('nav'),
          'text-halo-width': 1.5,
        },
        metadata: { 'occ:group': TRAFFIC_GROUPS.route },
      },
      {
        slot: 'traffic',
        id: 'occ-trails-other',
        type: 'line',
        source: TRAILS_SOURCE,
        filter: ['all', OTHER, isNot('selected'), ['!=', get('quality'), 'estimated']],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': occColor('faint'), 'line-width': 1, 'line-opacity': ['case', ['==', get('quality'), 'stale'], 0.3, 0.6] },
        metadata: { 'occ:group': TRAFFIC_GROUPS.trails },
      },
      {
        slot: 'traffic',
        id: 'occ-trails-live',
        type: 'line',
        source: TRAILS_SOURCE,
        filter: ['all', ['any', AVIAM, is('selected')], ['!=', get('quality'), 'estimated']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 2,
          // The line runs from its oldest point to its newest: the tail fades out.
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, withAlpha('--occ-text', 0), 0.6,
            withAlpha('--occ-text', 0.45), 1, withAlpha('--occ-text', 0.9)],
          'line-opacity': ['case', ['==', get('quality'), 'stale'], 0.5, 1],
        },
        metadata: { 'occ:group': TRAFFIC_GROUPS.aviam },
      },
      {
        slot: 'traffic',
        id: 'occ-trails-estimated',
        type: 'line',
        source: TRAILS_SOURCE,
        filter: ['==', get('quality'), 'estimated'],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': occColor('muted'), 'line-width': 1.5, 'line-dasharray': [2, 2] },
        metadata: { 'occ:group': TRAFFIC_GROUPS.aviam },
      },
      {
        slot: 'traffic',
        id: 'occ-traffic-other-ground',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: ['all', OTHER, is('ground')],
        layout: otherLayout(),
        paint: { ...iconPaint(ALTITUDE, 1), ...tagPaint(occColor('muted')) },
        metadata: { 'occ:group': TRAFFIC_GROUPS.other, 'occ:pick': 'aircraft', 'occ:pickId': 'hex',
          'occ:minThreshold': 'airfield' },
      },
      {
        slot: 'traffic',
        id: 'occ-traffic-other',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: ['all', OTHER, isNot('ground')],
        layout: otherLayout(),
        paint: { ...iconPaint(ALTITUDE, 1), ...tagPaint(occColor('muted')) },
        metadata: { 'occ:group': TRAFFIC_GROUPS.other, 'occ:pick': 'aircraft', 'occ:pickId': 'hex' },
      },
      // Above the icons of other traffic, so MapLibre places these tags before them: a tag keeps off the ELEVANT
      // symbols and off the other tags, never off its own aircraft.
      {
        slot: 'traffic',
        id: 'occ-traffic-tags-other',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: ['all', OTHER, isNot('forceTag')],
        layout: tagLayout(11, { visibility: 'none', 'text-field': OTHER_TAG, 'text-allow-overlap': false }),
        paint: tagPaint(occColor('muted')),
        metadata: { 'occ:group': TRAFFIC_GROUPS.labels },
      },
      {
        slot: 'traffic',
        id: 'occ-traffic-aviam',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: ['all', AVIAM, NOT_PARKED],
        layout: iconLayout(),
        paint: iconPaint(ALTITUDE, 1.5),
        metadata: { 'occ:group': TRAFFIC_GROUPS.aviam, 'occ:pick': 'flight', 'occ:pickId': 'flightKey' },
      },
      {
        slot: 'traffic',
        id: 'occ-traffic-estimated-ring',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: is('estimated'),
        layout: {
          'icon-image': ESTIMATED_RING_IMAGE,
          'icon-size': get('scale'),
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': occColor('muted'), 'icon-halo-color': occColor('nav'), 'icon-halo-width': 1, 'icon-opacity': FADED,
        },
        metadata: { 'occ:group': TRAFFIC_GROUPS.aviam },
      },
      {
        slot: 'traffic',
        id: 'occ-traffic-tags',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: ['all', AVIAM, NOT_PARKED],
        layout: tagLayout(12, {
          'text-field': ['case', ['!=', get('tagStand'), ''], aviamTag({ stand: true }), aviamTag({ stand: false })],
          // Always on: where no anchor is free, over what is there.
          'text-allow-overlap': true,
          'symbol-sort-key': ['case', is('selected'), 1, 0],
        }),
        paint: tagPaint(occColor('text')),
        metadata: { 'occ:group': TRAFFIC_GROUPS.aviam },
      },
      {
        slot: 'traffic',
        id: 'occ-traffic-demo-plate',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: is('demo'),
        layout: {
          'icon-image': DEMO_PLATE_IMAGE,
          'icon-anchor': 'center',
          'icon-offset': plateOffset(pixels => pixels),
          'icon-allow-overlap': true,
          'text-field': TAGS.demo.es,
          'text-font': [...FONT_STACKS.bold],
          'text-size': PLATE_TEXT_SIZE,
          'text-anchor': 'center',
          'text-offset': plateOffset(ems),
          'text-allow-overlap': true,
          'text-rotation-alignment': 'viewport',
        },
        paint: {
          'text-color': occColor('text'),
          'text-halo-color': occColor('panel-raised'),
          'text-halo-width': 1,
          'icon-opacity': DIMMED,
          'text-opacity': DIMMED,
        },
        metadata: { 'occ:group': TRAFFIC_GROUPS.aviam },
      },
      {
        slot: 'selection',
        id: 'occ-traffic-selected-ring',
        type: 'circle',
        source: TRAFFIC_SOURCE,
        filter: is('selected'),
        paint: {
          'circle-radius': SELECTED_RING_RADIUS_PX,
          'circle-color': ACCENT,
          'circle-opacity': 0,
          'circle-stroke-width': SELECTED_RING_WIDTH_PX,
          'circle-stroke-color': ACCENT,
        },
        metadata: { 'occ:group': 'selection' },
      },
      {
        slot: 'selection',
        id: 'occ-traffic-selected',
        type: 'symbol',
        source: TRAFFIC_SOURCE,
        filter: is('selected'),
        layout: iconLayout({ 'icon-ignore-placement': true }),
        paint: iconPaint(ACCENT, 1.5),
        metadata: { 'occ:group': 'selection' },
      },
    ],
  };
}

/** The ids of the traffic overlay's layers, in drawing order. */
export const TRAFFIC_LAYER_IDS = Object.freeze(trafficOverlay().layers.map(layer => layer.id));
