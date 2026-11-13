import { occColor } from '../../occ-ui/occPalette';
import { PUJ_ARP } from '../core/cameraPresets';
import { FONT_STACKS, HOME_AIRPORT_IATA } from './basemapLayers';

// The fixed references of every OCC map: today the aerodrome reference point of Punta Cana with its «PUJ» label (it
// replaces the airport marker of Monitoreo). From the ramp view on the stands take over, so it hides behind the
// derived `codes` threshold. The tile label of the same airport is left out of the base map (basemapLayers.js), so
// PUJ is written once. PR M5 adds range rings, runway centrelines and the region's airports here. Pure.

export const REFERENCE_SOURCE = 'occ-reference';
export const REFERENCE_GROUP = 'reference';

/** The overlay of the references for buildOccStyle (slot `reference`, under the airfield as in the design). */
export function referenceOverlay() {
  return {
    sources: { [REFERENCE_SOURCE]: { type: 'geojson' } },
    layers: [{
      slot: 'reference',
      id: 'occ-reference-arp',
      type: 'symbol',
      source: REFERENCE_SOURCE,
      filter: ['==', ['get', 'kind'], 'arp'],
      layout: {
        'icon-image': 'airport-arp',
        'icon-allow-overlap': true,
        'text-field': ['get', 'label'],
        'text-font': [...FONT_STACKS.bold],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-optional': true,
      },
      paint: {
        'icon-color': occColor('text'),
        'icon-halo-color': occColor('nav'),
        'icon-halo-width': 1,
        'text-color': occColor('text'),
        'text-halo-color': occColor('nav'),
        'text-halo-width': 1.2,
      },
      metadata: { 'occ:group': REFERENCE_GROUP, 'occ:maxThreshold': 'codes' },
    }],
  };
}

/** The data of the reference source: the ARP of Punta Cana labelled with its IATA code. */
export function referenceFeatures() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: 'arp', label: HOME_AIRPORT_IATA },
      geometry: { type: 'Point', coordinates: [...PUJ_ARP] },
    }],
  };
}
