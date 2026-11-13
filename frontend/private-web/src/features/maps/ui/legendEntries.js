import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { lngLatOf, standsInView } from '../core/cameraPresets';

/**
 * What the map legend lists (owner request: only what is on screen): the stand states of the drawn stands inside
 * `bounds`, in the order of the vocabulary, and the «No oficial» tag when one of them is not placed by OCC (it sits at
 * an internal reference location). A drawn stand is one that is not retired and has a location; without bounds every
 * drawn stand counts. `grouped` says that stands on screen are drawn as clusters, which the legend then explains.
 * `{ states: string[], tags: string[], grouped: boolean }`.
 */
export function legendEntries({ stands = [], bounds = null, grouped = false } = {}) {
  const drawn = standsInView(stands, bounds).filter(stand => lngLatOf(stand) !== null);
  const present = new Set(drawn.map(stand => stand.status));
  return {
    states: STAND_STATE_KEYS.filter(state => present.has(state)),
    tags: drawn.some(stand => stand.locationSource !== 'occ') ? ['unofficial'] : [],
    grouped: grouped === true,
  };
}
