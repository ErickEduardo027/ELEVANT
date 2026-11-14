import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import {
  createAirPicture, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import { MAP_IMAGE_IDS } from './mapImages';
import { buildOccStyle } from './occStyle';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from './selectionLayers';

const STANDS = [
  { id: 'A5', terminal: 'A', lat: 18.564028, lon: -68.362833 },
  { id: 'B33', terminal: 'B', lat: 18.5627, lon: -68.3721, retired: true },
  { code: 'B21', terminalCode: 'B', latitude: 18.563139, longitude: -68.369194 },
];
const FLIGHTS = [{ flightKey: 'l:leg-1', legId: 'leg-1', direction: 'Arrival', position: { latitude: 18.7, longitude: -68.1 } }];

describe('selection layers', () => {
  it('draws a cyan casing in the top slot from a source of its own, valid for MapLibre', () => {
    const style = buildOccStyle({ overlays: [selectionOverlay()] });
    expect(validateStyleMin(style)).toEqual([]);
    const ids = style.layers.map(layer => layer.id);
    const marker = ids.indexOf('slot-selection');
    expect(ids.slice(marker + 1)).toEqual(['occ-selection-stand', 'occ-selection-ring']);
    expect(style.sources[SELECTION_SOURCE]).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    const [stand, ring] = style.layers.slice(marker + 1);
    expect(stand.layout['icon-image']).toBe('stand-selected');
    expect(MAP_IMAGE_IDS).toContain('stand-selected');
    expect(stand.paint['icon-color']).toBe(occColor('accent'));
    expect(ring.paint).toMatchObject({
      'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': occColor('accent'),
    });
    for (const layer of [stand, ring]) expect(layer.metadata).toMatchObject({ 'occ:group': 'selection', 'occ:slot': 'selection' });
  });

  it('holds at most one feature, where the selected stand or flight is', () => {
    expect(selectionFeatures({ kind: 'stand', id: 'a05' }, { stands: STANDS })).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { kind: 'stand', id: 'A5' }, geometry: { type: 'Point', coordinates: [-68.362833, 18.564028] },
      }],
    });
    expect(selectionFeatures({ kind: 'stand', id: 'B21' }, { stands: STANDS }).features[0].geometry.coordinates)
      .toEqual([-68.369194, 18.563139]);
    expect(selectionFeatures({ kind: 'flight', id: 'leg-1' }, { flights: FLIGHTS }).features).toEqual([{
      type: 'Feature', properties: { kind: 'flight', id: 'leg-1' }, geometry: { type: 'Point', coordinates: [-68.1, 18.7] },
    }]);
    // A retired stand, an unknown one, an aircraft the traffic does not draw and no selection draw nothing.
    for (const selection of [{ kind: 'stand', id: 'B33' }, { kind: 'stand', id: 'Z9' }, { kind: 'aircraft', id: 'a1b2c3' }, null]) {
      expect(selectionFeatures(selection, { stands: STANDS, flights: FLIGHTS }).features).toEqual([]);
    }
  });

  it('an aircraft selection rings the aircraft', () => {
    const situation = buildSituation({ picture: toPictureModel(createAirPicture()), flights: toFlightsModel(createMapFlights()),
      nowMs: Date.parse(TRAFFIC_NOON) });
    const { aircraft } = situation;
    const overflight = situation.byId.get(`h:${HEX.overflight}`);
    const arrival = situation.byId.get(`f:${KEY.arrival}`);
    // An aircraft by its address, in any case: the ring is where the traffic draws it.
    expect(selectionFeatures({ kind: 'aircraft', id: HEX.overflight.toUpperCase() }, { aircraft })).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { kind: 'aircraft', id: HEX.overflight },
        geometry: { type: 'Point', coordinates: [overflight.lon, overflight.lat] },
      }],
    });
    // A flight with no position of its own is where its aircraft is, by any of its ids.
    for (const id of [KEY.arrival, arrival.legId]) {
      expect(selectionFeatures({ kind: 'flight', id }, { flights: FLIGHTS, aircraft }).features.map(feature => feature.geometry.coordinates))
        .toEqual([[arrival.lon, arrival.lat]]);
    }
    // A flight drawn with a position of its own keeps it.
    expect(selectionFeatures({ kind: 'flight', id: 'leg-1' }, { flights: FLIGHTS, aircraft }).features[0].geometry.coordinates)
      .toEqual([-68.1, 18.7]);
    // The ring is a circle around the aircraft, in the selection slot, never the stand casing.
    expect(selectionOverlay().layers.find(layer => layer.id === 'occ-selection-ring').filter).toEqual(['!=', ['get', 'kind'], 'stand']);
    // An aircraft the traffic hides inside a stand, or one that is not there, has no ring; nor has a flight without an
    // aircraft.
    for (const selection of [{ kind: 'aircraft', id: HEX.groundInOwnedStand }, { kind: 'aircraft', id: 'f0ffff' },
      { kind: 'flight', id: KEY.noFix }]) {
      expect(selectionFeatures(selection, { aircraft }).features, JSON.stringify(selection)).toEqual([]);
    }
  });
});
