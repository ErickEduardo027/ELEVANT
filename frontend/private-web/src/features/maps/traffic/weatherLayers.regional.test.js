import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { GIBS_ATTRIBUTION } from '../core/attribution';
import { availableLayerKeys } from '../core/layersMenu';
import { MAP_IMAGE_IDS } from '../style/mapImages';
import { SLOT_ORDER, buildOccStyle } from '../style/occStyle';
import { referenceOverlay } from '../style/referenceLayers';
import { FLIGHT_CATEGORY_COLORS, SIGMET_HAZARD_COLORS } from '../style/weatherColors';
import { barbImageId } from '../style/weatherImages';
import {
  createRadarFrames, createRegionWeather, createSigmets, radarTemplateAt, REGION_STATIONS, WEATHER_NOON, weatherInstant,
} from '../testing/weatherFixtures';
import { trafficOverlay } from './trafficLayers';
import {
  AWC_ATTRIBUTION, LOOP_BANDS, LOOP_FRAME_COUNT, RADAR_FRAME_COUNT, RADAR_PLACEHOLDER_TILE, SIGMET_LAYER_IDS,
  SIGMET_SOURCE, STATION_LAYER_IDS, STATIONS_SOURCE, WEATHER_GROUPS, WEATHER_LEGEND_KINDS, flightCategoryOf,
  frameOpacities, loopBandAt, loopFrameIndex, loopFrameTimes, loopFrames, loopLayerId, loopPaint, loopSourceId,
  loopSpanWords, loopTileAt, radarFrames, radarLayerId, radarSourceId, sigmetFeatures, sigmetHazardOf, stationFeatures,
  wantedRegional, weatherLayerNotes, weatherOnScreen, weatherOverlay,
} from './weatherLayers';

// The regional weather of lane M7 over synthetic answers in the shapes lane M6 builds (testing/weatherFixtures.js, the
// lab's noon: 15:00Z, 11:00 at Punta Cana); nothing here calls NASA GIBS, aviationweather.gov or a radar provider.

const NOON_MS = Date.parse(WEATHER_NOON);
const LATEST_GOES = '2026-11-13T14:50:00Z';
const propertiesOf = data => data.features.map(feature => feature.properties);
const rendered = data => data.features.map(feature => ({ properties: feature.properties }));

describe('regional weather: the overlay', () => {
  it('only a map that opts in draws it; its keys are the regional groups of the layers menu', () => {
    const plain = weatherOverlay();
    expect(Object.keys(plain.sources).some(id => id.startsWith('occ-weather-loop') || id === STATIONS_SOURCE)).toBe(false);
    const { sources, layers } = weatherOverlay({ regional: true });
    expect(availableLayerKeys(buildOccStyle({ overlays: [{ sources, layers }] }))).toEqual([
      'weather.loop', 'weather.radar', 'weather.stations', 'weather.sigmet', 'weather.goes', 'weather.imerg', 'weather.wind',
    ]);
    // Six loop rasters and six radar rasters, each born hidden and transparent, without a fade, up to the airfield.
    const loop = layers.filter(layer => layer.metadata['occ:group'] === WEATHER_GROUPS.loop);
    const radar = layers.filter(layer => layer.metadata['occ:group'] === WEATHER_GROUPS.radar);
    expect(loop.map(layer => [layer.id, layer.source])).toEqual(Array.from({ length: LOOP_FRAME_COUNT },
      (_, index) => [loopLayerId(index), loopSourceId(index)]));
    expect(radar.map(layer => [layer.id, layer.source])).toEqual(Array.from({ length: RADAR_FRAME_COUNT },
      (_, index) => [radarLayerId(index), radarSourceId(index)]));
    for (const layer of [...loop, ...radar]) {
      expect(layer.layout, layer.id).toEqual({ visibility: 'none' });
      expect(layer.paint['raster-opacity'], layer.id).toBe(0);
      expect(layer.paint['raster-fade-duration'], layer.id).toBe(0);
      expect(layer.metadata['occ:maxThreshold'], layer.id).toBe('airfield');
      expect(layer.slot, layer.id).toBe('weather');
    }
    // The greys rule holds only for the satellite infrared: the loop is born in its band (greys) and the radar keeps
    // the colours of its provider's scale (owner exception of 2026-11-26).
    expect(loop.every(layer => layer.paint['raster-saturation'] === -1)).toBe(true);
    expect(radar.every(layer => layer.paint['raster-saturation'] === undefined)).toBe(true);
    expect(loopPaint('geocolor')).toEqual({ saturation: 0, opacity: 0.8 });
    expect(loopPaint('ir')).toEqual({ saturation: -1, opacity: 0.7 });
    // The loop's sources start on the latest infrared of GIBS with its credit; the radar's on a placeholder of an origin
    // the CSP allows, never asked for while hidden.
    expect(sources[loopSourceId(0)]).toEqual({
      type: 'raster', tileSize: 256, maxzoom: 6, attribution: GIBS_ATTRIBUTION,
      tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'],
    });
    expect(sources[radarSourceId(0)]).toEqual({ type: 'raster', tiles: [RADAR_PLACEHOLDER_TILE], tileSize: 256, maxzoom: 7 });
    // The stations and the SIGMETs are GeoJSON with the credit of the AWC.
    expect(sources[STATIONS_SOURCE]).toEqual({ type: 'geojson', attribution: AWC_ATTRIBUTION });
    expect(sources[SIGMET_SOURCE]).toEqual({ type: 'geojson', attribution: AWC_ATTRIBUTION });
    expect(layers.filter(layer => layer.source === STATIONS_SOURCE).map(layer => [layer.id, layer.type, layer.slot]))
      .toEqual([[STATION_LAYER_IDS[0], 'circle', 'standLabels'], [STATION_LAYER_IDS[1], 'symbol', 'standLabels'],
        [STATION_LAYER_IDS[2], 'symbol', 'standLabels']]);
    expect(layers.filter(layer => layer.source === SIGMET_SOURCE).map(layer => [layer.id, layer.type, layer.slot]))
      .toEqual([[SIGMET_LAYER_IDS[0], 'fill', 'weather'], [SIGMET_LAYER_IDS[1], 'line', 'weather'],
        [SIGMET_LAYER_IDS[2], 'symbol', 'weather']]);
  });

  it('paints the flight categories and the SIGMET hazards in aviation colours, and passes the style spec', () => {
    const { layers } = weatherOverlay({ regional: true });
    const dot = layers.find(layer => layer.id === STATION_LAYER_IDS[0]);
    const colours = JSON.stringify(dot.paint['circle-color']);
    for (const colour of Object.values(FLIGHT_CATEGORY_COLORS)) expect(colours).toContain(colour);
    const fill = JSON.stringify(layers.find(layer => layer.id === SIGMET_LAYER_IDS[0]).paint['fill-color']);
    for (const colour of Object.values(SIGMET_HAZARD_COLORS)) expect(fill).toContain(colour);
    expect(layers.find(layer => layer.id === SIGMET_LAYER_IDS[0]).paint['fill-opacity']).toBeLessThanOrEqual(0.15);
    for (const basemap of [true, false]) {
      for (const theme of ['dark', 'light']) {
        const style = buildOccStyle({ basemap, theme, overlays: [referenceOverlay(), trafficOverlay(),
          weatherOverlay({ regional: true })] });
        expect(validateStyleMin(style), `basemap ${basemap} ${theme}`).toEqual([]);
        // The light theme's pass leaves the aviation colours as they are.
        const text = JSON.stringify(style.layers);
        for (const colour of Object.values(FLIGHT_CATEGORY_COLORS)) expect(text, theme).toContain(colour);
      }
    }
    // The radar and the loop under the SIGMETs, all under the references; the stations over the references.
    const ids = buildOccStyle({ overlays: [referenceOverlay(), weatherOverlay({ regional: true })] }).layers.map(layer => layer.id);
    expect(ids.indexOf(loopLayerId(5))).toBeLessThan(ids.indexOf(radarLayerId(0)));
    expect(ids.indexOf(radarLayerId(5))).toBeLessThan(ids.indexOf(SIGMET_LAYER_IDS[0]));
    expect(ids.indexOf(SIGMET_LAYER_IDS[2])).toBeLessThan(ids.indexOf('slot-reference'));
    expect(ids.indexOf(STATION_LAYER_IDS[0])).toBeGreaterThan(ids.indexOf('slot-standLabels'));
    expect(SLOT_ORDER.indexOf('standLabels')).toBeGreaterThan(SLOT_ORDER.indexOf('reference'));
  });

  it('reads only what is wanted, in Región and Aproximación', () => {
    const groups = { 'weather.loop': true, 'weather.radar': false, 'weather.stations': true, 'weather.sigmet': true };
    expect(wantedRegional({ groups, view: 'region' })).toEqual({ loop: true, radar: false, stations: true, sigmet: true });
    expect(wantedRegional({ groups, view: 'approach' })).toEqual({ loop: true, radar: false, stations: true, sigmet: true });
    expect(wantedRegional({ groups, view: 'airfield' })).toEqual({ loop: false, radar: false, stations: false, sigmet: false });
    expect(wantedRegional({ groups, view: 'region', drawsRegional: false }))
      .toEqual({ loop: false, radar: false, stations: false, sigmet: false });
  });
});

describe('regional weather: the loops', () => {
  it('pins six GOES-East frames ten minutes apart, in the infrared or GeoColor', () => {
    expect(loopFrameTimes(LATEST_GOES)).toEqual([
      '2026-11-13T14:00:00Z', '2026-11-13T14:10:00Z', '2026-11-13T14:20:00Z', '2026-11-13T14:30:00Z',
      '2026-11-13T14:40:00Z', LATEST_GOES,
    ]);
    expect(loopFrameTimes('2026-11-13')).toEqual([]);
    expect(loopFrameTimes(null)).toEqual([]);
    expect(loopTileAt('geocolor', LATEST_GOES)).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
      + `GOES-East_ABI_GeoColor/default/${LATEST_GOES}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`);
    expect(loopTileAt('ir', LATEST_GOES)).toContain(`GOES-East_ABI_Band13_Clean_Infrared/default/${LATEST_GOES}/GoogleMapsCompatible_Level6`);
    expect([loopTileAt('visible', LATEST_GOES), loopTileAt('ir', 'latest')]).toEqual([null, null]);
    expect(Object.keys(LOOP_BANDS)).toEqual(['ir', 'geocolor']);
    const frames = loopFrames({ band: 'geocolor', latestTime: LATEST_GOES });
    expect(frames.map(frame => [frame.index, frame.source, frame.layer])).toEqual(Array.from({ length: 6 },
      (_, index) => [index, loopSourceId(index), loopLayerId(index)]));
    expect(frames.at(-1).tiles).toEqual([loopTileAt('geocolor', LATEST_GOES)]);
    expect(loopFrames({ band: 'radar', latestTime: LATEST_GOES })).toEqual([]);
    expect(loopFrames({ band: 'ir' })).toEqual([]);
  });

  it('runs GeoColor while the sun is up at Punta Cana and the infrared at night', () => {
    expect(loopBandAt(NOON_MS)).toBe('geocolor');
    expect(loopBandAt(Date.parse('2026-11-14T02:00:00Z'))).toBe('ir');
    expect(loopBandAt(null)).toBe('ir');
  });

  it('keeps the latest six radar frames of a Live or Stale answer, oldest first', () => {
    const frames = radarFrames(createRadarFrames());
    expect(frames).toHaveLength(6);
    expect(frames.map(frame => frame.time)).toEqual([-55, -45, -35, -25, -15, -5].map(weatherInstant));
    expect(frames.map(frame => frame.source)).toEqual(Array.from({ length: 6 }, (_, index) => radarSourceId(index)));
    expect(frames[5].tiles).toEqual([radarTemplateAt(weatherInstant(-5))]);
    expect(radarFrames(createRadarFrames({ status: 'Stale', count: 2 }))).toHaveLength(2);
    for (const status of ['Unavailable', 'Disabled']) expect(radarFrames(createRadarFrames({ status })), status).toEqual([]);
    // A frame without a time or an https template with {z}, {x} and {y} is left out.
    const bad = createRadarFrames({ frames: [
      { time: 'soon', tileUrlTemplate: radarTemplateAt(weatherInstant(-5)) },
      { time: weatherInstant(-5), tileUrlTemplate: 'http://tiles.example/{z}/{x}/{y}.png' },
      { time: weatherInstant(-5), tileUrlTemplate: 'https://tiles.example/latest.png' },
      { time: weatherInstant(-15), tileUrlTemplate: 'https://tiles.example/{z}/{x}/{y}.png' },
    ] });
    expect(radarFrames(bad).map(frame => frame.tiles[0])).toEqual(['https://tiles.example/{z}/{x}/{y}.png']);
    expect(radarFrames(null)).toEqual([]);
  });

  it('animates by switching the opacity of the frames, holding the latest one', () => {
    expect([0, 599, 600, 2999, 3000, 4799, 4800].map(ms => loopFrameIndex(ms, 6))).toEqual([0, 0, 1, 4, 5, 5, 0]);
    expect(loopFrameIndex(1234, 1)).toBe(0);
    expect(loopFrameIndex(Number.NaN, 6)).toBe(5);
    expect(loopFrameIndex(0, 0)).toBe(-1);
    expect(frameOpacities(2, 6, 0.7)).toEqual([0, 0, 0.7, 0, 0, 0]);
    expect(frameOpacities(-1, 3, 0.7)).toEqual([0, 0, 0]);
  });
});

describe('regional weather: the METAR stations and the SIGMETs', () => {
  it('a dot of the flight category, the wind barb and the ICAO code with its category for every reporting station', () => {
    const data = stationFeatures(createRegionWeather(), { nowMs: NOON_MS });
    const plots = propertiesOf(data);
    // MDCY sends no METAR: no plot.
    expect(plots.map(plot => plot.icao)).toEqual(['MDPC', 'MDSD', 'MDLR', 'TJSJ', 'MDST']);
    expect(plots.map(plot => plot.category)).toEqual(['VFR', 'MVFR', 'IFR', 'LIFR', null]);
    expect(plots.map(plot => plot.label)).toEqual(['MDPC\nVFR', 'MDSD\nMVFR', 'MDLR\nIFR', 'TJSJ\nLIFR', 'MDST']);
    expect(plots.map(plot => plot.barb ?? null)).toEqual([barbImageId(15), barbImageId(10), barbImageId(20),
      barbImageId(35), null]);
    for (const plot of plots) if (plot.barb) expect(MAP_IMAGE_IDS).toContain(plot.barb);
    expect(plots.map(plot => plot.rotate)).toEqual([100, 120, 90, 60, 0]);
    expect(plots.map(plot => plot.gustKt)).toEqual([null, null, 28, 45, null]);
    expect(plots.every(plot => plot.kind === 'station' && plot.stale === false && plot.demo === false)).toBe(true);
    expect(data.features[0].geometry.coordinates).toEqual(REGION_STATIONS[0].p);
    expect(data.features[0].id).toBe('MDPC');
    // Stale: dimmed; a METAR older than 90 minutes at the server's minute too; simulated: «Demo» in the legend.
    expect(propertiesOf(stationFeatures(createRegionWeather({ status: 'Stale' }))).every(plot => plot.stale)).toBe(true);
    expect(propertiesOf(stationFeatures(createRegionWeather(), { nowMs: NOON_MS + 100 * 60_000 })).every(plot => plot.stale))
      .toBe(true);
    expect(propertiesOf(stationFeatures(createRegionWeather(), { demo: true })).every(plot => plot.demo)).toBe(true);
    // Nothing without a report to draw, a position or an ICAO code.
    for (const status of ['Unavailable', 'Disabled']) {
      expect(stationFeatures(createRegionWeather({ status })).features, status).toEqual([]);
    }
    const odd = createRegionWeather({ stations: [
      { icao: 'MDPC', latitude: 95, longitude: -68, metar: { observedAt: weatherInstant(-10), flightCategory: 'VFR' } },
      { icao: '', latitude: 18, longitude: -68, metar: { observedAt: weatherInstant(-10) } },
      { icao: 'mdsd', latitude: 18.4, longitude: -69.6, metar: { observedAt: weatherInstant(-10), flightCategory: 'XFR' } },
    ] });
    expect(propertiesOf(stationFeatures(odd)).map(plot => [plot.icao, plot.category])).toEqual([['MDSD', null]]);
    expect(flightCategoryOf({ flightCategory: 'LIFR' })).toBe('LIFR');
    expect(flightCategoryOf(null)).toBeNull();
  });

  it('the SIGMETs in force as polygons with their hazard and levels', () => {
    const data = sigmetFeatures(createSigmets(), { nowMs: NOON_MS });
    expect(propertiesOf(data).map(area => [area.id, area.hazard, area.label])).toEqual([
      ['MDCS-SIGMET-A1', 'TS', 'SIGMET Tormentas\nHasta FL450'],
    ]);
    const ring = data.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring).toHaveLength(5);
    // Without an instant, every one that has an end; in English.
    expect(propertiesOf(sigmetFeatures(createSigmets(), { language: 'en' })).map(area => area.label)).toEqual([
      'SIGMET Thunderstorms\nUp to FL450', 'SIGMET Turbulence\nFL250-FL390', 'SIGMET Tropical cyclone',
    ]);
    // The open ring of the turbulence SIGMET is closed.
    const turbulence = sigmetFeatures(createSigmets()).features[1].geometry.coordinates[0];
    expect(turbulence).toHaveLength(5);
    expect(sigmetFeatures(createSigmets({ status: 'Disabled' })).features).toEqual([]);
    expect(sigmetFeatures(createSigmets({ sigmets: [{ id: 'x', hazard: 'TS', validTo: weatherInstant(60),
      polygon: [[-68, 18], [-67, 18]] }] })).features).toEqual([]);
    expect(['TS', 'TSGR', 'CONVECTIVE', 'TC', 'SEV TURB', 'TURB', 'ICE', 'MTW', 'VA', 'SS', 'RDOACT CLD', null]
      .map(sigmetHazardOf)).toEqual(['TS', 'TS', 'TS', 'TC', 'OTHER', 'TURB', 'ICE', 'MTW', 'VA', 'DS', 'OTHER', 'OTHER']);
  });
});

describe('regional weather: on screen and in the layers menu', () => {
  it('tells the legend what is drawn: the loops with their span, the SIGMET hazards, the categories and the barbs', () => {
    const loop = { band: 'geocolor', frames: loopFrames({ band: 'geocolor', latestTime: LATEST_GOES }), demo: false };
    const radar = { frames: radarFrames(createRadarFrames()), provider: 'iem-tjua', demo: true };
    const stations = rendered(stationFeatures(createRegionWeather(), { nowMs: NOON_MS, demo: true }));
    const sigmets = rendered(sigmetFeatures(createSigmets(), { nowMs: NOON_MS }));
    // A feature cut by tile edges comes back twice: listed once.
    const onScreen = weatherOnScreen({ rasters: { loop: true, radar: true }, loop, radar, stations: [...stations, stations[0]],
      sigmets: [...sigmets, ...sigmets] });
    expect(onScreen.kinds).toEqual(['loopGeocolor', 'radar', 'sigmet', 'categoryVFR', 'categoryMVFR', 'categoryIFR',
      'categoryLIFR', 'categoryNone', 'barb']);
    expect(onScreen.kinds.every(kind => WEATHER_LEGEND_KINDS.includes(kind))).toBe(true);
    expect(onScreen.imagery.loopGeocolor).toEqual({ from: '2026-11-13T14:00:00Z', time: LATEST_GOES, precision: 'loop', demo: false });
    expect(onScreen.imagery.radar).toMatchObject({ demo: true, provider: 'iem-tjua', time: weatherInstant(-5) });
    expect(onScreen.imagery.sigmet).toEqual({ demo: false, hazards: ['TS'] });
    expect(onScreen.imagery.barb).toEqual({ demo: true });
    // A raster not shown, or not pinned yet, is not on screen; the infrared loop is its own kind.
    expect(weatherOnScreen({ rasters: { loop: false, radar: true }, loop, radar: { frames: [] } }).kinds).toEqual([]);
    expect(weatherOnScreen({ rasters: { loop: true }, loop: { ...loop, band: 'ir' } }).kinds).toEqual(['loopIr']);
    expect(loopSpanWords(onScreen.imagery.loopGeocolor)).toBe('De las 10:00 a las 10:50');
    expect(loopSpanWords(onScreen.imagery.loopGeocolor, 'en')).toBe('From 10:00 to 10:50');
    expect(loopSpanWords(null)).toBeNull();
  });

  it('says under a regional key that is on why the map shows nothing of it, or the span of its loop', () => {
    const layers = { 'weather.loop': true, 'weather.radar': true, 'weather.stations': true, 'weather.sigmet': true };
    const ready = {
      loop: { status: 'ready', band: 'ir', frames: loopFrames({ band: 'ir', latestTime: LATEST_GOES }) },
      radar: { status: 'success', data: createRadarFrames() },
      stations: { status: 'success', data: createRegionWeather() },
      sigmet: { status: 'success', data: createSigmets() },
    };
    expect(weatherLayerNotes({ layers, view: 'region', regional: ready, nowMs: NOON_MS })).toEqual({
      'weather.loop': 'De las 10:00 a las 10:50',
      'weather.radar': 'De las 10:05 a las 10:55',
    });
    // Outside Región and Aproximación each key says where it is seen.
    const away = weatherLayerNotes({ layers, view: 'airfield', regional: ready, nowMs: NOON_MS });
    expect(Object.values(away)).toEqual(Array(4).fill('Se ve en Región y Aproximación'));
    // The state of each read, in its own words.
    expect(weatherLayerNotes({ layers, view: 'approach', nowMs: NOON_MS, regional: {
      loop: { status: 'loading' },
      radar: { status: 'success', data: createRadarFrames({ status: 'Disabled' }) },
      stations: { status: 'unauthorized', data: null },
      sigmet: { status: 'error', data: null },
    } })).toEqual({
      'weather.loop': 'Buscando la imagen…',
      'weather.radar': 'El clima de la región no está activado en este entorno.',
      'weather.stations': 'Tu acceso no incluye el clima de la región.',
      'weather.sigmet': 'No se pudo cargar el clima de la región.',
    });
    // Nothing in force, nothing reporting, no frame, no image.
    expect(weatherLayerNotes({ layers, view: 'region', nowMs: NOON_MS, regional: {
      loop: { status: 'unavailable' },
      radar: { status: 'success', data: createRadarFrames({ frames: [] }) },
      stations: { status: 'success', data: createRegionWeather({ stations: [] }) },
      sigmet: { status: 'success', data: createSigmets({ sigmets: [] }) },
    } })).toEqual({
      'weather.loop': 'No hay imagen en este momento.',
      'weather.radar': 'No hay radar en este momento.',
      'weather.stations': 'Ninguna estación de la región informa en este momento.',
      'weather.sigmet': 'No hay SIGMET vigentes en la región.',
    });
    expect(weatherLayerNotes({ layers, view: 'region', regional: { stations: { status: 'loading', data: null } } })['weather.stations'])
      .toBe('Cargando el clima de la región…');
    // A map without the regional weather says nothing of it.
    expect(weatherLayerNotes({ layers, view: 'region' })).toEqual({});
  });
});
