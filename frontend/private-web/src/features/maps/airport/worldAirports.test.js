import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GIBS_ATTRIBUTION } from '../core/attribution';
import { buildOccStyle } from '../style/occStyle';
import { OURAIRPORTS_SOURCE, RD_AIRPORT_LABELS_ID, RD_LABELS_MIN_ZOOM, referenceOverlay } from '../style/referenceLayers';
import {
  WORLD_BASE_GROUP, WORLD_BASE_LAYERS, WORLD_BASE_LAYER_ID, WORLD_BASE_MAX_ZOOM, WORLD_BASE_SOURCE, WORLD_BASE_TILES,
  worldBaseOverlay,
} from '../style/worldBaseLayers';
import { ourAirportsFeatures, worldAirportFeatures } from '../traffic/referenceFeatures';
import { planInputsKey } from '../traffic/motionStore';
import { buildRoute } from '../traffic/routeFeatures';
import { REGION_CONTEXT } from './regionContext';
import {
  WORLD_AIRPORTS, WORLD_AIRPORTS_META, airportPosition, counterpartPoint, isEmphasisedAirport,
} from './worldAirports';

// The world's airports and the world base of the globe of Monitoreo (M8).

const DOMINICAN = ['MDPC', 'MDSD', 'MDST', 'MDLR', 'MDPP', 'MDCY', 'MDJB', 'MDBH', 'MDCR', 'MDSI'];
const airportsOf = collection => collection.features.filter(item => item.properties.kind === 'airport');

describe('world.airports.json (OurAirports, M8)', () => {
  it('is a small, sorted extract of large airports with every Dominican airport', () => {
    const text = readFileSync('src/features/maps/airport/data/world.airports.json', 'utf8').replaceAll('\r\n', '\n');
    const json = JSON.parse(text);
    expect(json.schema).toBe(1);
    expect(json.meta).toMatchObject({ source: 'OurAirports', license: 'public domain',
      fields: ['icao', 'iata', 'name', 'lon', 'lat', 'country'] });
    expect(WORLD_AIRPORTS_META.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // Kept small: one line an airport, about a thousand of them and under 100 kB.
    expect(text.length).toBeLessThan(100_000);
    expect(WORLD_AIRPORTS.length).toBeGreaterThan(800);
    expect(WORLD_AIRPORTS.length).toBe(json.airports.length);
    const codes = WORLD_AIRPORTS.map(airport => airport.icao);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    expect(new Set(codes).size).toBe(codes.length);
    for (const airport of WORLD_AIRPORTS) {
      expect(airport.icao).toMatch(/^[A-Z0-9]{4}$/);
      expect(Math.abs(airport.p[0])).toBeLessThanOrEqual(180);
      expect(Math.abs(airport.p[1])).toBeLessThanOrEqual(90);
    }
    // The hubs AVIAM's flights come from, and every Dominican airport of the plan.
    for (const icao of ['KJFK', 'KMIA', 'LEMD', 'TJSJ', 'MPTO', 'CYYZ', ...DOMINICAN]) expect(codes).toContain(icao);
    expect(WORLD_AIRPORTS.find(airport => airport.icao === 'MDPC')).toMatchObject({ iata: 'PUJ', country: 'DO' });
    expect(WORLD_AIRPORTS.filter(isEmphasisedAirport).map(airport => airport.icao)).toEqual(expect.arrayContaining(DOMINICAN));
  });

  it('gives a counterpart without a position the region\'s or the world\'s airport of its code', () => {
    // The API row's own position wins.
    expect(counterpartPoint({ iataCode: 'MIA', latitude: 1, longitude: 2 })).toEqual([2, 1]);
    // The region's airport first (6 decimals), by ICAO then IATA, in any case.
    const sdq = REGION_CONTEXT.airports.find(airport => airport.icao === 'MDSD').p;
    expect(counterpartPoint({ iataCode: 'sdq' })).toEqual([...sdq]);
    expect(counterpartPoint({ icaoCode: 'MDSD', iataCode: 'XXX' })).toEqual([...sdq]);
    // Far away: the world's.
    const [lon, lat] = counterpartPoint({ iataCode: 'MAD' });
    expect(lon).toBeCloseTo(-3.57, 1);
    expect(lat).toBeCloseTo(40.47, 1);
    expect(airportPosition('KJFK')).toEqual(airportPosition('jfk'));
    // Unknown or missing codes: nothing.
    expect(counterpartPoint({ iataCode: 'ZZZ' })).toBeNull();
    expect(counterpartPoint(null)).toBeNull();
    expect(airportPosition('')).toBeNull();
  });

  it('plans a flight from the airport of its code when the API row has no position', () => {
    const flight = { flightKey: 'A1', direction: 'Arrival', counterpart: { iataCode: 'MAD', icaoCode: 'LEMD' } };
    const [lon, lat] = airportPosition('LEMD');
    const withRow = { ...flight, counterpart: { ...flight.counterpart, latitude: lat, longitude: lon } };
    expect(planInputsKey(flight)).toBe(planInputsKey(withRow));
    expect(planInputsKey(flight)).toContain(JSON.stringify([lon, lat]));
    expect(planInputsKey({ ...flight, counterpart: { iataCode: 'ZZZ' } })).not.toContain(JSON.stringify([lon, lat]));
    // The route builder reads the same position (traffic/routeFeatures.js); its origin is drawn only with a plan.
    expect(buildRoute({ target: { flight } }).features).toEqual([]);
  });
});

describe('the world\'s airports on the globe (M8)', () => {
  it('adds the world\'s airports after the region\'s, the Dominican ones marked rd, each once', () => {
    const plain = airportsOf(ourAirportsFeatures());
    expect(plain.every(item => !Object.hasOwn(item.properties, 'rd'))).toBe(true);
    const globe = airportsOf(ourAirportsFeatures({ world: WORLD_AIRPORTS }));
    expect(globe.length).toBeGreaterThan(plain.length + 500);
    const icaos = globe.map(item => item.properties.icao);
    expect(new Set(icaos).size).toBe(icaos.length);
    const rd = globe.filter(item => item.properties.rd === true).map(item => item.properties.icao);
    expect(rd).toEqual(expect.arrayContaining(DOMINICAN));
    expect(rd.every(icao => icao.startsWith('MD'))).toBe(true);
    // MDPC stays the home airport; a world hub is international, a counterpart is ringed.
    expect(globe.find(item => item.properties.icao === 'MDPC').properties).toMatchObject({ airportKind: 'home', rd: true });
    const world = worldAirportFeatures(WORLD_AIRPORTS, { counterparts: ['MAD'] });
    expect(world.find(item => item.properties.icao === 'LEMD').properties).toMatchObject({
      airportKind: 'international', counterpart: true, label: 'LEMD/MAD', rd: false, world: true,
    });
    expect(world.some(item => item.properties.icao === 'MDSD')).toBe(false);
  });

  it('draws the Dominican airports larger and always labels them from the Caribbean in sight', () => {
    expect(referenceOverlay().layers.some(layer => layer.id === RD_AIRPORT_LABELS_ID)).toBe(false);
    const layers = referenceOverlay({ world: true }).layers;
    const rdLabels = layers.find(layer => layer.id === RD_AIRPORT_LABELS_ID);
    expect(rdLabels).toMatchObject({ type: 'symbol', source: OURAIRPORTS_SOURCE, minzoom: RD_LABELS_MIN_ZOOM,
      layout: { 'text-allow-overlap': true }, metadata: { 'occ:group': 'reference.airports', 'occ:maxThreshold': 'airfield' } });
    const features = airportsOf(ourAirportsFeatures({ world: WORLD_AIRPORTS }));
    const filter = featureFilter(rdLabels.filter, 'layers.occ-rd-airport-labels.filter');
    const shown = features.filter(item => filter.filter({ zoom: 6 }, item)).map(item => item.properties.icao);
    expect(shown).toEqual(expect.arrayContaining(DOMINICAN));
    expect(shown.every(icao => icao.startsWith('MD'))).toBe(true);
    // The other labels leave the Dominican codes to that layer from its zoom, and place them first below it.
    const labels = layers.find(layer => layer.id === 'occ-region-airport-labels');
    expect(labels.layout['text-field']).toEqual(['step', ['zoom'], ['get', 'label'], RD_LABELS_MIN_ZOOM,
      ['case', ['==', ['get', 'rd'], true], '', ['get', 'label']]]);
    expect(labels.layout['symbol-sort-key'].slice(0, 5)).toEqual(['case', ['==', ['get', 'airportKind'], 'home'], 0,
      ['==', ['get', 'rd'], true], 1]);
    const dots = layers.find(layer => layer.id === 'occ-region-airports');
    expect(dots.paint['circle-radius'].slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(JSON.stringify(dots.paint['circle-radius'])).toContain('["case",["==",["get","rd"],true],2,0]');
    // Off the globe the layers are as before.
    const plain = referenceOverlay().layers.find(layer => layer.id === 'occ-region-airports');
    expect(plain.paint['circle-radius'][0]).toBe('+');
  });
});

describe('the world base of the globe (NASA GIBS, M8)', () => {
  it('uses the WMTS templates of GIBS with their real level 8, Black Marble pinned to 2016', () => {
    expect(WORLD_BASE_LAYERS).toEqual({ light: 'BlueMarble_ShadedRelief_Bathymetry', dark: 'VIIRS_Black_Marble' });
    expect(WORLD_BASE_TILES.light).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
      + 'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg');
    expect(WORLD_BASE_TILES.dark).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
      + 'VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png');
    expect(WORLD_BASE_MAX_ZOOM).toBe(8);
  });

  it('is one grey raster per theme with the NASA GIBS credit, under the night, up to the approach threshold', () => {
    for (const theme of ['dark', 'light']) {
      const overlay = worldBaseOverlay({ theme });
      expect(overlay.sources[WORLD_BASE_SOURCE]).toEqual({ type: 'raster', tiles: [WORLD_BASE_TILES[theme]], tileSize: 256,
        maxzoom: 8, attribution: GIBS_ATTRIBUTION });
      const [layer] = overlay.layers;
      expect(layer).toMatchObject({ id: WORLD_BASE_LAYER_ID, slot: 'shade', type: 'raster', source: WORLD_BASE_SOURCE,
        metadata: { 'occ:group': WORLD_BASE_GROUP, 'occ:maxThreshold': 'approach' } });
      expect(layer.paint['raster-saturation']).toBeLessThanOrEqual(-0.8);
      expect(layer.paint['raster-opacity'].slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);

      const style = buildOccStyle({ basemap: false, theme, projection: 'globe',
        overlays: [overlay, referenceOverlay({ theme, world: true })] });
      expect(validateStyleMin(style)).toEqual([]);
      const ids = style.layers.map(item => item.id);
      expect(ids.indexOf(WORLD_BASE_LAYER_ID)).toBeLessThan(ids.indexOf('occ-night'));
      expect(ids.indexOf('slot-shade')).toBeLessThan(ids.indexOf(WORLD_BASE_LAYER_ID));
    }
    // Any theme but light takes the night.
    expect(worldBaseOverlay().sources[WORLD_BASE_SOURCE].tiles).toEqual([WORLD_BASE_TILES.dark]);
  });
});
