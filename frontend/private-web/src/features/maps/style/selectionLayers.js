import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { occColor } from '../../occ-ui/occPalette';
import { lngLatOf, standCodeOf } from '../core/cameraPresets';
import { matchFlight } from '../core/mapSelection';

// The selection drawn on the map: the 2 px cyan casing of contracts 2.4, in the top slot, from a source of its own
// that holds at most one feature. It is data, not feature state, so it needs nothing back after a context loss or a
// worker restart (MapLibre 6.16 restores source data, not feature state).

export const SELECTION_SOURCE = 'occ-selection';
export const SELECTION_GROUP = 'selection';

/**
 * How big a stand icon is drawn by zoom. The stand layers use the same expression, so the casing, which is 2 px
 * outside the stand square of mapImages.js, sits on every stand.
 */
export const STAND_ICON_SIZE = Object.freeze(['interpolate', ['linear'], ['zoom'], 14, 0.65, 16, 1, 18, 1.5]);

// Around an aircraft, which has no square to hug: a ring clear of the largest silhouette.
const AIRCRAFT_RING_RADIUS = 18;
const CASING_WIDTH = 2;

/** The overlay for buildOccStyle: the source and its two layers, a casing for stands and a ring for anything else. */
export function selectionOverlay() {
  const accent = occColor('accent');
  return {
    sources: { [SELECTION_SOURCE]: { type: 'geojson' } },
    layers: [
      {
        slot: 'selection',
        id: 'occ-selection-stand',
        type: 'symbol',
        source: SELECTION_SOURCE,
        filter: ['==', ['get', 'kind'], 'stand'],
        layout: {
          'icon-image': 'stand-selected',
          'icon-size': [...STAND_ICON_SIZE],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': accent },
        metadata: { 'occ:group': SELECTION_GROUP },
      },
      {
        slot: 'selection',
        id: 'occ-selection-ring',
        type: 'circle',
        source: SELECTION_SOURCE,
        filter: ['!=', ['get', 'kind'], 'stand'],
        paint: {
          'circle-radius': AIRCRAFT_RING_RADIUS,
          'circle-color': accent,
          'circle-opacity': 0,
          'circle-stroke-width': CASING_WIDTH,
          'circle-stroke-color': accent,
        },
        metadata: { 'occ:group': SELECTION_GROUP },
      },
    ],
  };
}

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) });

// Where the selection is on the map, as `{ id, point }`, or `null`.
function locate(selection, { stands, flights }) {
  if (selection?.kind === 'stand') {
    const code = mapStandCode(selection.id);
    const stand = (stands ?? []).find(item => item?.retired !== true && mapStandCode(standCodeOf(item)) === code);
    const point = lngLatOf(stand);
    return point && { id: code, point };
  }
  if (selection?.kind === 'flight') {
    const flight = matchFlight(flights, selection.id);
    const point = lngLatOf(flight?.position ?? flight);
    return point && { id: String(selection.id), point };
  }
  return null;
}

/**
 * The data of the selection source: one point feature `{ kind, id }` where the selected stand or flight is, or an
 * empty collection when nothing is selected or the selection has no place on the map (an aircraft, until PR M5).
 */
export function selectionFeatures(selection, { stands = [], flights = [] } = {}) {
  const found = locate(selection, { stands, flights });
  if (found === null) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: selection.kind, id: found.id },
      geometry: { type: 'Point', coordinates: found.point },
    }],
  };
}
