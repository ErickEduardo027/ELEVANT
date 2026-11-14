import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { isInBounds, isRetired, lngLatOf } from '../core/cameraPresets';
import { boxOfPoints, boxesMeet } from '../stands/standFeatures';
import { standStateOf } from '../stands/standModel';
import { AIRFIELD_LEGEND_KINDS } from '../style/airfieldLayers';
import { flightsInView } from '../traffic/flightLayers';

/** The signals a stand can carry on the map, in the order of the vocabulary (SIGNALS): attention, then urgent. */
export const STAND_SIGNAL_KEYS = Object.freeze(['attention', 'urgent']);
/** The marks of the stands the legend explains: the link of a cancelled stand and the narrow-body box. */
export const STAND_MARKS = Object.freeze(['combined', 'narrowbody']);

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
 * - `signals`: the signals the drawn stands carry (`attention`, `urgent`), in the vocabulary's order;
 * - `tags`: «No oficial» when a drawn stand is not placed by OCC (it sits at an internal reference location);
 * - `marks`: the stand marks drawn on screen (`combined`, `narrowbody`, as OccMap reads them), in that order;
 * - `airfield`: the airfield items drawn on screen (`runway`, `taxiway`, `holdBar`, `apron`, `terminal`), in that order.
 * Stands and flights count inside `bounds` when given. Pure.
 */
export function legendEntries({
  stands = [], flights = [], bounds = null, chips = [], marks = [], airfield = [],
} = {}) {
  const drawn = drawnIn(stands, bounds);
  const present = new Set(drawn.map(standStateOf));
  const signals = new Set(drawn.flatMap(stand => (Array.isArray(stand.signals) ? stand.signals : [])
    .map(signal => signal?.kind)));
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
