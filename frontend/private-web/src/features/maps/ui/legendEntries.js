import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { isInBounds, isRetired, lngLatOf } from '../core/cameraPresets';
import { boxOfPoints, boxesMeet, standSignalOf } from '../stands/standFeatures';
import { standStateOf } from '../stands/standModel';
import { AIRFIELD_LEGEND_KINDS } from '../style/airfieldLayers';
import { flightsInView } from '../traffic/flightLayers';

/**
 * The signals a stand can carry on the map, in the order of the vocabulary (SIGNALS): attention, urgent, then the plain
 * notice of PR M6 (an aircraft on the stand without its arrival recorded).
 */
export const STAND_SIGNAL_KEYS = Object.freeze(['attention', 'urgent', 'notice']);
/**
 * The marks of the stands the legend explains: the arrow over the chip of a terminal with a flight arriving at one of
 * its stands, the aircraft of a stand to scale (`footprint` on the stand, `footprintPlanned` still to come) and the
 * progress bar of its turnaround (`progress`, PR M6), the link of a cancelled stand, the narrow-body box, the ring of the stands covered by the same agent as
 * the selected one (`sameAgent`) or as the one under the pointer (`sameAgentHover`; the map draws one ring at a time,
 * stands/standInteractions.js: sameAgentMark), and while a stand is placed, its box at the pointer and the pending
 * location. The arrow is drawn with the chips, where the legend lists no state or signal, so being first it comes right
 * after the chip's entry.
 */
export const STAND_MARKS = Object.freeze([
  'chipArriving', 'footprint', 'footprintPlanned', 'progress', 'combined', 'narrowbody', 'sameAgent', 'sameAgentHover',
  'ghost', 'pending',
]);

// A stand that is drawn: its polygon (or, outside a map, its location) inside `bounds`; without bounds, every drawn
// stand. A retired stand is never drawn.
function drawnIn(stands, bounds) {
  return (stands ?? []).filter(stand => {
    if (stand === null || typeof stand !== 'object' || isRetired(stand)) return false;
    if (Array.isArray(stand.geometry?.polygon)) return bounds === null || boxesMeet(boxOfPoints(stand.geometry.polygon), bounds);
    const point = lngLatOf(stand);
    return point !== null && (bounds === null || isInBounds(point, bounds));
  });
}

const listed = (value, order) => {
  const present = new Set(Array.isArray(value) ? value : []);
  return order.filter(item => present.has(item));
};

/**
 * What the map legend lists (owner request: only what is on screen):
 * - `flights`: whether flights are drawn (one entry for their aircraft): those with an id and a location;
 * - `states`: the states of the drawn stands (their display status, else their board status), in the vocabulary's
 *   order; a drawn stand has a polygon (inside a map) or a location (a legend given its own stands);
 * - `chips`: whether a terminal chip is drawn (`chips`, the terminals OccMap draws a chip for on screen);
 * - `signals`: the signals the map draws on the drawn stands (`attention`, `urgent`, `notice`), in the vocabulary's
 *   order: one per stand, the strongest of those it carries (stands/standFeatures.js: standSignalOf), so a stand with an
 *   urgent and an attention signal brings only `urgent`;
 * - `tags`: «No oficial» when a drawn stand is not placed by OCC (it sits at an internal reference location);
 * - `marks`: the stand marks drawn on screen (`chipArriving`, `footprint`, `footprintPlanned`, `progress`, `combined`,
 *   `narrowbody`, `sameAgent`, `sameAgentHover`, `ghost`, `pending`, as OccMap reads them), in that order;
 * - `airfield`: the airfield items drawn on screen (`runway`, `taxiway`, `taxiwayPavement`, `holdBar`, `apron`,
 *   `terminal`, `building`, `jetBridge`: style/airfieldLayers.js AIRFIELD_LEGEND_KINDS), in that order.
 * Stands and flights count inside `bounds` when given. Pure.
 */
export function legendEntries({
  stands = [], flights = [], bounds = null, chips = [], marks = [], airfield = [],
} = {}) {
  const drawn = drawnIn(stands, bounds);
  const present = new Set(drawn.map(standStateOf));
  // The map draws one signal per stand, by the same rule.
  const signals = new Set(drawn.map(standSignalOf));
  return {
    flights: flightsInView(flights, bounds).length > 0,
    states: STAND_STATE_KEYS.filter(state => present.has(state)),
    chips: Array.isArray(chips) && chips.length > 0,
    signals: STAND_SIGNAL_KEYS.filter(signal => signals.has(signal)),
    tags: drawn.some(stand => stand.locationSource !== 'occ') ? ['unofficial'] : [],
    marks: listed(marks, STAND_MARKS),
    airfield: listed(airfield, AIRFIELD_LEGEND_KINDS),
  };
}
