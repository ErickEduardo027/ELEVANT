import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { isRetired, lngLatOf, standCodeOf, standTerminalOf } from '../core/cameraPresets';

// The stands of a screen as the GeoJSON of the stands source (occ-stands, promoteId `code`): one point per stand
// that has a location. Until PR M4 brings the polygons a stand is the point it has today. Pure.

/** The state a stand is drawn with: one of the seven of the vocabulary; anything else reads as free, as today. */
export function standDrawState(status) {
  return STAND_STATE_KEYS.includes(status) ? status : 'available';
}

/**
 * `positions` are the stands of a positions screen (`{ id | code, terminal | terminalCode, latitude, longitude,
 * status, locationSource }`). Each one with finite coordinates becomes a point keyed by its normalized code
 * (mapStandCode: `A01` is `A1`), with `code`, `terminal`, `status` and `unofficial` (true unless OCC placed the stand:
 * it then sits at an internal reference location). Stands without coordinates and retired stands are left out, and a
 * code seen twice keeps its first stand, so every feature id is unique.
 */
export function toStandFeatures(positions = []) {
  const features = [];
  const codes = new Set();
  for (const position of positions ?? []) {
    if (position == null || isRetired(position)) continue;
    const point = lngLatOf(position);
    const code = mapStandCode(standCodeOf(position));
    if (point === null || code === '' || codes.has(code)) continue;
    codes.add(code);
    features.push({
      type: 'Feature',
      properties: {
        code,
        terminal: standTerminalOf(position),
        status: standDrawState(position.status),
        unofficial: position.locationSource !== 'occ',
      },
      geometry: { type: 'Point', coordinates: point },
    });
  }
  return { type: 'FeatureCollection', features };
}
