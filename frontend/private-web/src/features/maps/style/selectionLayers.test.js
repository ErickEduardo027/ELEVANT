import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { attachStandGeometry } from '../stands/standModel';
import { buildStandFeatures } from '../stands/standFeatures';
import { standOverlay } from '../stands/standLayers';
import { createMapStands, standPoint } from '../testing/mapFixtures';
import { buildOccStyle } from './occStyle';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from './selectionLayers';

// Synthetic stands at their reference points; B33 is retired and kept only as history.
const STANDS = [
  ...createMapStands().filter(stand => ['A5', 'B21'].includes(stand.id)),
  { id: 'B33', terminal: 'B', latitude: standPoint('B32')[1], longitude: standPoint('B32')[0], retired: true },
];
const [FLIGHT_LNG, FLIGHT_LAT] = standPoint('AN1');
const FLIGHTS = [{ flightKey: 'l:leg-1', legId: 'leg-1', direction: 'Arrival', position: { latitude: FLIGHT_LAT, longitude: FLIGHT_LNG } }];
const LABELS = buildStandFeatures(attachStandGeometry(STANDS, MDPC_LAYOUT), { nowMs: Date.parse('2026-11-13T15:00:00Z') }).labels;

describe('selection layers', () => {
  it('rings anything selected that is not a stand in the top slot, from a source of its own, valid for MapLibre', () => {
    const style = buildOccStyle({ overlays: [selectionOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
    const ids = style.layers.map(layer => layer.id);
    // The stand casing is the feature state of the stand polygons now: only the ring is left here.
    expect(ids.slice(ids.indexOf('slot-selection') + 1)).toEqual(['occ-selection-ring']);
    expect(style.sources[SELECTION_SOURCE]).toEqual({ type: 'geojson', maxzoom: 16, data: { type: 'FeatureCollection', features: [] } });
    const ring = style.layers.at(-1);
    expect(ring.filter).toEqual(['!=', ['get', 'kind'], 'stand']);
    expect(ring.paint).toMatchObject({ 'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': occColor('accent') });
    expect(ring.metadata).toMatchObject({ 'occ:group': 'selection', 'occ:slot': 'selection' });
    // The stand layers read this source for the selected stand's label.
    const stands = buildOccStyle({ overlays: [selectionOverlay(), standOverlay()] });
    expect(validateStyleMin(stands)).toEqual([]);
    expect(stands.layers.filter(layer => layer.source === SELECTION_SOURCE).map(layer => layer.id))
      .toEqual(['occ-stand-label-selected', 'occ-stand-label-selected-3', 'occ-selection-ring']);
  });

  it('holds at most one feature: a drawn stand at its label point with its texts, a flight where it is', () => {
    const a5 = LABELS.features.find(item => item.id === 'A5');
    expect(selectionFeatures({ kind: 'stand', id: 'a05' }, { stands: STANDS, standLabels: LABELS })).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { kind: 'stand', id: 'A5', label1: 'A5', label2: a5.properties.label2, label3: a5.properties.label3 },
        geometry: { type: 'Point', coordinates: a5.geometry.coordinates },
      }],
    });
    // The label points may come as a list too.
    expect(selectionFeatures({ kind: 'stand', id: 'B21' }, { standLabels: LABELS.features }).features[0].properties.label1).toBe('B21');
    // A stand the map does not draw sits at its own location, without texts.
    expect(selectionFeatures({ kind: 'stand', id: 'B21' }, { stands: STANDS }).features).toEqual([{
      type: 'Feature', properties: { kind: 'stand', id: 'B21' }, geometry: { type: 'Point', coordinates: standPoint('B21') },
    }]);
    expect(selectionFeatures({ kind: 'flight', id: 'leg-1' }, { flights: FLIGHTS }).features).toEqual([{
      type: 'Feature', properties: { kind: 'flight', id: 'leg-1' }, geometry: { type: 'Point', coordinates: [FLIGHT_LNG, FLIGHT_LAT] },
    }]);
    // A retired stand, an unknown one, an aircraft (until PR M5) and no selection draw nothing.
    for (const selection of [{ kind: 'stand', id: 'B33' }, { kind: 'stand', id: 'Z9' }, { kind: 'aircraft', id: 'a1b2c3' }, null]) {
      expect(selectionFeatures(selection, { stands: STANDS, flights: FLIGHTS, standLabels: LABELS }).features).toEqual([]);
    }
  });
});
