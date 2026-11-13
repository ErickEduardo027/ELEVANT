import { occColor } from '../../occ-ui/occPalette';
import { lngLatOf } from '../core/cameraPresets';

// The flights of Monitoreo that carry a position, as one symbol layer of the traffic slot: the solid ELEVANT
// silhouette turned to its heading on the map, in the text colour and without a colour per state («cabina oscura»:
// the state is in the list and the detail, and the selection ring is the selection overlay's). The flights read of
// PR M5 brings the tags, the hollow departures and the estimated marks. Pure.

export const FLIGHT_SOURCE = 'occ-flights';
export const FLIGHT_GROUP = 'traffic';

// 32 px of the 40 px image: a 26 px silhouette, the size of the aircraft markers before M2.
const AIRCRAFT_ICON_SIZE = 0.8;

/** The overlay of the flights for buildOccStyle; the symbol is the pick target (`occ:pick: 'flight'`). */
export function flightOverlay() {
  return {
    sources: { [FLIGHT_SOURCE]: { type: 'geojson', promoteId: 'id' } },
    layers: [{
      slot: 'traffic',
      id: 'occ-flights',
      type: 'symbol',
      source: FLIGHT_SOURCE,
      layout: {
        'icon-image': 'aircraft-solid',
        'icon-size': AIRCRAFT_ICON_SIZE,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-color': occColor('text'), 'icon-halo-color': occColor('nav'), 'icon-halo-width': 1 },
      metadata: { 'occ:group': FLIGHT_GROUP, 'occ:pick': 'flight', 'occ:pickId': 'id' },
    }],
  };
}

/**
 * One point per flight with a finite latitude and longitude, keyed by its id as text (`id`, the promoted id) and
 * turned by `heading`. A flight without a known heading points north: no direction is made up for it.
 */
export function toFlightFeatures(flights = []) {
  const features = [];
  for (const flight of flights ?? []) {
    const point = lngLatOf(flight);
    if (point === null || flight.id == null) continue;
    features.push({
      type: 'Feature',
      properties: { id: String(flight.id), heading: Number.isFinite(flight.heading) ? flight.heading : 0 },
      geometry: { type: 'Point', coordinates: point },
    });
  }
  return { type: 'FeatureCollection', features };
}
