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
import { WIND_MAX_AGE_MINUTES } from './referenceFeatures';
import { staleWords, stationTime } from './stationTime';

// The weather on the one canvas of the OCC maps (design E6, PR M8; contracts 2.3: weather is a layer, not a view), the
// one owner of its sources, layers and features:
// - the GOES-East infrared clouds and the IMERG rain of NASA GIBS, which GoesCloudMap.jsx drew on a map of its own: two
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

export const SATELLITE_KEYS = Object.freeze(['goes', 'imerg']);
/** The raster sources of the satellite images. */
export const SATELLITE_SOURCES = Object.freeze({ goes: 'occ-weather-goes', imerg: 'occ-weather-imerg' });
/** Their layers. */
export const SATELLITE_LAYER_IDS = Object.freeze({ goes: 'occ-weather-goes-image', imerg: 'occ-weather-imerg-image' });
/** The source of the wind. */
export const WIND_SOURCE = 'occ-weather-wind';
/** The layers-menu keys of the weather (design E7), each the `occ:group` of its layers. */
export const WEATHER_GROUPS = Object.freeze({ goes: 'weather.goes', imerg: 'weather.imerg', wind: 'weather.wind' });
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
export const WEATHER_LEGEND_KINDS = Object.freeze(['wind', 'windStale', 'goes', 'imerg']);

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
 * wind picks the kind `wind`.
 */
export function weatherOverlay() {
  return {
    sources: {
      [SATELLITE_SOURCES.goes]: rasterSource('goes'),
      [SATELLITE_SOURCES.imerg]: rasterSource('imerg'),
      [WIND_SOURCE]: { type: 'geojson' },
    },
    layers: [
      rasterLayer('goes'),
      rasterLayer('imerg'),
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
 */
export function weatherOnScreen({ wind = [], rasters = {}, imagery = null } = {}) {
  const drawn = (Array.isArray(wind) ? wind : []).map(item => item?.properties).filter(item => item?.kind === 'wind');
  const kinds = drawn.length === 0 ? [] : [drawn.some(item => item.stale === true) ? 'windStale' : 'wind'];
  const images = {};
  for (const key of SATELLITE_KEYS) {
    const info = imagery?.[key];
    if (rasters?.[key] !== true || !isImageReady(key, info)) continue;
    kinds.push(key);
    images[key] = Object.freeze({ time: info.time, precision: info.precision ?? 'instant' });
  }
  return Object.freeze({ kinds: Object.freeze(kinds), imagery: Object.freeze(images) });
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
export function weatherLayerNotes({ layers = {}, view = null, imagery = null, weather = null, nowMs = null,
  language = 'es' } = {}) {
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
  return Object.freeze(notes);
}
