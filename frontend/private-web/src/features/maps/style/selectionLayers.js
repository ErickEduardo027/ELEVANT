import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { occColor } from '../../occ-ui/occPalette';
import { lngLatOf, standCodeOf } from '../core/cameraPresets';
import { matchFlight } from '../core/mapSelection';

// The selection drawn on the map, from a source of its own that holds at most one feature. A selected stand is cased
// through the feature state of its polygon (stands/standLayers.js); this source carries its label point and its texts,
// so its label is placed before every other stand's (the stand labels' top layers read it). Anything else selected (a
// flight, until PR M5 an aircraft) gets the 2 px cyan ring of contracts 2.4, in the top slot. It is data, so it needs
// nothing back after a context loss or a worker restart.

export const SELECTION_SOURCE = 'occ-selection';
export const SELECTION_GROUP = 'selection';

// Around an aircraft, which has no box to hug: a ring clear of the largest silhouette.
const AIRCRAFT_RING_RADIUS = 18;
const CASING_WIDTH = 2;

/** The overlay for buildOccStyle: the source and the ring of anything selected that is not a stand. */
export function selectionOverlay() {
  const accent = occColor('accent');
  return {
    sources: { [SELECTION_SOURCE]: { type: 'geojson' } },
    layers: [
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
const LABEL_KEYS = Object.freeze(['label1', 'label2', 'label3']);

// The label point of stand `code` among the label features of the stand layers (a FeatureCollection or a list).
function labelOf(standLabels, code) {
  const features = Array.isArray(standLabels) ? standLabels : standLabels?.features ?? [];
  return features.find(item => item?.id === code || item?.properties?.code === code) ?? null;
}

// Where the selection is on the map, as `{ id, point, texts }`, or `null`.
function locate(selection, { stands, flights, standLabels }) {
  if (selection?.kind === 'stand') {
    const code = mapStandCode(selection.id);
    const label = labelOf(standLabels, code);
    if (label?.geometry?.type === 'Point') {
      const texts = Object.fromEntries(LABEL_KEYS.map(key => [key, label.properties?.[key] ?? null]));
      return { id: code, point: label.geometry.coordinates, texts };
    }
    const stand = (stands ?? []).find(item => item?.retired !== true && mapStandCode(standCodeOf(item)) === code);
    const point = lngLatOf(stand);
    return point && { id: code, point, texts: {} };
  }
  if (selection?.kind === 'flight') {
    const flight = matchFlight(flights, selection.id);
    const point = lngLatOf(flight?.position ?? flight);
    return point && { id: String(selection.id), point, texts: {} };
  }
  return null;
}

/**
 * The data of the selection source: one point feature `{ kind, id }` where the selected stand or flight is, or an
 * empty collection when nothing is selected or the selection has no place on the map (an aircraft, until PR M5). A
 * stand the map draws sits at its label point (`standLabels`, the `labels` of buildStandFeatures) with its texts
 * (`label1`, `label2`, `label3`); one it does not draw, at its own location, without texts.
 */
export function selectionFeatures(selection, { stands = [], flights = [], standLabels = null } = {}) {
  const found = locate(selection, { stands, flights, standLabels });
  if (found === null) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: selection.kind, id: found.id, ...found.texts },
      geometry: { type: 'Point', coordinates: [found.point[0], found.point[1]] },
    }],
  };
}
