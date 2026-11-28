// Imagen infrarroja GOES-East (banda 13) de NASA GIBS: CC0, sin clave y con CORS abierto.
// Resolución regional (~2 km, nivel 6 de teselas). GIBS publica la hora real de la imagen en
// la cabecera `Layer-Time-Actual`; se lee de la tesela que cubre PUJ.
const GIBS_LAYER = 'GOES-East_ABI_Band13_Clean_Infrared';
export const GOES_TILE_TEMPLATE = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
export const IMERG_TILE_TEMPLATE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png';
export const SATELLITE_LAYERS = { goes: GOES_TILE_TEMPLATE, imerg: IMERG_TILE_TEMPLATE };
export const SATELLITE_OPACITY = { goes: 0.7, imerg: 0.82 };
const REQUEST_TIMEOUT_MS = 15_000;

export function satelliteTileAt(layer, time) {
  const template = SATELLITE_LAYERS[layer];
  if (!template || !time || !/^(?:\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(time)) return null;
  return template.replace('/default/default/', `/default/${time}/`);
}

function pujTile(template) {
  return template.replace('{z}', '6').replace('{y}', '28').replace('{x}', '19');
}

export function imageAgeMinutes(imageTime, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(imageTime ?? '') ||
    Number.isNaN(Date.parse(imageTime))) return null;
  return Math.max(0, Math.floor((now - Date.parse(imageTime)) / 60_000));
}

export async function loadSatelliteImageInfo(layer, { signal } = {}) {
  const template = SATELLITE_LAYERS[layer];
  if (!template) throw new Error('unknown-satellite-layer');
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(pujTile(template), { signal: combined, credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('satellite-unavailable');
  const value = response.headers.get('layer-time-actual')?.trim() ?? '';
  const precision = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'day'
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ? 'instant' : null;
  return precision && !Number.isNaN(Date.parse(value))
    ? { time: value, precision, tileTemplate: satelliteTileAt(layer, value) }
    : null;
}

export async function loadSatelliteImageTime(layer, options) {
  return (await loadSatelliteImageInfo(layer, options))?.time ?? null;
}

export async function loadGoesImageTime({ signal } = {}) {
  return loadSatelliteImageTime('goes', { signal });
}

export async function loadImergImageTime({ signal } = {}) {
  return loadSatelliteImageTime('imerg', { signal });
}

// The images of a GOES-East layer GIBS really has (the satellite loop of lane M7, hotfix of 2026-11-28): its
// DescribeDomains names them for a window of time, as periods `start/end/PTnM` and single instants separated by commas.
// GeoColor lags the infrared by about half an hour and has holes, so the loop asks each band for its own list.
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GIBS_LAYER_NAME = /^[A-Za-z0-9_]+$/;
const GIBS_MATRIX = /^GoogleMapsCompatible_Level\d{1,2}$/;
const GIBS_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const GIBS_PERIOD = /^PT(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
const DOMAIN_ELEMENT = /<(?:[A-Za-z][\w.-]*:)?Domain>([^<]*)<\/(?:[A-Za-z][\w.-]*:)?Domain>/;
/** The most instants a domain may name; past it only the latest are kept. */
export const MAX_DOMAIN_INSTANTS = 200;
// The most instants one period may expand into before the answer is taken as malformed.
const MAX_PERIOD_STEPS = 10_000;
const MIN_PERIOD_MS = 60_000;

const instantOf = ms => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const parseInstant = value => (GIBS_INSTANT.test(value) ? Date.parse(value) : Number.NaN);
// A whole minute, as the window's ends are written.
const minuteInstant = ms => `${new Date(Math.ceil(ms / 60_000) * 60_000).toISOString().slice(0, 16)}:00Z`;

function periodMs(value) {
  const match = GIBS_PERIOD.exec(value);
  if (!match) return Number.NaN;
  const [hours, minutes, seconds] = match.slice(1).map(part => Number(part ?? 0));
  const ms = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return ms >= MIN_PERIOD_MS ? ms : Number.NaN;
}

/**
 * The instants of the `<Domain>` of a GIBS DescribeDomains answer (`xml`), sorted and unique, as GIBS instants
 * (`2026-11-28T16:20:00Z`): each comma-separated entry is a period `start/end/PTnM` (every step from start to end) or a
 * single instant. `fromMs`/`toMs` keep only the instants inside the window; at most `max`, the latest. A missing or
 * malformed domain answers null (unknown), never an exception; an empty one answers no instants.
 */
export function parseGibsDomain(xml, { fromMs = Number.NEGATIVE_INFINITY, toMs = Number.POSITIVE_INFINITY,
  max = MAX_DOMAIN_INSTANTS } = {}) {
  if (typeof xml !== 'string') return null;
  const match = DOMAIN_ELEMENT.exec(xml);
  if (!match) return null;
  const text = match[1].trim();
  if (text === '') return Object.freeze([]);
  const instants = new Set();
  const keep = ms => { if (ms >= fromMs && ms <= toMs) instants.add(ms); };
  for (const entry of text.split(',').map(part => part.trim())) {
    const parts = entry.split('/');
    if (parts.length === 1) {
      const at = parseInstant(parts[0]);
      if (!Number.isFinite(at)) return null;
      keep(at);
      continue;
    }
    if (parts.length !== 3) return null;
    const start = parseInstant(parts[0]);
    const end = parseInstant(parts[1]);
    const step = periodMs(parts[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || end < start) return null;
    // Only the steps inside the window are walked: a period that began long before it costs nothing.
    const first = Math.max(0, Math.ceil((fromMs - start) / step));
    const last = Math.floor((Math.min(end, toMs) - start) / step);
    if (last - first > MAX_PERIOD_STEPS) return null;
    for (let index = first; index <= last; index += 1) keep(start + index * step);
  }
  const sorted = [...instants].sort((a, b) => a - b);
  return Object.freeze(sorted.slice(-Math.max(0, max)).map(instantOf));
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function checkLayer(layer, matrix) {
  if (!GIBS_LAYER_NAME.test(layer ?? '') || !GIBS_MATRIX.test(matrix ?? '')) throw new Error('unknown-satellite-layer');
}

/** The DescribeDomains URL of a GIBS `layer` in `matrix` for the window `fromMs`–`toMs`, both on the whole minute. */
export function gibsDomainUrl(layer, matrix, fromMs, toMs) {
  checkLayer(layer, matrix);
  return `${GIBS_WMTS}/1.0.0/${layer}/default/${matrix}/all/${minuteInstant(fromMs)}--${minuteInstant(toMs)}.xml`;
}

/**
 * The instants GIBS has of `layer` (in `matrix`) between `fromMs` and `toMs`, read from its DescribeDomains with the
 * timeout and the cancellation of the header read: sorted GIBS instants, an empty list when it has none, or null when
 * the answer cannot be read. A failed request throws, as loadSatelliteImageInfo does.
 */
export async function loadGibsDomain({ layer, matrix, fromMs, toMs, signal } = {}) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) throw new Error('invalid-satellite-window');
  const response = await fetch(gibsDomainUrl(layer, matrix, fromMs, toMs),
    { signal: requestSignal(signal), credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('satellite-unavailable');
  return parseGibsDomain(await response.text(), { fromMs, toMs });
}

/**
 * The time of the latest image of a GIBS `layer` (in `matrix`) as its `Layer-Time-Actual` header names it on the tile
 * over PUJ (level 6), or null without a GIBS instant there: the fallback of the loop when the domain cannot be read.
 */
export async function loadGibsLatestTime({ layer, matrix, signal } = {}) {
  checkLayer(layer, matrix);
  const response = await fetch(pujTile(`${GIBS_WMTS}/${layer}/default/default/${matrix}/{z}/{y}/{x}.png`),
    { signal: requestSignal(signal), credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('satellite-unavailable');
  const value = response.headers.get('layer-time-actual')?.trim() ?? '';
  return Number.isFinite(parseInstant(value)) ? value : null;
}
