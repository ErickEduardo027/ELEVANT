import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { GOES_TILE_TEMPLATE, IMERG_TILE_TEMPLATE, SATELLITE_OPACITY } from '../../../services/satelliteService';
import { toWeatherReading } from '../../../services/weatherService';
import { occColor } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM, pointToPolylineM } from '../airport/geo';
import { runwayEnds } from '../airport/runwayInUse';
import { GIBS_ATTRIBUTION } from '../core/attribution';
import { PUJ_ARP } from '../core/cameraPresets';
import { MAP_IMAGE_IDS } from '../style/mapImages';
import { SLOT_ORDER, buildOccStyle } from '../style/occStyle';
import { referenceOverlay } from '../style/referenceLayers';
import { createAerodromeWeather, WEATHER_NOON, weatherInstant } from '../testing/weatherFixtures';
import { trafficOverlay } from './trafficLayers';
import {
  RASTER_VIEWS, SATELLITE_LAYER_IDS, SATELLITE_SOURCES, WEATHER_GROUPS, WIND_LAYER_IDS, WIND_SOURCE, imageTimeWords,
  isImageReady, satelliteTiles, wantedImagery, weatherLayerNotes, weatherOnScreen, weatherOverlay, windFeatures,
  windLabel, windPoint, windReading, windTooltip, withPinnedImagery,
} from './weatherLayers';

// The weather of the OCC maps (PR M8) over synthetic answers of GET occ/weather (testing/weatherFixtures.js, the lab's
// noon) read as useMdpcWeather reads them; nothing here calls aviationweather.gov or NASA GIBS.

const NOON_MS = Date.parse(WEATHER_NOON);
// The weather as useMdpcWeather answers it, from a synthetic answer of the API.
function readingOf(options = {}) {
  const reading = toWeatherReading(createAerodromeWeather(options), { receivedAt: NOON_MS });
  return { status: reading.observation ? 'success' : 'empty', data: reading.observation, apiStatus: reading.apiStatus,
    taf: reading.taf, source: reading.source };
}
const propertiesOf = data => data.features.map(feature => feature.properties);
// Images as useSatelliteImagery answers them.
const READY = Object.freeze({
  goes: { status: 'ready', time: '2026-11-13T14:50:00Z', precision: 'instant', tileTemplate: null },
  imerg: { status: 'ready', time: '2026-11-13T14:30:00Z', precision: 'instant', tileTemplate: null },
});

describe('weather layers: the satellite images', () => {
  it('satellite rasters for region and approach only, off by default, with the GIBS credit on their sources', () => {
    const { sources, layers } = weatherOverlay();
    // Two raster sources, one per image, with the latest image of GIBS until OccMap pins them, and their credit.
    expect(sources[SATELLITE_SOURCES.goes]).toEqual({
      type: 'raster', tiles: [GOES_TILE_TEMPLATE], tileSize: 256, maxzoom: 6, attribution: GIBS_ATTRIBUTION,
    });
    expect(sources[SATELLITE_SOURCES.imerg]).toEqual({
      type: 'raster', tiles: [IMERG_TILE_TEMPLATE], tileSize: 256, maxzoom: 6, attribution: GIBS_ATTRIBUTION,
    });
    expect(sources[WIND_SOURCE]).toEqual({ type: 'geojson' });
    // Each image in the weather slot, born hidden, up to the airfield threshold (Región and Aproximación), the rain over
    // the clouds, at the opacity the old satellite panel drew them, each in the layers-menu group of its key.
    const rasters = layers.filter(layer => layer.type === 'raster');
    expect(rasters.map(layer => [layer.id, layer.source, layer.slot, layer.metadata])).toEqual([
      [SATELLITE_LAYER_IDS.goes, SATELLITE_SOURCES.goes, 'weather', { 'occ:group': 'weather.goes', 'occ:maxThreshold': 'airfield' }],
      [SATELLITE_LAYER_IDS.imerg, SATELLITE_SOURCES.imerg, 'weather', { 'occ:group': 'weather.imerg', 'occ:maxThreshold': 'airfield' }],
    ]);
    for (const layer of rasters) expect(layer.layout, layer.id).toEqual({ visibility: 'none' });
    expect(rasters.map(layer => layer.paint['raster-opacity'])).toEqual([SATELLITE_OPACITY.goes, SATELLITE_OPACITY.imerg]);
    // In greys, both: GIBS paints the images with its own colour scales (IMERG's rain up to orange, red and violet), and
    // normal things carry no hue (contracts 2.4), so the map draws them without saturation, as the legend's white marks.
    expect(rasters.map(layer => layer.paint['raster-saturation'])).toEqual([-1, -1]);
    // Without a fade: under a frozen clock (the map lab's setNow) a fade would never end and the map never settle.
    expect(rasters.map(layer => layer.paint['raster-fade-duration'])).toEqual([0, 0]);
    // Under the references and the base-map labels, over the night shade.
    expect(SLOT_ORDER.indexOf('weather')).toBeLessThan(SLOT_ORDER.indexOf('reference'));
    expect(SLOT_ORDER.indexOf('weather')).toBeGreaterThan(SLOT_ORDER.indexOf('shade'));
    expect(RASTER_VIEWS).toEqual(['region', 'approach']);
    // A map reads an image only while its key is on and it is in one of those views; a map without weather reads none.
    const on = { 'weather.goes': true, 'weather.imerg': false };
    expect(wantedImagery({ groups: on, view: 'region' })).toEqual({ goes: true, imerg: false });
    expect(wantedImagery({ groups: on, view: 'approach' })).toEqual({ goes: true, imerg: false });
    expect(wantedImagery({ groups: on, view: 'airfield' })).toEqual({ goes: false, imerg: false });
    expect(wantedImagery({ groups: on, view: null })).toEqual({ goes: false, imerg: false });
    expect(wantedImagery({ groups: on, view: 'region', drawsWeather: false })).toEqual({ goes: false, imerg: false });
    // Off by default: no key, nothing read (core/layersMenu.js keeps them off in every view).
    expect(wantedImagery({ groups: {}, view: 'region' })).toEqual({ goes: false, imerg: false });
  });

  it('tiles pinned to the time GIBS reports', () => {
    expect(satelliteTiles('goes', READY.goes)).toEqual([
      GOES_TILE_TEMPLATE.replace('/default/default/', '/default/2026-11-13T14:50:00Z/'),
    ]);
    expect(satelliteTiles('imerg', { time: '2026-11-13' })).toEqual([
      IMERG_TILE_TEMPLATE.replace('/default/default/', '/default/2026-11-13/'),
    ]);
    // No time, a time GIBS would not name, or another layer: nothing to pin.
    for (const info of [null, {}, { time: '13/11/2026' }, { time: '2026-11-13T14:50Z' }]) {
      expect(satelliteTiles('goes', info), JSON.stringify(info)).toBeNull();
    }
    expect(satelliteTiles('radar', READY.goes)).toBeNull();
    // Ready only with a time to pin to.
    expect(isImageReady('goes', READY.goes)).toBe(true);
    expect(isImageReady('goes', { status: 'ready', time: null })).toBe(false);
    expect(isImageReady('goes', { status: 'loading', time: READY.goes.time })).toBe(false);
    // What the menu shows, the map shows once the image is pinned; other groups pass as they are, none is added.
    const groups = { 'weather.goes': true, 'weather.imerg': true, 'weather.wind': true, rings: false };
    expect(withPinnedImagery(groups, { goes: READY.goes, imerg: { status: 'loading', time: null } })).toEqual({
      'weather.goes': true, 'weather.imerg': false, 'weather.wind': true, rings: false,
    });
    expect(withPinnedImagery({ 'weather.goes': false }, READY)).toEqual({ 'weather.goes': false });
    expect(withPinnedImagery({ rings: true }, READY)).toEqual({ rings: true });
  });

  it('validateStyleMin', () => {
    for (const basemap of [true, false]) {
      const style = buildOccStyle({ basemap, overlays: [referenceOverlay(), trafficOverlay(), weatherOverlay()] });
      expect(validateStyleMin(style), `basemap ${basemap}`).toEqual([]);
      // The images under the references; the wind above the stands and the airfield, under the traffic.
      const ids = style.layers.map(layer => layer.id);
      expect(ids.indexOf(SATELLITE_LAYER_IDS.imerg)).toBeLessThan(ids.indexOf('slot-reference'));
      expect(ids.indexOf(WIND_LAYER_IDS[0])).toBeGreaterThan(ids.indexOf('slot-standLabels'));
      expect(ids.indexOf(WIND_LAYER_IDS[2])).toBeLessThan(ids.indexOf('slot-traffic'));
      // The raster sources keep their own https tiles; nothing gives them data. Their layers reach MapLibre in greys.
      expect(style.sources[SATELLITE_SOURCES.goes]).not.toHaveProperty('data');
      expect(style.layers.filter(layer => layer.type === 'raster').map(layer => [layer.id, layer.paint['raster-saturation']]))
        .toEqual([[SATELLITE_LAYER_IDS.goes, -1], [SATELLITE_LAYER_IDS.imerg, -1]]);
    }
    // The wind's icons are images of the map (style/mapImages.js); its colours are the text tokens, no hue.
    const arrow = weatherOverlay().layers.find(layer => layer.id === WIND_LAYER_IDS[0]);
    expect(arrow.layout['icon-image']).toEqual(['case', ['==', ['get', 'arrow'], true], 'wind-arrow', 'wind-calm']);
    expect(MAP_IMAGE_IDS).toEqual(expect.arrayContaining(['wind-arrow', 'wind-calm']));
    const colours = JSON.stringify(weatherOverlay().layers.map(layer => layer.paint));
    for (const colour of colours.match(/#[0-9a-f]{6}/gi)) {
      expect([occColor('text'), occColor('muted'), occColor('nav')], colour).toContain(colour);
    }
  });
});

describe('weather layers: the wind at the airfield', () => {
  it('the wind is an arrow and «100° 13 kt R08», with VRB, gust and calm', () => {
    const live = windFeatures({ reading: readingOf(), runway: '08', nowMs: NOON_MS });
    expect(live.features).toHaveLength(2);
    const [airfield, wide] = live.features;
    // In the airport's box, in the open ground between the runways: clear of the stands and of the runways; and further
    // out under the mark of PUJ.
    expect(airfield.properties.placement).toBe('airfield');
    expect(airfield.geometry).toEqual({ type: 'Point', coordinates: windPoint(MDPC_LAYOUT) });
    const point = airfield.geometry.coordinates;
    const [west, south, east, north] = MDPC_LAYOUT.meta.bbox;
    expect(point[0]).toBeGreaterThan(west + (east - west) / 2);
    expect(point[0]).toBeLessThan(east);
    expect(point[1]).toBeGreaterThan(south + (north - south) / 2);
    expect(point[1]).toBeLessThan(north);
    const standDistances = MDPC_LAYOUT.stands.flatMap(stand => stand.polygon ?? []).map(corner => haversineM(point, corner));
    expect(Math.min(...standDistances)).toBeGreaterThan(500);
    for (const end of runwayEnds(MDPC_LAYOUT)) expect(pointToPolylineM(point, end.centerline).distanceM, end.ident).toBeGreaterThan(400);
    // Without an airport box, north-east of the reference point.
    expect(windPoint(null)[0]).toBeGreaterThan(PUJ_ARP[0]);
    expect(windPoint(null)[1]).toBeGreaterThan(PUJ_ARP[1]);
    expect(wide.properties.placement).toBe('wide');
    expect(wide.geometry.coordinates).toEqual([...PUJ_ARP]);
    // The METAR's wind from 100° at 13 kt: an arrow turned to where it blows (280°), and its words with the runway.
    expect(airfield.properties).toMatchObject({
      kind: 'wind', id: 'wind', label: '100° 13 kt R08', arrow: true, rotate: 280, stale: false, calm: false,
      variable: false, directionDeg: 100, speedKt: 13, gustKt: null, observedAt: weatherInstant(-10), runway: '08',
    });
    expect(windLabel(windReading(readingOf()), '26')).toBe('100° 13 kt R26');
    expect(windLabel(windReading(readingOf()), null)).toBe('100° 13 kt');
    // A gust, with the direction in three digits as the METAR writes it.
    const gusty = propertiesOf(windFeatures({ reading: readingOf({ wind: { directionDeg: 90, speedKt: 15, gustKt: 25 } }),
      runway: '08' }))[0];
    expect(gusty).toMatchObject({ label: '090° 15 kt G25 R08', arrow: true, rotate: 270, gustKt: 25 });
    // A variable wind points nowhere: a ring, «VRB», and no wind on the runways.
    const variable = propertiesOf(windFeatures({ reading: readingOf({ wind: { directionDeg: null, variable: true,
      speedKt: 3 } }), runway: '08' }))[0];
    expect(variable).toMatchObject({ label: 'VRB 3 kt R08', arrow: false, rotate: 0, variable: true, runways: [] });
    // Calm: «Calma», in English «Calm».
    const calm = { reading: readingOf({ wind: { directionDeg: 0, speedKt: 0 } }), runway: '08' };
    expect(propertiesOf(windFeatures(calm))[0]).toMatchObject({ label: 'Calma R08', arrow: false, calm: true, runways: [] });
    expect(propertiesOf(windFeatures({ ...calm, language: 'en' }))[0].label).toBe('Calm R08');
    // The runway in use may come as the map's `{ arrival }`.
    expect(propertiesOf(windFeatures({ reading: readingOf(), runway: { arrival: '26' } }))[0].label).toBe('100° 13 kt R26');
  });

  it('hidden when the weather is Unavailable or Disabled', () => {
    for (const status of ['Unavailable', 'Disabled']) {
      expect(windFeatures({ reading: readingOf({ status }), runway: '08' }).features, status).toEqual([]);
      expect(windReading(readingOf({ status })), status).toBeNull();
    }
    // Nor while it loads, after a failed first read, without a reading, or with a METAR without wind.
    for (const reading of [null, { status: 'loading', apiStatus: null, data: null }, { status: 'error', apiStatus: null }]) {
      expect(windFeatures({ reading, runway: '08' }).features, JSON.stringify(reading)).toEqual([]);
    }
    const noWind = readingOf();
    expect(windFeatures({ reading: { ...noWind, data: { ...noWind.data, metar: { ...noWind.data.metar, wind: null } } } })
      .features).toEqual([]);
  });

  it('dimmed with «Sin actualizar desde las 14:02» when Stale', () => {
    // A METAR of 18:02Z, 14:02 in Punta Cana, kept by the API after the service stopped answering.
    const stale = readingOf({ status: 'Stale', observedAt: '2026-11-13T18:02:00.000Z', serverTime: '2026-11-13T20:30:00.000Z' });
    const [airfield] = propertiesOf(windFeatures({ reading: stale, runway: '08' }));
    expect(airfield).toMatchObject({ stale: true, label: '100° 13 kt R08\nSin actualizar desde las 14:02' });
    expect(propertiesOf(windFeatures({ reading: stale, runway: '08', language: 'en' }))[0].label)
      .toBe('100° 13 kt R08\nNot updated since 14:02');
    // A live METAR kept after failed refreshes ages: past the API's 90 minutes at the server's minute, it is stale too.
    expect(windReading(readingOf(), NOON_MS + 80 * 60_000).stale).toBe(false);
    expect(windReading(readingOf(), NOON_MS + 81 * 60_000).stale).toBe(true);
    // The layers dim what is stale: the muted token and a lower opacity, never a hue.
    const words = weatherOverlay().layers.find(layer => layer.id === WIND_LAYER_IDS[1]);
    expect(words.paint['text-color']).toEqual(['case', ['==', ['get', 'stale'], true], occColor('muted'), occColor('text')]);
    expect(words.paint['text-opacity']).toEqual(['case', ['==', ['get', 'stale'], true], 0.75, 1]);
  });

  it('its tooltip lists the head and cross wind of each runway end', () => {
    const [properties] = propertiesOf(windFeatures({ reading: readingOf(), runway: '08' }));
    // 100° at 13 kt on runways 08 (73.8° true), 26, 09 (84.9° true) and 27, in the layout's order.
    expect(properties.runways).toEqual([
      { ident: '08', label: 'R08', headwindKt: 12, crosswindKt: 6, side: 'right' },
      { ident: '26', label: 'R26', headwindKt: -12, crosswindKt: 6, side: 'left' },
      { ident: '09', label: 'R09', headwindKt: 13, crosswindKt: 3, side: 'right' },
      { ident: '27', label: 'R27', headwindKt: -13, crosswindKt: 3, side: 'left' },
    ]);
    expect(windTooltip(properties)).toEqual({
      title: 'Viento 100° 13 kt · No oficial',
      detail: 'METAR de las 10:50',
      lines: [
        'R08: 12 kt de frente · 6 kt de la derecha', 'R26: 12 kt de cola · 6 kt de la izquierda',
        'R09: 13 kt de frente · 3 kt de la derecha', 'R27: 13 kt de cola · 3 kt de la izquierda',
      ],
    });
    expect(windTooltip(properties, 'en')).toEqual({
      title: 'Wind 100° 13 kt · Unofficial',
      detail: 'METAR of 10:50',
      lines: [
        'R08: 12 kt headwind · 6 kt from the right', 'R26: 12 kt tailwind · 6 kt from the left',
        'R09: 13 kt headwind · 3 kt from the right', 'R27: 13 kt tailwind · 3 kt from the left',
      ],
    });
    // Stale: its time instead; calm: no runway lines; anything else: no tooltip.
    const stale = readingOf({ status: 'Stale' });
    expect(windTooltip(propertiesOf(windFeatures({ reading: stale, runway: '08' }))[0]).detail)
      .toBe('Sin actualizar desde las 08:00');
    const calm = propertiesOf(windFeatures({ reading: readingOf({ wind: { directionDeg: 0, speedKt: 0 } }) }))[0];
    expect(windTooltip(calm)).toEqual({ title: 'Viento en calma · No oficial', detail: 'METAR de las 10:50', lines: [] });
    expect(windTooltip({ kind: 'runway' })).toBeNull();
    expect(windTooltip(null)).toBeNull();
  });
});

describe('weather layers: on screen and in the layers menu', () => {
  it('lists the wind and the images drawn for the legend, with the time of each image', () => {
    const [drawn] = windFeatures({ reading: readingOf(), runway: '08' }).features;
    const rendered = [{ layer: { id: WIND_LAYER_IDS[0] }, properties: drawn.properties }];
    expect(weatherOnScreen({ wind: rendered, rasters: { goes: true, imerg: true }, imagery: READY })).toEqual({
      kinds: ['wind', 'goes', 'imerg'],
      imagery: { goes: { time: READY.goes.time, precision: 'instant' }, imerg: { time: READY.imerg.time, precision: 'instant' } },
    });
    // A stale wind; an image drawn only while ready; nothing, nothing.
    const stale = [{ properties: { ...drawn.properties, stale: true } }];
    expect(weatherOnScreen({ wind: stale, rasters: { goes: true }, imagery: { goes: { status: 'loading' } } }))
      .toEqual({ kinds: ['windStale'], imagery: {} });
    expect(weatherOnScreen({ wind: [{ properties: { kind: 'ring' } }], rasters: { goes: false }, imagery: READY }))
      .toEqual({ kinds: [], imagery: {} });
    expect(weatherOnScreen()).toEqual({ kinds: [], imagery: {} });
    // The time of an image at the station, or the day of a daily one.
    expect(imageTimeWords(READY.goes)).toBe('Imagen de las 10:50');
    expect(imageTimeWords(READY.imerg, 'en')).toBe('Image of 10:30');
    expect(imageTimeWords({ time: '2026-11-13', precision: 'day' })).toBe('Imagen del 13 nov');
    expect(imageTimeWords({ time: null })).toBeNull();
  });

  it('says under a weather key that is on why the map shows nothing of it, or the time of its image', () => {
    const on = { [WEATHER_GROUPS.goes]: true, [WEATHER_GROUPS.imerg]: true, [WEATHER_GROUPS.wind]: true };
    const live = readingOf();
    expect(weatherLayerNotes({ layers: on, view: 'region', imagery: READY, weather: live })).toEqual({
      'weather.goes': 'Imagen de las 10:50', 'weather.imerg': 'Imagen de las 10:30',
    });
    expect(weatherLayerNotes({ layers: on, view: 'approach', imagery: { goes: { status: 'loading' },
      imerg: { status: 'unavailable' } }, weather: live })).toEqual({
      'weather.goes': 'Buscando la imagen…', 'weather.imerg': 'No hay imagen en este momento.',
    });
    // Outside Región and Aproximación, with the views' names of the key table.
    expect(weatherLayerNotes({ layers: on, view: 'ramp', imagery: READY, weather: live })).toEqual({
      'weather.goes': 'Se ve en Región y Aproximación', 'weather.imerg': 'Se ve en Región y Aproximación',
    });
    expect(weatherLayerNotes({ layers: on, view: 'airfield', weather: live, language: 'en' })['weather.goes'])
      .toBe('Shown in Region and Approach');
    // The wind says the state of the weather when it gives none; keys that are off say nothing.
    const wind = { [WEATHER_GROUPS.wind]: true };
    expect(weatherLayerNotes({ layers: wind, weather: readingOf({ status: 'Unavailable' }) }))
      .toEqual({ 'weather.wind': 'No hay clima del aeródromo en este momento.' });
    expect(weatherLayerNotes({ layers: wind, weather: readingOf({ status: 'Disabled' }) }))
      .toEqual({ 'weather.wind': 'El clima del aeródromo no está activado en este entorno.' });
    expect(weatherLayerNotes({ layers: wind, weather: { status: 'unauthorized' } }))
      .toEqual({ 'weather.wind': 'Tu acceso no incluye el clima del aeródromo.' });
    expect(weatherLayerNotes({ layers: wind, weather: { status: 'error' } }))
      .toEqual({ 'weather.wind': 'No se pudo cargar el clima del aeródromo.' });
    expect(weatherLayerNotes({ layers: wind, weather: { status: 'loading' } }))
      .toEqual({ 'weather.wind': 'Cargando el clima del aeródromo…' });
    expect(weatherLayerNotes({ layers: wind, weather: readingOf({ status: 'Stale' }) })).toEqual({});
    expect(weatherLayerNotes({ layers: {}, view: 'ramp', weather: null })).toEqual({});
  });
});
