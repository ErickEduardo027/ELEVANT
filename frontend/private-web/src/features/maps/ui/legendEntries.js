import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { lngLatOf, standsInView } from '../core/cameraPresets';
import { flightsInView } from '../traffic/flightLayers';

/**
 * What the map legend lists (owner request: only what is on screen): whether flights are drawn (`flights`, one entry
 * for their aircraft), the stand states of the drawn stands inside `bounds`, in the order of the vocabulary, and the
 * «No oficial» tag when one of them is not placed by OCC (it sits at an internal reference location). A drawn stand is
 * one that is not retired and has a location, and a drawn flight one with an id and a location; without bounds every
 * drawn stand and flight counts. `grouped` says that a cluster of stands is drawn on screen, which the legend then
 * explains. `{ flights: boolean, states: string[], tags: string[], grouped: boolean }`.
 */
export function legendEntries({ stands = [], flights = [], bounds = null, grouped = false } = {}) {
  const drawn = standsInView(stands, bounds).filter(stand => lngLatOf(stand) !== null);
  const present = new Set(drawn.map(stand => stand.status));
  return {
    flights: flightsInView(flights, bounds).length > 0,
    states: STAND_STATE_KEYS.filter(state => present.has(state)),
    tags: drawn.some(stand => stand.locationSource !== 'occ') ? ['unofficial'] : [],
    grouped: grouped === true,
  };
}
