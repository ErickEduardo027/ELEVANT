import { parseMetar } from '../features/weather/metar';

// Observación meteorológica de Punta Cana (OACI MDPC) servida por Iowa Environmental
// Mesonet: dominio público, sin clave y con CORS abierto. Es una réplica no oficial del
// METAR, sin garantía de exactitud ni SLA; la fuente oficial (NOAA AWC) no admite llamadas
// desde el navegador y queda pendiente de un proxy de backend.
export const WEATHER_STATION = 'MDPC';
export const WEATHER_SOURCE = {
  name: 'Iowa Environmental Mesonet',
  url: 'https://mesonet.agron.iastate.edu/sites/site.php?station=MDPC&network=DO__ASOS',
  official: false,
};

const IEM_ORIGIN = 'https://mesonet.agron.iastate.edu';
const REQUEST_TIMEOUT_MS = 15_000;

export class WeatherUnavailableError extends Error {
  constructor(reason) {
    super(`weather-${reason}`);
    this.name = 'WeatherUnavailableError';
    this.reason = reason;
  }
}

async function fetchFromIem(path, { signal } = {}) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(`${IEM_ORIGIN}${path}`, { signal: combined, credentials: 'omit', cache: 'no-store' });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WeatherUnavailableError(timeout.aborted ? 'timeout' : 'network');
  }
  if (!response.ok) throw new WeatherUnavailableError('http');
  return response;
}

function fahrenheitToCelsius(value) {
  return Number.isFinite(value) ? Math.round(((value - 32) * 5) / 9) : null;
}

export async function loadCurrentObservation({ signal } = {}) {
  const response = await fetchFromIem(`/api/1/currents.json?station=${WEATHER_STATION}`, { signal });
  const body = await response.json().catch(() => null);
  const row = Array.isArray(body?.data) ? body.data.find(item => item?.station === WEATHER_STATION) : null;
  const observedAt = row?.utc_valid && !Number.isNaN(Date.parse(row.utc_valid)) ? row.utc_valid : null;
  if (!row || !observedAt || typeof row.raw !== 'string' || !row.raw.trim()) {
    throw new WeatherUnavailableError('empty');
  }
  return {
    station: WEATHER_STATION,
    observedAt,
    metar: parseMetar(row.raw),
    // Valores derivados por IEM a partir del mismo reporte; se etiquetan como tales.
    derived: {
      relativeHumidity: Number.isFinite(row.relh) && row.relh >= 0 && row.relh <= 100 ? Math.round(row.relh) : null,
      feelsLikeC: fahrenheitToCelsius(row.feel),
      precipitationLastHourIn: Number.isFinite(row.phour) && row.phour >= 0 ? row.phour : null,
    },
    source: WEATHER_SOURCE,
  };
}

export async function loadRecentMetars({ hours = 3, signal } = {}) {
  const query = new URLSearchParams({ station: WEATHER_STATION, data: 'metar', hours: String(hours),
    format: 'onlycomma', tz: 'UTC' });
  const response = await fetchFromIem(`/cgi-bin/request/asos.py?${query}`, { signal });
  const lines = (await response.text()).trim().split(/\r?\n/);
  if (lines[0] !== 'station,valid,metar') throw new WeatherUnavailableError('format');
  return lines.slice(1).map(line => {
    const [station, valid, ...rest] = line.split(',');
    const raw = rest.join(',');
    return { station, observedAt: `${valid.replace(' ', 'T')}:00Z`, metar: parseMetar(raw) };
  }).filter(item => item.station === WEATHER_STATION && !Number.isNaN(Date.parse(item.observedAt)))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
}
