import { createTranslator, localeFor } from '../../../i18n/languageStore';
import { SATELLITE_LAYERS, SATELLITE_OPACITY, satelliteTileAt } from '../../../services/satelliteService';
import { occColor } from '../../occ-ui/occPalette';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, roundCoord } from '../airport/geo';
import { layoutBounds } from '../airport/layoutBounds';
import { runwayLabel, runwayWinds } from '../airport/runwayWind';
import { GIBS_ATTRIBUTION } from '../core/attribution';
import { PUJ_ARP } from '../core/cameraPresets';
import { mapMessages } from '../mapMessages';
import { FONT_STACKS } from '../style/basemapLayers';
import { FLIGHT_CATEGORIES, FLIGHT_CATEGORY_COLORS, SIGMET_HAZARDS, SIGMET_HAZARD_COLORS } from '../style/weatherColors';
import { barbImageFor } from '../style/weatherImages';
import { WIND_MAX_AGE_MINUTES } from './referenceFeatures';
import { dayPhase, sunPosition } from './solar';
import { staleWords, stationTime } from './stationTime';

// The weather on the one canvas of the OCC maps (design E6, PR M8; contracts 2.3: weather is a layer, not a view), the
// one owner of its sources, layers and features:
// - the GOES-East infrared clouds and the IMERG rain of NASA GIBS, which the retired GoesCloudMap drew apart: two
//   raster sources in the `weather` slot, under the references, drawn in Región and Aproximación only, off until a
//   person turns them on, and born hidden: OccMap shows one only once it has pinned its tiles to the time GIBS reports
//   (services/satelliteService.js: satelliteTileAt), so the map never asks for an image that is not the one it names.
//   Their credit, NASA GIBS, travels on their sources, so MapLibre lists it only while one of them is drawn;
// - the wind at the airfield, from the METAR of the aerodrome weather (useMdpcWeather): an arrow turned to where the wind
//   blows and «100° 13 kt R08» (its direction or «VRB», its speed, its gust and the runway in use) in the open ground
//   between the runways, clear of the stands, from the airfield threshold on; below it the words alone, under the mark
//   of PUJ. A stale METAR is dimmed and says «Sin actualizar desde las 14:02»; an unavailable or disabled one draws
//   nothing. Its tooltip gives the head and cross wind of every runway end (airport/runwayWind.js).
// Quiet, like the references: no hue, the text tokens only and the satellite images in greys (contracts 2.4). Pure: the
// reading, the runway in use, the layout, the language and the instant are parameters.
//
// The regional weather (lane M7, owner decisions of 2026-11-26 and 2026-11-27), for a map that opts in
// (weatherOverlay({ regional: true })), drawn in Región and Aproximación only:
// - a loop of the GOES-East satellite: LOOP_FRAME_COUNT raster sources, each pinned once to the time of its frame (the
//   infrared Band 13 at night, in greys, or GeoColor by day, in its own colours), and the loop runs by switching the
//   raster-opacity of their layers (loopFrameIndex, frameOpacities), never by giving a source new tiles per frame;
// - the radar: RADAR_FRAME_COUNT raster sources pinned to the tile templates of the API's radar frames
//   (GET occ/weather/radar), animated the same way, in the provider's colour scale (style/weatherColors.js);
// - the METAR stations of the region (GET occ/weather/region): a dot in the colour of the flight category (VFR green,
//   MVFR blue, IFR red, LIFR magenta: the aviation colours the owner approved), the wind barb (style/weatherImages.js)
//   and the ICAO code with the category in words, so nothing reads by colour alone;
// - the SIGMETs of the region (GET occ/weather/sigmet): a light fill and an outline in the colour of the hazard, and its
//   words. The weather layers are the only ones with hue (style/weatherColors.js); the satellite infrared stays grey.

export const SATELLITE_KEYS = Object.freeze(['goes', 'imerg']);
/** The raster sources of the satellite images. */
export const SATELLITE_SOURCES = Object.freeze({ goes: 'occ-weather-goes', imerg: 'occ-weather-imerg' });
/** Their layers. */
export const SATELLITE_LAYER_IDS = Object.freeze({ goes: 'occ-weather-goes-image', imerg: 'occ-weather-imerg-image' });
/** The source of the wind. */
export const WIND_SOURCE = 'occ-weather-wind';
/** The layers-menu keys of the weather (design E7; lane M7 the regional ones), each the `occ:group` of its layers. */
export const WEATHER_GROUPS = Object.freeze({
  goes: 'weather.goes', imerg: 'weather.imerg', wind: 'weather.wind',
  loop: 'weather.loop', radar: 'weather.radar', stations: 'weather.stations', sigmet: 'weather.sigmet',
});
/** The regional keys (lane M7), drawn only by a map that opts in. */
export const REGIONAL_KEYS = Object.freeze(['loop', 'radar', 'stations', 'sigmet']);
/** The views a satellite image is drawn and read in: Región and Aproximación. */
export const RASTER_VIEWS = Object.freeze(['region', 'approach']);
/** GIBS serves the regional images in 256 px tiles up to level 6; MapLibre stretches them past it. */
export const SATELLITE_TILE_SIZE = 256;
export const SATELLITE_MAX_ZOOM = 6;
/**
 * The saturation of the satellite images on the map: none, so they are drawn in greys (contracts 2.4: normal things
 * carry no hue). GIBS paints them with colour scales of its own, IMERG's rain in blues, greens, yellows, oranges, reds
 * and violets, and the OCC keeps amber and red for attention and urgent. The legend marks them in white.
 */
export const SATELLITE_SATURATION = -1;
/**
 * Where the wind stands in the airport's box, as fractions of its width from the west and of its height from the south:
 * in the open ground between the two runways at Punta Cana, east of the taxiways and far from the stands, which lie
 * along the south side, so its words run east inside the Aeródromo view (the box's corner itself sits at the edge of
 * that view, under the map's controls).
 */
export const WIND_BOX_POSITION = Object.freeze([0.84, 0.7]);
// Without an airport box, how far north-east of the reference point.
const FALLBACK_WIND_OFFSET_M = 2000;
/** The id of the wind's features, the one OccMap picks. */
export const WIND_FEATURE_ID = 'wind';
/** The wind's layers: the arrow and its words by the airport's box, and the words under the mark of PUJ further out. */
export const WIND_LAYER_IDS = Object.freeze(['occ-weather-wind', 'occ-weather-wind-label', 'occ-weather-wind-label-wide']);
/** The legend's weather kinds, in its order (ui/referenceLegend.js). */
export const WEATHER_LEGEND_KINDS = Object.freeze([
  'wind', 'windStale', 'goes', 'imerg',
  // The regional weather (lane M7).
  'loopIr', 'loopGeocolor', 'radar', 'sigmet', 'categoryVFR', 'categoryMVFR', 'categoryIFR', 'categoryLIFR',
  'categoryNone', 'barb',
]);

const WEATHER_SLOT = 'weather';
const WIND_SLOT = 'standLabels';
const LABEL_SIZE = 12;
const MINUTE_MS = 60_000;
// The states of the aerodrome weather that carry a METAR (contracts 1.4).
const WITH_METAR = new Set(['Live', 'Stale']);
const STALE = ['==', ['get', 'stale'], true];
const PLACED_BY_AIRFIELD = ['==', ['get', 'placement'], 'airfield'];
const PLACED_WIDE = ['==', ['get', 'placement'], 'wide'];
const HALO = Object.freeze({ 'text-halo-color': occColor('nav'), 'text-halo-width': 1.2 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

function rasterSource(key) {
  return {
    type: 'raster',
    tiles: [SATELLITE_LAYERS[key]],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: SATELLITE_MAX_ZOOM,
    attribution: GIBS_ATTRIBUTION,
  };
}

function rasterLayer(key) {
  return {
    slot: WEATHER_SLOT,
    id: SATELLITE_LAYER_IDS[key],
    type: 'raster',
    source: SATELLITE_SOURCES[key],
    layout: { visibility: 'none' },
    // In greys, without the colours of GIBS (SATELLITE_SATURATION). No fade: a new image replaces the old one at once
    // (its tiles reload anyway), and a fade never ends under the map lab's frozen clock (MapLibre's setNow), where the
    // map would never settle.
    paint: {
      'raster-opacity': SATELLITE_OPACITY[key], 'raster-saturation': SATELLITE_SATURATION, 'raster-fade-duration': 0,
    },
    metadata: { 'occ:group': WEATHER_GROUPS[key], 'occ:maxThreshold': 'airfield' },
  };
}

const windMetadata = thresholds => ({
  'occ:group': WEATHER_GROUPS.wind, 'occ:pick': 'wind', 'occ:pickId': 'id', ...thresholds,
});

// The words of the wind: in the text colour, or dimmed when its METAR is stale. `place` is where they sit around their
// point: a fixed anchor and offset, or the anchors MapLibre tries in turn (variable) with their offset.
function windWordsLayer(id, { filter, place, thresholds }) {
  return {
    slot: WIND_SLOT,
    id,
    type: 'symbol',
    source: WIND_SOURCE,
    filter,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [...FONT_STACKS.regular],
      'text-size': LABEL_SIZE,
      ...place,
      'text-max-width': 30,
    },
    paint: {
      'text-color': ['case', STALE, occColor('muted'), occColor('text')],
      'text-opacity': ['case', STALE, 0.75, 1],
      ...HALO,
    },
    metadata: windMetadata(thresholds),
  };
}

/**
 * The overlay of the weather for buildOccStyle: the raster sources of the GOES-East clouds and the IMERG rain (their
 * tiles the latest image until OccMap pins them, their credit NASA GIBS) and the GeoJSON source of the wind, born empty.
 * The images lie in the weather slot, born hidden, up to the airfield threshold (Región and Aproximación), in greys
 * (SATELLITE_SATURATION); the rain over the clouds. The wind lies in the slot of the stand labels, over the airfield and
 * the stands: from the airfield threshold on, its arrow (turned on the map to where the wind blows, a ring for a calm or
 * variable wind) and its words beside it; below that threshold, its words alone under the mark of PUJ. Each layer of the
 * wind picks the kind `wind`. `regional: true` (lane M7) adds the regional weather: the satellite loop, the radar, the
 * SIGMETs and the METAR stations (regionalOverlay).
 */
export function weatherOverlay({ regional = false } = {}) {
  const extra = regional ? regionalOverlay() : { sources: {}, layers: [] };
  return {
    sources: {
      [SATELLITE_SOURCES.goes]: rasterSource('goes'),
      [SATELLITE_SOURCES.imerg]: rasterSource('imerg'),
      ...extra.sources,
      [WIND_SOURCE]: { type: 'geojson' },
    },
    layers: [
      // The regional weather (lane M7): the loop and the radar under the satellite images of PR M8, the SIGMETs over
      // them, and the stations (in their own slot) over the references.
      ...extra.layers.filter(layer => layer.type === 'raster'),
      rasterLayer('goes'),
      rasterLayer('imerg'),
      ...extra.layers.filter(layer => layer.type !== 'raster'),
      {
        slot: WIND_SLOT,
        id: WIND_LAYER_IDS[0],
        type: 'symbol',
        source: WIND_SOURCE,
        filter: PLACED_BY_AIRFIELD,
        layout: {
          'icon-image': ['case', ['==', ['get', 'arrow'], true], 'wind-arrow', 'wind-calm'],
          'icon-rotate': ['get', 'rotate'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
        paint: {
          'icon-color': ['case', STALE, occColor('muted'), occColor('text')],
          'icon-opacity': ['case', STALE, 0.75, 1],
          'icon-halo-color': occColor('nav'),
          'icon-halo-width': 1,
        },
        metadata: windMetadata({ 'occ:minThreshold': 'airfield' }),
      },
      // By the airfield, to the east of the arrow.
      windWordsLayer(WIND_LAYER_IDS[1], {
        filter: PLACED_BY_AIRFIELD,
        place: { 'text-anchor': 'left', 'text-offset': [1.4, 0], 'text-justify': 'left' },
        thresholds: { 'occ:minThreshold': 'airfield' },
      }),
      // Further out, under the mark of PUJ (whose code sits above it), else beside it where the traffic leaves room.
      windWordsLayer(WIND_LAYER_IDS[2], {
        filter: PLACED_WIDE,
        place: { 'text-variable-anchor': ['top', 'right', 'left'], 'text-radial-offset': 1.3, 'text-justify': 'auto' },
        thresholds: { 'occ:maxThreshold': 'airfield' },
      }),
    ],
  };
}

/**
 * The tiles of a satellite image pinned to the time GIBS reports for it (`info.time`, as useSatelliteImagery answers):
 * `[template]`, or null for an unknown layer or a time GIBS did not give.
 */
export function satelliteTiles(layer, info) {
  if (!SATELLITE_KEYS.includes(layer)) return null;
  const pinned = satelliteTileAt(layer, info?.time ?? null);
  return pinned === null ? null : Object.freeze([pinned]);
}

/** Whether a satellite image is ready to draw: its read answered with a time its tiles can be pinned to. */
export const isImageReady = (layer, info) => info?.status === 'ready' && satelliteTiles(layer, info) !== null;

/**
 * The satellite images a map reads now: `{ goes, imerg }`, each true while the map draws the weather, the layers menu
 * (or the page) shows it and the map is in Región or Aproximación.
 */
export function wantedImagery({ groups, view, drawsWeather = true } = {}) {
  const inView = RASTER_VIEWS.includes(view);
  return Object.freeze(Object.fromEntries(SATELLITE_KEYS.map(key => [key,
    Boolean(drawsWeather) && inView && groups?.[WEATHER_GROUPS[key]] === true])));
}

/**
 * The groups of the map with each satellite image hidden until it is ready (isImageReady): what the layers menu shows,
 * the map shows once it can pin the image. Other groups pass as they are; a group that is not there is not added.
 */
export function withPinnedImagery(groups, imagery) {
  const next = { ...groups };
  for (const key of SATELLITE_KEYS) {
    const group = WEATHER_GROUPS[key];
    if (Object.hasOwn(next, group)) next[group] = next[group] === true && isImageReady(key, imagery?.[key]);
  }
  return next;
}

/**
 * The wind of the aerodrome weather (what useMdpcWeather answers): `{ directionDeg, speedKt, gustKt, variable, calm,
 * observedAt, stale }` (whole degrees and knots, `observedAt` in milliseconds), or null when the weather is not Live or
 * Stale (Unavailable, Disabled, still loading or failed) or its METAR has no wind. `stale` for a Stale METAR, and for a
 * Live one older than the API's live limit at `nowMs` (the server's minute: a reading kept after failed refreshes ages).
 */
export function windReading(reading, nowMs = null) {
  if (!WITH_METAR.has(reading?.apiStatus)) return null;
  const observedAt = Date.parse(reading.data?.observedAt ?? '');
  const wind = reading.data?.metar?.wind;
  if (!finite(observedAt) || !wind || !finite(wind.speedKt) || wind.speedKt < 0) return null;
  const speedKt = Math.round(wind.speedKt);
  const calm = speedKt === 0;
  const variable = !calm && (wind.variable === true || !finite(wind.directionDeg));
  const aged = finite(nowMs) && nowMs - observedAt > WIND_MAX_AGE_MINUTES * MINUTE_MS;
  return Object.freeze({
    directionDeg: calm || variable ? null : Math.round(wind.directionDeg),
    speedKt,
    gustKt: finite(wind.gustKt) && wind.gustKt > speedKt ? Math.round(wind.gustKt) : null,
    variable,
    calm,
    observedAt,
    stale: reading.apiStatus === 'Stale' || aged,
  });
}

/**
 * The words of a wind (windReading's shape) in `language`: «100° 13 kt», «100° 13 kt G25», «VRB 3 kt» or «Calma»; the
 * direction with three digits, as the METAR writes it. Null without a wind.
 */
export function windWords(wind, language = 'es') {
  if (!wind) return null;
  const t = createTranslator(mapMessages, language);
  if (wind.calm) return t('weather.wind.calm');
  const direction = wind.variable || !finite(wind.directionDeg)
    ? t('weather.wind.variable')
    : `${String(wind.directionDeg).padStart(3, '0')}°`;
  const gust = finite(wind.gustKt) ? ` ${t('weather.wind.gust', { speed: wind.gustKt })}` : '';
  return `${direction} ${wind.speedKt} kt${gust}`;
}

/**
 * What the map writes by the wind: its words and the runway in use, «100° 13 kt R08» (airport/runwayWind.js:
 * runwayLabel); the words alone without a runway. Null without a wind.
 */
export function windLabel(wind, ident, language = 'es') {
  const words = windWords(wind, language);
  if (words === null) return null;
  const runway = runwayLabel(ident);
  return runway === null ? words : `${words} ${runway}`;
}

/**
 * Where the wind stands by the airport: at WIND_BOX_POSITION of the layout's box, or without a box 2 km north-east of
 * the reference point of PUJ.
 */
export function windPoint(layout = MDPC_LAYOUT) {
  const bounds = layoutBounds(layout);
  if (bounds === null) return roundCoord(destinationPoint(PUJ_ARP, 45, FALLBACK_WIND_OFFSET_M), 6);
  const [[west, south], [east, north]] = bounds;
  const [across, up] = WIND_BOX_POSITION;
  return roundCoord([west + (east - west) * across, south + (north - south) * up], 6);
}

/**
 * The data of the wind's source: nothing without a wind (windReading), else the same wind twice, `placement: 'airfield'`
 * at windPoint(layout) and `placement: 'wide'` at the mark of PUJ. Each carries `kind: 'wind'`, `id`, `label` (windLabel
 * with the runway in use, `runway` an ident or `{ arrival }`, then «Sin actualizar desde las 14:02» on a second line
 * when stale), `arrow` (a direction to point to) and `rotate` (where the wind blows to: its direction + 180°), `stale`,
 * `calm`, `variable`, `directionDeg`, `speedKt`, `gustKt`, `observedAt` (ISO), `runway` and `runways`, the wind on
 * every runway end for the tooltip (airport/runwayWind.js: runwayWinds; none for a calm or variable wind).
 */
export function windFeatures({ reading = null, runway = null, layout = MDPC_LAYOUT, language = 'es', nowMs = null } = {}) {
  const wind = windReading(reading, nowMs);
  if (wind === null) return emptyCollection();
  const ident = typeof runway === 'string' ? runway : (runway?.arrival ?? null);
  const words = windLabel(wind, ident, language);
  const arrow = !wind.calm && !wind.variable;
  const runways = runwayWinds(layout, { directionDeg: wind.directionDeg, speedKt: wind.speedKt, variable: wind.variable })
    .map(entry => ({ ident: entry.ident, label: entry.label, headwindKt: entry.headwindKt, crosswindKt: entry.crosswindKt,
      side: entry.side }));
  const properties = {
    kind: 'wind',
    id: WIND_FEATURE_ID,
    label: wind.stale ? `${words}\n${staleWords(wind.observedAt, language)}` : words,
    arrow,
    rotate: arrow ? (wind.directionDeg + 180) % 360 : 0,
    stale: wind.stale,
    calm: wind.calm,
    variable: wind.variable,
    directionDeg: wind.directionDeg,
    speedKt: wind.speedKt,
    gustKt: wind.gustKt,
    observedAt: new Date(wind.observedAt).toISOString(),
    runway: ident,
    runways,
  };
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { ...properties, placement: 'airfield' }, geometry: { type: 'Point', coordinates: windPoint(layout) } },
      { type: 'Feature', properties: { ...properties, placement: 'wide' }, geometry: { type: 'Point', coordinates: [...PUJ_ARP] } },
    ],
  };
}

// One line of the tooltip: «R08: 12 kt de frente · 6 kt de la derecha», «R26: 12 kt de cola · 6 kt de la izquierda».
function runwayLine({ ident, label, headwindKt, crosswindKt, side }, t) {
  const parts = [];
  if (headwindKt > 0) parts.push(t('wind.head', { speed: headwindKt }));
  if (headwindKt < 0) parts.push(t('wind.tail', { speed: -headwindKt }));
  if (crosswindKt > 0) parts.push(t(side === 'left' ? 'wind.fromLeft' : 'wind.fromRight', { speed: crosswindKt }));
  return `${label ?? ident}: ${parts.join(' · ')}`;
}

/**
 * The tooltip of the wind from its feature's properties (windFeatures): `{ title, detail, lines }` in `language`. The
 * title is the wind with «No oficial» (TAGS.unofficial: ELEVANT relays the weather service), «Viento 100° 13 kt · No
 * oficial» or «Viento en calma · No oficial»; the detail the time of the METAR at the station, «METAR de las 10:50», or
 * «Sin actualizar desde las 14:02» when stale; a line for every runway end with its head (or tail) and cross wind. Null
 * for anything but the wind.
 */
export function windTooltip(properties, language = 'es') {
  if (properties?.kind !== 'wind') return null;
  const t = createTranslator(mapMessages, language);
  const unofficial = TAGS.unofficial[language] ?? TAGS.unofficial.es;
  const wind = {
    calm: properties.calm === true, variable: properties.variable === true, directionDeg: properties.directionDeg,
    speedKt: properties.speedKt, gustKt: properties.gustKt,
  };
  const words = wind.calm ? t('wind.calmTitle') : t('wind.title', { wind: windWords(wind, language) });
  const observedAt = Date.parse(properties.observedAt ?? '');
  let detail = null;
  if (properties.stale === true) detail = staleWords(finite(observedAt) ? observedAt : null, language);
  else if (finite(observedAt)) detail = t('wind.observed', { time: stationTime(observedAt, localeFor(language)) });
  const runways = Array.isArray(properties.runways) ? properties.runways : [];
  return { title: `${words} · ${unofficial}`, detail, lines: runways.map(entry => runwayLine(entry, t)) };
}

/**
 * What the map draws of the weather, for the legend: `{ kinds, imagery }`. `wind` are the features queryRenderedFeatures
 * answers for WIND_LAYER_IDS: `wind`, or `windStale` when what is drawn is stale. `rasters` says which satellite image
 * the map draws (`{ goes, imerg }` booleans: OccMap knows it from the shown groups and the zoom, a raster is not read
 * back), and `imagery` is what useSatelliteImagery answers: an image is on screen only while ready, and `imagery` keeps
 * the time and precision of each image on screen. Kinds in WEATHER_LEGEND_KINDS order.
 *
 * The regional weather (lane M7): `loop` and `radar` are the frames the map pinned (`{ frames, band }` of loopFrames,
 * `{ frames, provider }` of radarFrames, each with `demo` for a simulated answer), drawn while `rasters.loop` or
 * `rasters.radar`; `stations` and `sigmets` are what queryRenderedFeatures answers for STATION_LAYER_IDS and
 * SIGMET_LAYER_IDS. `imagery` then also keeps, by kind, the span of a loop (`from`, `time`, precision `loop`), the
 * hazards of the SIGMETs on screen and whether what is drawn is simulated (`demo`).
 */
export function weatherOnScreen({ wind = [], rasters = {}, imagery = null, loop = null, radar = null, stations = [],
  sigmets = [] } = {}) {
  const drawn = propertiesOfKind(wind, 'wind');
  const kinds = drawn.length === 0 ? [] : [drawn.some(item => item.stale === true) ? 'windStale' : 'wind'];
  const images = {};
  for (const key of SATELLITE_KEYS) {
    const info = imagery?.[key];
    if (rasters?.[key] !== true || !isImageReady(key, info)) continue;
    kinds.push(key);
    images[key] = Object.freeze({ time: info.time, precision: info.precision ?? 'instant' });
  }
  const span = (frames, extra) => Object.freeze({ from: frames[0].time, time: frames.at(-1).time, precision: 'loop',
    ...extra });
  if (rasters?.loop === true && Array.isArray(loop?.frames) && loop.frames.length > 0) {
    const kind = loop.band === 'geocolor' ? 'loopGeocolor' : 'loopIr';
    kinds.push(kind);
    images[kind] = span(loop.frames, { demo: loop.demo === true });
  }
  if (rasters?.radar === true && Array.isArray(radar?.frames) && radar.frames.length > 0) {
    kinds.push('radar');
    images.radar = span(radar.frames, { demo: radar.demo === true, provider: radar.provider ?? null });
  }
  const areas = propertiesOfKind(sigmets, 'sigmet');
  if (areas.length > 0) {
    kinds.push('sigmet');
    const hazards = SIGMET_HAZARDS.filter(hazard => areas.some(area => area.hazard === hazard));
    images.sigmet = Object.freeze({ demo: areas.some(area => area.demo === true), hazards: Object.freeze(hazards) });
  }
  const plots = propertiesOfKind(stations, 'station');
  const plotsDemo = plots.some(plot => plot.demo === true);
  for (const category of [...FLIGHT_CATEGORIES, 'None']) {
    if (!plots.some(plot => (plot.category ?? 'None') === category)) continue;
    kinds.push(`category${category}`);
    images[`category${category}`] = Object.freeze({ demo: plotsDemo });
  }
  if (plots.some(plot => typeof plot.barb === 'string')) {
    kinds.push('barb');
    images.barb = Object.freeze({ demo: plotsDemo });
  }
  return Object.freeze({ kinds: Object.freeze(kinds), imagery: Object.freeze(images) });
}

// The properties of the rendered features of `kind`, once each (a feature cut by tile edges comes back more than once).
function propertiesOfKind(features, kind) {
  const seen = new Set();
  const found = [];
  for (const item of Array.isArray(features) ? features : []) {
    const properties = item?.properties;
    if (properties?.kind !== kind) continue;
    const key = properties.id ?? `#${found.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(properties);
  }
  return found;
}

const dayFormatters = new Map();
// «13 nov.»: the day of a daily image, in UTC as GIBS names it.
function dayWords(ms, language) {
  const locale = localeFor(language);
  if (!dayFormatters.has(locale)) {
    dayFormatters.set(locale, new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  }
  return dayFormatters.get(locale).format(new Date(ms));
}

/**
 * The time of a satellite image for the legend, in `language`: «Imagen de las 10:50» (the station's time of the image)
 * or, for a daily image, «Imagen del 13 nov.»; null without a time.
 */
export function imageTimeWords(image, language = 'es') {
  const ms = Date.parse(image?.time ?? '');
  if (!finite(ms)) return null;
  const t = createTranslator(mapMessages, language);
  return image.precision === 'day'
    ? t('legend.weather.imageDay', { date: dayWords(ms, language) })
    : t('legend.weather.imageAt', { time: stationTime(ms, localeFor(language)) });
}

// The name of a view in the key table (occ-ui/occShortcuts.js), the one place the view names live.
const viewName = (view, language) => {
  const row = OCC_SHORTCUTS.find(entry => entry.action === `view.${view}`);
  return row?.[language] ?? row?.es ?? view;
};

// Why a wind the menu shows is not on the map: the state of the aerodrome weather, in its own words (mapMessages
// weather.status). A Stale METAR is drawn, dimmed, so it never comes here.
function windStateWords(weather, t) {
  if (weather?.status === 'unauthorized') return t('weather.status.forbidden');
  if (weather?.status === 'error') return t('weather.status.error');
  if (weather?.apiStatus === 'Disabled') return t('weather.status.disabled');
  if (weather?.apiStatus === 'Unavailable' || weather?.status === 'empty' || weather?.status === 'success') {
    return t('weather.status.unavailable');
  }
  return t('weather.status.loading');
}

/**
 * What the layers menu says under a weather key that is on (`layers`, the resolved keys of core/layersMenu.js), so a
 * key that shows nothing says why: a satellite image outside Región and Aproximación «Se ve en Región y Aproximación»,
 * then «Buscando la imagen…», «No hay imagen en este momento.» or, once drawn, the time of its image; the wind, when the
 * aerodrome weather gives none, the state of that weather («No hay clima del aeródromo en este momento.»).
 * `{ [key]: text }` for the keys with something to say.
 */
export function weatherLayerNotes({ layers = {}, view = null, imagery = null, weather = null, regional = null,
  nowMs = null, language = 'es' } = {}) {
  const t = createTranslator(mapMessages, language);
  const notes = {};
  for (const key of SATELLITE_KEYS) {
    const group = WEATHER_GROUPS[key];
    if (layers?.[group] !== true) continue;
    const info = imagery?.[key];
    if (!RASTER_VIEWS.includes(view)) {
      notes[group] = t('layers.note.views', { first: viewName('region', language), second: viewName('approach', language) });
    } else if (isImageReady(key, info)) notes[group] = imageTimeWords(info, language);
    else notes[group] = t(info?.status === 'unavailable' ? 'layers.note.noImage' : 'layers.note.loadingImage');
  }
  if (layers?.[WEATHER_GROUPS.wind] === true && windReading(weather, nowMs) === null) {
    notes[WEATHER_GROUPS.wind] = windStateWords(weather, t);
  }
  if (regional !== null) Object.assign(notes, regionalLayerNotes({ layers, view, regional, nowMs, t, language }));
  return Object.freeze(notes);
}

// ---------------------------------------------------------------------------------------------------------------------
// The regional weather (lane M7). The builders below are pure: the answers of the API (the shapes of
// OccRegionWeatherResponse, OccSigmetsResponse and OccRadarFramesResponse), the instant and the language are parameters.

/** The frames of the satellite loop: six images ten minutes apart, the last the latest GIBS reports. */
export const LOOP_FRAME_COUNT = 6;
export const LOOP_STEP_MINUTES = 10;
/** The frames of the radar the map keeps: the latest six the API lists. */
export const RADAR_FRAME_COUNT = 6;
/** How long each frame shows while a loop runs, and how long the latest one holds before the loop starts again. */
export const LOOP_FRAME_MS = 600;
export const LOOP_HOLD_MS = 1800;

/**
 * The GOES-East images of NASA GIBS the loop can run (checked against GIBS on 2026-11-27: both answer with a
 * Layer-Time-Actual every ten minutes and accept a pinned time): the clean infrared of Band 13 (level 6), drawn in greys
 * as the satellite of PR M8, and GeoColor (level 7, true colour by day and the infrared over city lights at night), drawn
 * in its own colours (owner exception of 2026-11-26 for the weather layers). The loop's sources stop at level 6, which
 * both serve, so changing the band only gives them new tiles and a new saturation.
 */
export const LOOP_BANDS = Object.freeze({
  ir: Object.freeze({ layer: 'GOES-East_ABI_Band13_Clean_Infrared', matrix: 'GoogleMapsCompatible_Level6', saturation: -1,
    opacity: 0.7 }),
  geocolor: Object.freeze({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7', saturation: 0,
    opacity: 0.8 }),
});
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
/** The radar's tiles: 256 px up to level 7, stretched past it. */
export const RADAR_TILE_SIZE = 256;
export const RADAR_MAX_ZOOM = 7;
export const RADAR_OPACITY = 0.7;
/**
 * The tiles a radar source is born with, never asked for: its layer is born hidden and OccMap shows it only once it has
 * pinned the source to a frame of the API (the latest TJUA image of IEM, an origin the CSP already allows).
 */
export const RADAR_PLACEHOLDER_TILE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::TJUA-N0Q-0/{z}/{x}/{y}.png';

export const loopSourceId = index => `occ-weather-loop-${index}`;
export const loopLayerId = index => `occ-weather-loop-${index}-image`;
export const radarSourceId = index => `occ-weather-radar-${index}`;
export const radarLayerId = index => `occ-weather-radar-${index}-image`;
/** The sources and layers of the METAR stations and of the SIGMETs. */
export const STATIONS_SOURCE = 'occ-weather-stations';
export const STATION_LAYER_IDS = Object.freeze(['occ-weather-stations-dot', 'occ-weather-stations-barb',
  'occ-weather-stations-label']);
export const SIGMET_SOURCE = 'occ-weather-sigmet';
export const SIGMET_LAYER_IDS = Object.freeze(['occ-weather-sigmet-fill', 'occ-weather-sigmet-line',
  'occ-weather-sigmet-label']);
/** The credit of the stations and the SIGMETs, on their sources: MapLibre lists it while one of them is drawn. */
export const AWC_ATTRIBUTION = '<a href="https://aviationweather.gov" target="_blank" rel="noopener noreferrer">NOAA Aviation Weather Center</a>';
/** The credit of each radar provider the API may name, for the map's attribution while the radar is on screen. */
export const RADAR_CREDITS = Object.freeze({
  rainviewer: Object.freeze({ name: 'RainViewer', homeUrl: 'https://www.rainviewer.com' }),
  'iem-tjua': Object.freeze({ name: 'Iowa Environmental Mesonet (NWS TJUA)', homeUrl: 'https://mesonet.agron.iastate.edu' }),
});
/** The radius of a station's dot, in px. */
export const STATION_RADIUS = 5;

const REGIONAL_THRESHOLDS = Object.freeze({ 'occ:maxThreshold': 'airfield' });
const STATION_SLOT = 'standLabels';
const GIBS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const TILE_TEMPLATE = /^https:\/\/[^/\s]+\/\S*$/;
const LOOP_SOURCES = Array.from({ length: LOOP_FRAME_COUNT }, (_, index) => index);
const RADAR_SOURCES = Array.from({ length: RADAR_FRAME_COUNT }, (_, index) => index);
const STATION_STALE_OPACITY = 0.55;
const NO_CATEGORY = ['==', ['get', 'category'], null];
const categoryColour = () => ['match', ['get', 'category'],
  ...FLIGHT_CATEGORIES.flatMap(category => [category, FLIGHT_CATEGORY_COLORS[category]]), occColor('muted')];
const hazardColour = () => ['match', ['get', 'hazard'],
  ...SIGMET_HAZARDS.filter(hazard => hazard !== 'OTHER').flatMap(hazard => [hazard, SIGMET_HAZARD_COLORS[hazard]]),
  SIGMET_HAZARD_COLORS.OTHER];

/** The tile template of a GOES-East band of the loop pinned to `time` (a GIBS instant), or null. */
export function loopTileAt(band, time) {
  const spec = Object.hasOwn(LOOP_BANDS, band) ? LOOP_BANDS[band] : null;
  if (spec === null || !GIBS_TIME.test(time ?? '') || !finite(Date.parse(time))) return null;
  return `${GIBS_WMTS}/${spec.layer}/default/${time}/${spec.matrix}/{z}/{y}/{x}.png`;
}

const gibsInstant = ms => `${new Date(ms).toISOString().slice(0, 19)}Z`;

/**
 * The instants of the loop's frames, oldest first: `count` images `stepMinutes` apart ending at `latestTime` (the time
 * GIBS reports for the latest image, as useSatelliteImagery reads it). Empty without a GIBS instant.
 */
export function loopFrameTimes(latestTime, { count = LOOP_FRAME_COUNT, stepMinutes = LOOP_STEP_MINUTES } = {}) {
  const latest = GIBS_TIME.test(latestTime ?? '') ? Date.parse(latestTime) : Number.NaN;
  if (!finite(latest)) return Object.freeze([]);
  return Object.freeze(Array.from({ length: count },
    (_, index) => gibsInstant(latest - (count - 1 - index) * stepMinutes * MINUTE_MS)));
}

/**
 * The band of the loop at `ms`: GeoColor while the sun is up at Punta Cana (its visible picture), the infrared once it
 * has set (twilight and night), when the visible has nothing to show.
 */
export function loopBandAt(ms) {
  if (!finite(ms)) return 'ir';
  return dayPhase(sunPosition(ms, PUJ_ARP).elevationDeg) === 'day' ? 'geocolor' : 'ir';
}

/**
 * The frames of the loop for `band` ending at `latestTime`: `[{ index, source, layer, time, tiles }]`, oldest first,
 * one per loop source, each pinned once (OccMap gives a source new tiles only when its frame changes). Empty for an
 * unknown band or without a time.
 */
export function loopFrames({ band = 'ir', latestTime = null } = {}) {
  if (!Object.hasOwn(LOOP_BANDS, band)) return Object.freeze([]);
  return Object.freeze(loopFrameTimes(latestTime).map((time, index) => Object.freeze({
    index, source: loopSourceId(index), layer: loopLayerId(index), time, tiles: Object.freeze([loopTileAt(band, time)]),
  })));
}

/** The paint of the loop's layers for `band`: its saturation (greys for the infrared) and the opacity it shows at. */
export function loopPaint(band) {
  const spec = Object.hasOwn(LOOP_BANDS, band) ? LOOP_BANDS[band] : LOOP_BANDS.ir;
  return Object.freeze({ saturation: spec.saturation, opacity: spec.opacity });
}

const isTileTemplate = value => typeof value === 'string' && TILE_TEMPLATE.test(value)
  && ['{z}', '{x}', '{y}'].every(part => value.includes(part));

/**
 * The radar frames of an answer of GET occ/weather/radar: the latest RADAR_FRAME_COUNT frames with a time and an https
 * tile template (with `{z}`, `{x}` and `{y}`), oldest first, as `[{ index, source, layer, time, tiles }]`, each on its
 * own radar source. Only a Live or Stale answer has frames; anything else gives none.
 */
export function radarFrames(response) {
  if (!WITH_METAR.has(response?.status) || !Array.isArray(response?.frames)) return Object.freeze([]);
  const usable = response.frames
    .filter(frame => finite(Date.parse(frame?.time ?? '')) && isTileTemplate(frame?.tileUrlTemplate))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .slice(-RADAR_FRAME_COUNT);
  return Object.freeze(usable.map((frame, index) => Object.freeze({
    index, source: radarSourceId(index), layer: radarLayerId(index), time: new Date(Date.parse(frame.time)).toISOString(),
    tiles: Object.freeze([frame.tileUrlTemplate]),
  })));
}

/**
 * Which frame of a loop of `count` frames shows `elapsedMs` after it started: each frame `frameMs`, the last one held
 * `holdMs`, then again from the first. A single frame, or no clock, shows the latest; no frame gives -1.
 */
export function loopFrameIndex(elapsedMs, count, { frameMs = LOOP_FRAME_MS, holdMs = LOOP_HOLD_MS } = {}) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (count === 1 || !finite(elapsedMs) || elapsedMs < 0) return count - 1;
  const cycle = (count - 1) * frameMs + holdMs;
  return Math.min(count - 1, Math.floor((elapsedMs % cycle) / frameMs));
}

/**
 * The raster-opacity of each of `count` frame layers while frame `active` shows: `opacity` for it, 0 for the rest
 * (they stay drawn, so the next frame's tiles are already there when its turn comes).
 */
export function frameOpacities(active, count, opacity) {
  return Object.freeze(Array.from({ length: Math.max(0, count) }, (_, index) => (index === active ? opacity : 0)));
}

// A raster of the loop or the radar: born hidden and transparent, without a fade (a frame replaces the one before at
// once, and a fade never ends under the map lab's frozen clock), in Región and Aproximación.
function frameLayer(id, source, group, paint) {
  return {
    slot: WEATHER_SLOT,
    id,
    type: 'raster',
    source,
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, ...paint },
    metadata: { 'occ:group': group, ...REGIONAL_THRESHOLDS },
  };
}

/**
 * The regional part of the weather overlay (lane M7): the sources and layers of the satellite loop (LOOP_FRAME_COUNT
 * rasters with the latest infrared until OccMap pins them, in greys until the band says otherwise), the radar
 * (RADAR_FRAME_COUNT rasters born with RADAR_PLACEHOLDER_TILE), the SIGMETs (a light fill and an outline in the colour
 * of the hazard, the words in the text token over the halo, legible in both themes: 2026-11-28) and the METAR stations (the dot of the flight category, the wind barb and the ICAO code with
 * the category), each in the layers-menu group of its key and drawn up to the airfield threshold.
 */
export function regionalOverlay() {
  const ir = LOOP_BANDS.ir;
  const sources = {};
  for (const index of LOOP_SOURCES) {
    sources[loopSourceId(index)] = {
      type: 'raster', tiles: [`${GIBS_WMTS}/${ir.layer}/default/default/${ir.matrix}/{z}/{y}/{x}.png`],
      tileSize: SATELLITE_TILE_SIZE, maxzoom: SATELLITE_MAX_ZOOM, attribution: GIBS_ATTRIBUTION,
    };
  }
  for (const index of RADAR_SOURCES) {
    sources[radarSourceId(index)] = { type: 'raster', tiles: [RADAR_PLACEHOLDER_TILE], tileSize: RADAR_TILE_SIZE,
      maxzoom: RADAR_MAX_ZOOM };
  }
  sources[SIGMET_SOURCE] = { type: 'geojson', attribution: AWC_ATTRIBUTION };
  sources[STATIONS_SOURCE] = { type: 'geojson', attribution: AWC_ATTRIBUTION };
  const sigmetMetadata = { 'occ:group': WEATHER_GROUPS.sigmet, ...REGIONAL_THRESHOLDS };
  const stationMetadata = { 'occ:group': WEATHER_GROUPS.stations, ...REGIONAL_THRESHOLDS };
  const staleOpacity = ['case', STALE, STATION_STALE_OPACITY, 1];
  const layers = [
    ...LOOP_SOURCES.map(index => frameLayer(loopLayerId(index), loopSourceId(index), WEATHER_GROUPS.loop,
      { 'raster-saturation': ir.saturation })),
    ...RADAR_SOURCES.map(index => frameLayer(radarLayerId(index), radarSourceId(index), WEATHER_GROUPS.radar, {})),
    {
      slot: WEATHER_SLOT, id: SIGMET_LAYER_IDS[0], type: 'fill', source: SIGMET_SOURCE,
      paint: { 'fill-color': hazardColour(), 'fill-opacity': 0.12 }, metadata: sigmetMetadata,
    },
    {
      slot: WEATHER_SLOT, id: SIGMET_LAYER_IDS[1], type: 'line', source: SIGMET_SOURCE,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': hazardColour(), 'line-width': 1.5, 'line-opacity': 0.9 }, metadata: sigmetMetadata,
    },
    {
      slot: WEATHER_SLOT, id: SIGMET_LAYER_IDS[2], type: 'symbol', source: SIGMET_SOURCE,
      layout: {
        'text-field': ['get', 'label'], 'text-font': [...FONT_STACKS.regular], 'text-size': 11, 'text-max-width': 14,
        'text-optional': true,
      },
      paint: { 'text-color': occColor('text'), ...HALO },
      metadata: sigmetMetadata,
    },
    {
      slot: STATION_SLOT, id: STATION_LAYER_IDS[0], type: 'circle', source: STATIONS_SOURCE,
      paint: {
        'circle-radius': STATION_RADIUS,
        // A station without a category is a hollow ring in the muted token: no colour to read.
        'circle-color': categoryColour(),
        'circle-opacity': ['case', NO_CATEGORY, 0, STALE, STATION_STALE_OPACITY, 1],
        'circle-stroke-color': ['case', NO_CATEGORY, occColor('muted'), occColor('nav')],
        'circle-stroke-width': ['case', NO_CATEGORY, 1.5, 1],
        'circle-stroke-opacity': staleOpacity,
      },
      metadata: stationMetadata,
    },
    {
      slot: STATION_SLOT, id: STATION_LAYER_IDS[1], type: 'symbol', source: STATIONS_SOURCE,
      filter: ['has', 'barb'],
      layout: {
        'icon-image': ['get', 'barb'], 'icon-rotate': ['get', 'rotate'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': occColor('text'), 'icon-opacity': staleOpacity, 'icon-halo-color': occColor('nav'),
        'icon-halo-width': 1,
      },
      metadata: stationMetadata,
    },
    {
      slot: STATION_SLOT, id: STATION_LAYER_IDS[2], type: 'symbol', source: STATIONS_SOURCE,
      layout: {
        'text-field': ['get', 'label'], 'text-font': [...FONT_STACKS.regular], 'text-size': 11,
        'text-anchor': 'top-left', 'text-offset': [0.7, 0.4], 'text-justify': 'left', 'text-optional': true,
      },
      paint: { 'text-color': ['case', STALE, occColor('muted'), occColor('text')], ...HALO },
      metadata: stationMetadata,
    },
  ];
  return { sources, layers };
}

const isPosition = point => Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1])
  && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

/**
 * The flight category of a METAR as the server sends it (AWC fltCat): VFR, MVFR, IFR, LIFR, or null for anything else.
 * ELEVANT never computes one (features/weather/metar.js).
 */
export const flightCategoryOf = metar => (FLIGHT_CATEGORIES.includes(metar?.flightCategory) ? metar.flightCategory : null);

/**
 * The data of the METAR stations from an answer of GET occ/weather/region (OccRegionWeatherResponse): a point for every
 * station with a position and a METAR, when the answer is Live or Stale. Each carries `kind: 'station'`, `id` and
 * `icao`, `iata`, `name`, `category` (flightCategoryOf, or null), `label` («MDSD» and the category on a second line, so
 * the category never reads by colour alone), `barb` (the image of style/weatherImages.js for its wind; absent for a
 * calm, variable or missing wind) and `rotate` (where the wind blows from), the wind (`windDirectionDeg`, `windSpeedKt`,
 * `gustKt`), `visibilitySm`, `ceilingFt`, `temperatureC`, `observedAt`, `raw`, `stale` (a Stale answer, or a METAR
 * older than 90 min at `nowMs`) and `demo` (a simulated answer, which the legend tags «Demo»).
 */
export function stationFeatures(response, { nowMs = null, demo = false } = {}) {
  if (!WITH_METAR.has(response?.status) || !Array.isArray(response?.stations)) return emptyCollection();
  const features = [];
  const seen = new Set();
  for (const station of response.stations) {
    const metar = station?.metar;
    const icao = typeof station?.icao === 'string' ? station.icao.trim().toUpperCase() : '';
    const position = [station?.longitude, station?.latitude];
    if (!metar || icao === '' || seen.has(icao) || !isPosition(position)) continue;
    seen.add(icao);
    const observedAt = Date.parse(metar.observedAt ?? '');
    const aged = finite(nowMs) && finite(observedAt) && nowMs - observedAt > WIND_MAX_AGE_MINUTES * MINUTE_MS;
    const category = flightCategoryOf(metar);
    const direction = finite(metar.windDirectionDegrees) ? Math.round(metar.windDirectionDegrees) % 360 : null;
    const speed = finite(metar.windSpeedKnots) && metar.windSpeedKnots >= 0 ? Math.round(metar.windSpeedKnots) : null;
    const barb = barbImageFor({ speedKt: speed, directionDeg: direction });
    const gust = finite(metar.windGustKnots) && speed !== null && metar.windGustKnots > speed
      ? Math.round(metar.windGustKnots) : null;
    const properties = {
      kind: 'station', id: icao, icao, iata: station.iata ?? null, name: station.name ?? null, category,
      label: category === null ? icao : `${icao}\n${category}`,
      rotate: direction ?? 0,
      windDirectionDeg: direction, windSpeedKt: speed, gustKt: gust,
      visibilitySm: finite(metar.visibilityStatuteMiles) ? metar.visibilityStatuteMiles : null,
      ceilingFt: finite(metar.ceilingFeet) ? metar.ceilingFeet : null,
      temperatureC: finite(metar.temperatureCelsius) ? metar.temperatureCelsius : null,
      observedAt: finite(observedAt) ? new Date(observedAt).toISOString() : null,
      raw: typeof metar.raw === 'string' ? metar.raw : null,
      stale: response.status === 'Stale' || aged || !finite(observedAt),
      demo: demo === true,
      ...(barb === null ? {} : { barb }),
    };
    features.push({ type: 'Feature', id: icao, properties, geometry: { type: 'Point', coordinates: roundCoord(position, 6) } });
  }
  return { type: 'FeatureCollection', features };
}

/** The hazard of a SIGMET as the map tells them apart (SIGMET_HAZARDS): «CONVECTIVE» and «TSGR» are thunderstorms. */
export function sigmetHazardOf(hazard) {
  const word = typeof hazard === 'string' ? hazard.trim().toUpperCase() : '';
  if (word === '') return 'OTHER';
  if (word.startsWith('TS') || word === 'CONVECTIVE' || word.startsWith('CB')) return 'TS';
  if (word.startsWith('TC') || word === 'TROPICAL CYCLONE') return 'TC';
  if (word.startsWith('TURB')) return 'TURB';
  if (word.startsWith('ICE') || word.startsWith('ICING')) return 'ICE';
  if (word.startsWith('MTW') || word.startsWith('MTN')) return 'MTW';
  if (word === 'VA' || word.includes('ASH')) return 'VA';
  if (word === 'DS' || word === 'SS' || word.includes('DUST') || word.includes('SAND')) return 'DS';
  return 'OTHER';
}

// «FL250-FL450», «Hasta FL450», «Desde FL250» or nothing: the levels of a SIGMET (map labels keep to Latin-1).
function levelWords(baseFeet, topFeet, t) {
  const level = feet => `FL${String(Math.round(feet / 100)).padStart(3, '0')}`;
  const base = finite(baseFeet) && baseFeet > 0 ? level(baseFeet) : null;
  const top = finite(topFeet) && topFeet > 0 ? level(topFeet) : null;
  if (base && top) return `${base}-${top}`;
  if (top) return t('weather.sigmet.top', { level: top });
  if (base) return t('weather.sigmet.base', { level: base });
  return null;
}

// A closed ring of [lon, lat] from a SIGMET's polygon, or null when it has fewer than three corners.
function ringOf(polygon) {
  if (!Array.isArray(polygon)) return null;
  const points = polygon.filter(isPosition).map(point => roundCoord([point[0], point[1]], 5));
  if (points.length > 1) {
    const [first, last] = [points[0], points.at(-1)];
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  if (points.length < 3) return null;
  return [...points, points[0]];
}

/**
 * The data of the SIGMETs from an answer of GET occ/weather/sigmet (OccSigmetsResponse): a polygon for each one with a
 * polygon of three corners or more that is in force at `nowMs` (any not yet over, without an instant), when the answer
 * is Live or Stale. Each carries `kind: 'sigmet'`, `id`, `firId`, `hazard` (sigmetHazardOf), `hazardRaw`, `qualifier`,
 * `label` («SIGMET Tormentas» and its levels on a second line), `validFrom`, `validTo`, `baseFeet`, `topFeet`, `raw`
 * and `demo`.
 */
export function sigmetFeatures(response, { nowMs = null, demo = false, language = 'es' } = {}) {
  if (!WITH_METAR.has(response?.status) || !Array.isArray(response?.sigmets)) return emptyCollection();
  const t = createTranslator(mapMessages, language);
  const features = [];
  for (const [position, sigmet] of response.sigmets.entries()) {
    const ring = ringOf(sigmet?.polygon);
    const validFrom = Date.parse(sigmet?.validFrom ?? '');
    const validTo = Date.parse(sigmet?.validTo ?? '');
    if (ring === null || !finite(validTo)) continue;
    if (finite(nowMs) && (validTo <= nowMs || (finite(validFrom) && validFrom > nowMs))) continue;
    const hazard = sigmetHazardOf(sigmet.hazard);
    const levels = levelWords(sigmet.baseFeet, sigmet.topFeet, t);
    const name = t('weather.sigmet.name', { hazard: t(`weather.sigmet.hazard.${hazard}`) });
    const id = typeof sigmet.id === 'string' && sigmet.id !== '' ? sigmet.id : `sigmet-${position}`;
    features.push({
      type: 'Feature',
      id,
      properties: {
        kind: 'sigmet', id, firId: sigmet.firId ?? null, hazard, hazardRaw: sigmet.hazard ?? null,
        qualifier: sigmet.qualifier ?? null, label: levels === null ? name : `${name}\n${levels}`,
        validFrom: finite(validFrom) ? new Date(validFrom).toISOString() : null, validTo: new Date(validTo).toISOString(),
        baseFeet: finite(sigmet.baseFeet) ? sigmet.baseFeet : null, topFeet: finite(sigmet.topFeet) ? sigmet.topFeet : null,
        raw: typeof sigmet.raw === 'string' ? sigmet.raw : null, demo: demo === true,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The regional reads a map makes now: `{ loop, radar, stations, sigmet }`, each true while the map draws the regional
 * weather, the layers menu shows its key and the map is in Región or Aproximación (the hook of the regional weather
 * reads only what is wanted).
 */
export function wantedRegional({ groups, view, drawsRegional = true } = {}) {
  const inView = RASTER_VIEWS.includes(view);
  return Object.freeze(Object.fromEntries(REGIONAL_KEYS.map(key => [key,
    Boolean(drawsRegional) && inView && groups?.[WEATHER_GROUPS[key]] === true])));
}

/** «De las 14:00 a las 14:50»: the span of a loop at the station (`{ from, time }`), or null without its times. */
export function loopSpanWords(image, language = 'es') {
  const from = Date.parse(image?.from ?? '');
  const to = Date.parse(image?.time ?? '');
  if (!finite(from) || !finite(to)) return null;
  const t = createTranslator(mapMessages, language);
  const locale = localeFor(language);
  return t('legend.weather.span', { from: stationTime(from, locale), to: stationTime(to, locale) });
}

// Why a regional read shows nothing (mapMessages weather.regional), or null while it has an answer to draw.
function regionalStateWords(read, t) {
  if (read?.status === 'unauthorized') return t('weather.regional.forbidden');
  if (read?.status === 'error') return t('weather.regional.error');
  if (read?.data?.status === 'Disabled') return t('weather.regional.disabled');
  if (read?.data?.status === 'Unavailable' || read?.status === 'empty') return t('weather.regional.unavailable');
  if (!WITH_METAR.has(read?.data?.status)) return t('weather.regional.loading');
  return null;
}

/**
 * What the layers menu says under a regional key that is on (lane M7, through weatherLayerNotes). `regional` is what
 * the map holds of the regional weather: `loop` (`{ status: 'loading' | 'ready' | 'unavailable', band, frames }`, the
 * frames it pinned) and `radar`, `stations` and `sigmet`, each a read as the regional hook answers it (`{ status, data }`,
 * `data` the API's answer). Outside Región and Aproximación a key says where it is seen; else the state of its read, the
 * span of a loop, or that the region has nothing to show (no station reporting, no SIGMET in force).
 */
function regionalLayerNotes({ layers, view, regional, nowMs, t, language }) {
  const notes = {};
  for (const key of REGIONAL_KEYS) {
    const group = WEATHER_GROUPS[key];
    if (layers?.[group] !== true) continue;
    if (!RASTER_VIEWS.includes(view)) {
      notes[group] = t('layers.note.views', { first: viewName('region', language), second: viewName('approach', language) });
      continue;
    }
    if (key === 'loop') {
      const loop = regional?.loop;
      if (loop?.status === 'ready' && Array.isArray(loop.frames) && loop.frames.length > 0) {
        notes[group] = loopSpanWords({ from: loop.frames[0].time, time: loop.frames.at(-1).time }, language);
      } else notes[group] = t(loop?.status === 'unavailable' ? 'layers.note.noImage' : 'layers.note.loadingImage');
      continue;
    }
    const read = regional?.[key];
    const state = regionalStateWords(read, t);
    if (state !== null) {
      notes[group] = state;
    } else if (key === 'radar') {
      const frames = radarFrames(read.data);
      notes[group] = frames.length === 0 ? t('layers.note.noRadar')
        : loopSpanWords({ from: frames[0].time, time: frames.at(-1).time }, language);
    } else if (key === 'stations') {
      if (stationFeatures(read.data, { nowMs }).features.length === 0) notes[group] = t('layers.note.noStations');
    } else if (sigmetFeatures(read.data, { nowMs, language }).features.length === 0) {
      notes[group] = t('layers.note.noSigmet');
    }
  }
  return notes;
}
