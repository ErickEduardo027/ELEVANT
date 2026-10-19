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
