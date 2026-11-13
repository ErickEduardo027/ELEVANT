import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { describe, expect, it } from 'vitest';
import { basemapLayers } from '../src/features/maps/style/basemapLayers';
import {
  SYNTHETIC_LAYERS, clipLine, clipRing, syntheticTile, toTileUnits,
} from './visual/support/syntheticTiles.mjs';

// The invented base map of the visual suite (tests/visual/support/syntheticTiles.mjs), read back with the vector tile
// reader MapLibre itself uses, so the screenshots draw what the NOC style expects.

const PUJ = [-68.3634, 18.5674];

function tileAt([lng, lat], z) {
  const [x, y] = toTileUnits([lng, lat], z, 0, 0).map(units => Math.floor(units / 4096));
  return { z, x, y };
}

function read({ z, x, y }) {
  const bytes = syntheticTile(z, x, y);
  return bytes === null ? null : new VectorTile(new PbfReader(bytes));
}

function features(tile, layer) {
  const source = tile.layers[layer];
  return source ? Array.from({ length: source.length }, (_, index) => source.feature(index)) : [];
}

describe('synthetic vector tiles of the visual suite', () => {
  it('speak the source-layers and classes the NOC style reads, at 4096 units per tile', () => {
    const { base, baseLabels, airfield } = basemapLayers();
    const styled = new Set([...base, ...baseLabels, ...airfield].map(layer => layer['source-layer']).filter(Boolean));
    for (const layer of SYNTHETIC_LAYERS) expect(styled, layer).toContain(layer);

    const tile = read(tileAt(PUJ, 5));
    expect(Object.keys(tile.layers).sort()).toEqual([...SYNTHETIC_LAYERS].sort());
    for (const layer of Object.values(tile.layers)) expect(layer.extent).toBe(4096);
    // The sea is one polygon of the tile with the land cut out as holes, classed «ocean» for the coast line.
    const [sea] = features(tile, 'water');
    expect(sea.type).toBe(3);
    expect(sea.properties).toEqual({ class: 'ocean' });
    expect(sea.loadGeometry().length).toBeGreaterThan(1);
    expect(features(tile, 'boundary').map(feature => feature.properties.maritime).sort()).toEqual([0, 1]);
    expect(features(tile, 'place').map(feature => feature.properties.class).sort()).toEqual(['city', 'city', 'country']);
  });

  it('draws the airfield around PUJ up close, and nothing on a tile of plain land', () => {
    const tile = read(tileAt(PUJ, 14));
    const aeroway = features(tile, 'aeroway');
    expect(aeroway.filter(feature => feature.properties.class === 'apron').map(feature => feature.type)).toEqual([3, 3, 3]);
    expect(aeroway.find(feature => feature.properties.class === 'runway').properties).toEqual({ class: 'runway', ref: '08/26' });
    // The home airport is in the tiles too, so the style must leave its label out.
    expect(features(tile, 'aerodrome_label').map(feature => feature.properties.iata)).toEqual(['PUJ']);
    expect(tile.layers.water).toBeUndefined();
    // Far inland there is nothing to draw; far at sea, only sea.
    expect(syntheticTile(...Object.values(tileAt([-70.6, 19.1], 12)))).toBeNull();
    expect(Object.keys(read(tileAt([-66, 16.5], 9)).layers)).toEqual(['water']);
  });

  it('clips rings and lines to the tile, splitting a line that leaves and comes back', () => {
    expect(clipRing([[-10, -10], [10, -10], [10, 10], [-10, 10]], 0, 5)).toEqual([[0, 5], [0, 0], [5, 0], [5, 5]]);
    expect(clipRing([[20, 20], [30, 20], [30, 30]], 0, 5)).toEqual([]);
    expect(clipLine([[-5, 1], [5, 1], [5, 9], [1, 9], [1, 3]], 0, 6)).toEqual([[[0, 1], [5, 1], [5, 6]], [[1, 6], [1, 3]]]);
    expect(clipLine([[10, 10], [20, 20]], 0, 6)).toEqual([]);
  });
});
