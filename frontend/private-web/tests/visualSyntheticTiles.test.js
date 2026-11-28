import { inflateSync } from 'node:zlib';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { describe, expect, it } from 'vitest';
import { basemapLayers } from '../src/features/maps/style/basemapLayers';
import { WORLD_BASE_TILES } from '../src/features/maps/style/worldBaseLayers';
import { GOES_TILE_TEMPLATE, IMERG_TILE_TEMPLATE, gibsDomainUrl, parseGibsDomain } from '../src/services/satelliteService';
import {
  GIBS_ORIGIN, gibsDomainRequest, gibsProbeRequest, gibsTileRequest, isolate, latestGibsTime, syntheticGibsDomain,
} from './visual/support/isolate.mjs';
import {
  SYNTHETIC_LAYERS, clipLine, clipRing, encodePng, syntheticSatelliteTile, syntheticTile, tilePixelLngLat, toTileUnits,
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

// A PNG read back: its size and its RGBA pixels (the tiles here are unfiltered rows of 8-bit RGBA).
function readPng(bytes) {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    chunks.push({ type: bytes.toString('ascii', at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  expect(chunks.map(chunk => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const header = chunks[0].data;
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
  expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  const rows = inflateSync(chunks[1].data);
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    expect(rows[row * (width * 4 + 1)]).toBe(0);
    rows.copy(pixels, row * width * 4, row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1));
  }
  return { width, height, pixels };
}

// A tile URL of a GIBS image, pinned to `time` or the latest one (`default`).
const gibsUrl = (template, time, { z, y, x }) => new URL(template.replace('/default/default/', `/default/${time}/`)
  .replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x)));

describe('synthetic satellite images of the visual suite (PR M8)', () => {
  it('answers the world base of the globe (M8): the static Blue Marble and Black Marble pinned to 2016, opaque', () => {
    const tileOf = (template, { z, y, x }) => new URL(template.replace('{z}', String(z)).replace('{y}', String(y))
      .replace('{x}', String(x)));
    expect(gibsTileRequest(tileOf(WORLD_BASE_TILES.light, { z: 2, y: 1, x: 1 }))).toEqual({
      layer: 'BlueMarble_ShadedRelief_Bathymetry', image: 'bluemarble', time: null, z: 2, y: 1, x: 1,
    });
    expect(gibsTileRequest(tileOf(WORLD_BASE_TILES.dark, { z: 3, y: 3, x: 2 }))).toEqual({
      layer: 'VIIRS_Black_Marble', image: 'blackmarble', time: '2016-01-01', z: 3, y: 3, x: 2,
    });
    // A temporal layer must name its time, and a static one may not name a time of its own.
    expect(gibsTileRequest(tileOf(WORLD_BASE_TILES.dark.replace('/2016-01-01/', '/'), { z: 3, y: 3, x: 2 }))).toBeNull();
    expect(gibsTileRequest(tileOf(WORLD_BASE_TILES.light.replace('/default/', '/default/2016-01-01/'),
      { z: 2, y: 1, x: 1 }))).toBeNull();
    for (const image of ['bluemarble', 'blackmarble']) {
      const { width, height, pixels } = readPng(syntheticSatelliteTile(image, 5, 9, 14));
      expect([width, height]).toEqual([256, 256]);
      const alphas = Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]);
      expect(new Set(alphas)).toEqual(new Set([255]));
    }
  });

  // Integration of 2026-11-28: Panorama in Región reads the time of the latest image (satelliteService.js) before it
  // pins the loop of lane M7; only that tile of the latest image is answered, with a recent time in its header.
  it('answers the read of the time of the latest GOES-East or IMERG image over PUJ, and no other latest tile', () => {
    expect(gibsProbeRequest(gibsUrl(GOES_TILE_TEMPLATE, 'default', { z: 6, y: 28, x: 19 }))).toEqual({
      layer: 'GOES-East_ABI_Band13_Clean_Infrared', image: 'goes', z: 6, y: 28, x: 19,
    });
    expect(gibsProbeRequest(gibsUrl(IMERG_TILE_TEMPLATE, 'default', { z: 6, y: 28, x: 19 }))).toMatchObject({ image: 'imerg' });
    expect(gibsProbeRequest(gibsUrl(GOES_TILE_TEMPLATE, 'default', { z: 6, y: 28, x: 20 }))).toBeNull();
    expect(gibsProbeRequest(gibsUrl(GOES_TILE_TEMPLATE, '2026-11-13T14:50:00Z', { z: 6, y: 28, x: 19 }))).toBeNull();
    expect(gibsTileRequest(gibsUrl(GOES_TILE_TEMPLATE, 'default', { z: 6, y: 28, x: 19 }))).toBeNull();
    const now = Date.parse('2026-11-28T13:57:12.345Z');
    expect(latestGibsTime('goes', now)).toBe('2026-11-28T13:40:00Z');
    expect(latestGibsTime('imerg', now)).toBe('2026-11-28T13:00:00Z');
    // By day the loop draws GOES-East GeoColor (level 7), answered with the same synthetic clouds.
    expect(gibsTileRequest(new URL(`${GIBS_ORIGIN}/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/`
      + '2026-11-28T13:40:00Z/GoogleMapsCompatible_Level7/7/56/38.png'))).toMatchObject({ image: 'goes', z: 7 });
  });

  // Hotfix of 2026-11-28: the loop asks first which images GIBS has of its band (DescribeDomains), then, if that
  // fails, the header of its own band (GeoColor's at level 7 too). Both are answered without the network.
  it('answers the domain of a band of the loop with a synthetic list up to the recent time, and its own header', () => {
    const now = Date.parse('2026-11-28T17:20:00Z');
    const url = new URL(gibsDomainUrl('GOES-East_ABI_GeoColor', 'GoogleMapsCompatible_Level7', now - 3 * 3_600_000, now));
    const request = gibsDomainRequest(url);
    expect(request).toEqual({ layer: 'GOES-East_ABI_GeoColor', image: 'goes', fromMs: now - 3 * 3_600_000, toMs: now });
    const times = parseGibsDomain(syntheticGibsDomain(request, now), request);
    expect(times[0]).toBe('2026-11-28T14:20:00Z');
    expect(times.at(-1)).toBe(latestGibsTime('goes', now));
    expect(times).toHaveLength(18);
    // A window with no image yet answers an empty domain.
    expect(parseGibsDomain(syntheticGibsDomain({ fromMs: now + 3_600_000, toMs: now + 7_200_000 }, now))).toEqual([]);
    expect(gibsDomainRequest(new URL(gibsDomainUrl('GOES-East_ABI_Band13_Clean_Infrared', 'GoogleMapsCompatible_Level6',
      now - 3_600_000, now)))).toMatchObject({ image: 'goes' });
    expect(gibsDomainRequest(new URL(gibsDomainUrl('IMERG_Precipitation_Rate_30min', 'GoogleMapsCompatible_Level6',
      now - 3_600_000, now)))).toBeNull();
    expect(gibsDomainRequest(new URL('https://example.test/wmts/epsg3857/best/1.0.0/GOES-East_ABI_GeoColor/default/'
      + 'GoogleMapsCompatible_Level7/all/2026-11-28T14:20:00Z--2026-11-28T17:20:00Z.xml'))).toBeNull();
    expect(gibsProbeRequest(new URL(`${GIBS_ORIGIN}/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/default/`
      + 'GoogleMapsCompatible_Level7/6/28/19.png'))).toMatchObject({ layer: 'GOES-East_ABI_GeoColor', image: 'goes' });
  });

  it('answers the satellite images of NASA GIBS pinned to their time with a synthetic PNG, and nothing else', () => {
    expect(gibsTileRequest(gibsUrl(GOES_TILE_TEMPLATE, '2026-11-13T14:50:00Z', { z: 5, y: 14, x: 9 }))).toEqual({
      layer: 'GOES-East_ABI_Band13_Clean_Infrared', image: 'goes', time: '2026-11-13T14:50:00Z', z: 5, y: 14, x: 9,
    });
    expect(gibsTileRequest(gibsUrl(IMERG_TILE_TEMPLATE, '2026-11-13', { z: 6, y: 28, x: 19 }))).toMatchObject({
      image: 'imerg', time: '2026-11-13', z: 6, y: 28, x: 19,
    });
    // The latest image, which names no time, another layer of GIBS and another origin are not answered.
    expect(gibsTileRequest(gibsUrl(GOES_TILE_TEMPLATE, 'default', { z: 5, y: 14, x: 9 }))).toBeNull();
    expect(gibsTileRequest(new URL(`${GIBS_ORIGIN}/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/`
      + '2026-11-13/GoogleMapsCompatible_Level9/5/14/9.jpg'))).toBeNull();
    expect(gibsTileRequest(new URL('https://gibs.example.org/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/'
      + '2026-11-13/GoogleMapsCompatible_Level6/5/14/9.png'))).toBeNull();

    // The clouds of a tile over Punta Cana: a real PNG, 256 px a side, with clouds in it and clear sky around them.
    const [lng, lat] = [-68.3634, 18.5674];
    const tile = { z: 5, x: Math.floor(((lng + 180) / 360) * 32), y: 14 };
    const png = syntheticSatelliteTile('goes', tile.z, tile.x, tile.y);
    const { width, height, pixels } = readPng(png);
    expect([width, height]).toEqual([256, 256]);
    const alphas = Array.from({ length: width * height }, (_, index) => pixels[index * 4 + 3]);
    expect(Math.max(...alphas)).toBeGreaterThan(150);
    expect(alphas.filter(alpha => alpha === 0).length).toBeGreaterThan(0);
    // White clouds; the rain inside the clouds and smaller.
    const cloudy = alphas.indexOf(Math.max(...alphas));
    expect([...pixels.subarray(cloudy * 4, cloudy * 4 + 3)]).toEqual([236, 240, 242]);
    const rain = readPng(syntheticSatelliteTile('imerg', tile.z, tile.x, tile.y));
    const rainAlphas = Array.from({ length: width * height }, (_, index) => rain.pixels[index * 4 + 3]);
    const rainy = rainAlphas.filter(alpha => alpha > 0);
    expect(rainy.length).toBeGreaterThan(0);
    expect(rainy.length).toBeLessThan(alphas.filter(alpha => alpha > 0).length);
    // The rain in the hues of a colour scale, as GIBS paints IMERG's, so the screenshots show the map drawing it in greys
    // (traffic/weatherLayers.js: SATELLITE_SATURATION): blue where it is lightest, red at the heaviest core of this tile,
    // and the colours of the scale between them.
    const colourAt = index => [...rain.pixels.subarray(index * 4, index * 4 + 3)];
    expect(colourAt(rainAlphas.indexOf(Math.min(...rainy)))).toEqual([77, 166, 255]);
    expect(colourAt(rainAlphas.indexOf(Math.max(...rainy)))).toEqual([222, 41, 41]);
    const colours = new Set(rainAlphas.flatMap((alpha, index) => (alpha > 0 ? [colourAt(index).join(',')] : [])));
    expect(colours.size).toBeGreaterThanOrEqual(5);
    // Made once, the same every time; nothing for another image.
    expect(syntheticSatelliteTile('goes', tile.z, tile.x, tile.y)).toBe(png);
    expect(syntheticSatelliteTile('lightning', 5, 9, 14)).toBeNull();
    // IEM's TJUA radar (M7) is an image of the suite too: a real PNG of the same size.
    expect(readPng(syntheticSatelliteTile('radar', 5, 9, 14)).width).toBe(256);
    // The pixels run on across tiles: the centre of a tile's pixel is where Web Mercator puts it.
    const [west] = tilePixelLngLat(5, 9, 14, -0.5, 0);
    expect(west).toBeCloseTo((9 / 32) * 360 - 180, 9);
    expect(readPng(encodePng(1, 1, Buffer.from([1, 2, 3, 4]))).pixels).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('routes the tiles of GIBS through the isolation without the network, and reports a tile that is not pinned', async () => {
    // A stand-in for Playwright's page: the isolation's routes, and what a route answers.
    const routes = [];
    const page = {
      route: async (matcher, handler) => { routes.push({ matcher, handler }); },
      routeWebSocket: async () => {},
    };
    const log = await isolate(page, { origin: 'http://localhost:4186' });
    const request = url => {
      const result = {};
      const route = {
        request: () => ({ url: () => url.href, method: () => 'GET', headers: () => ({ origin: 'http://localhost:4186' }) }),
        fulfill: async answer => { result.answer = answer; },
        abort: async reason => { result.aborted = reason; },
      };
      return routes[0].handler(route).then(() => result);
    };
    const pinned = gibsUrl(GOES_TILE_TEMPLATE, '2026-11-13T14:50:00Z', { z: 5, y: 14, x: 9 });
    expect(routes[0].matcher(pinned)).toBe(true);
    const answered = await request(pinned);
    expect(answered.answer).toMatchObject({ status: 200, contentType: 'image/png' });
    expect(answered.answer.headers['access-control-allow-origin']).toBe('http://localhost:4186');
    expect(answered.answer.body).toBe(syntheticSatelliteTile('goes', 5, 9, 14));
    expect(log.count('satellite')).toBe(1);
    expect(log.unexpected).toEqual([]);
    // The latest image is never asked for by a map that pins its tiles: such a request fails the spec.
    const latest = gibsUrl(GOES_TILE_TEMPLATE, 'default', { z: 5, y: 14, x: 9 });
    expect((await request(latest)).aborted).toBe('blockedbyclient');
    expect(log.unexpected).toEqual([`GET ${latest.href}`]);
  });
});
