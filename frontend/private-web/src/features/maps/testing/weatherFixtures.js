import { TRAFFIC_NOON, TRAFFIC_STATION_ID } from './trafficFixtures';

// Synthetic answers of the aerodrome weather read, GET occ/weather (contracts 1.4, ADR-0043), for Punta Cana at the
// map lab's noon: the shape of the API with an invented METAR and an invented TAF. Nothing here comes from
// aviationweather.gov. The tests and the map lab read them; the services never import this module.
//
// The METAR is the one of a fair afternoon (wind 100° 13 kt, 10 km, scattered clouds at 2 000 ft, 29 °C, QNH 1015).
// The TAF, valid from 12:00Z on the 13th to 12:00Z on the 14th, has its base period, a TEMPO of showers from 16:00Z to
// 20:00Z, a change (FM) at 22:00Z and a 30 % chance of thunderstorms from 04:00Z to 08:00Z.

export const WEATHER_NOON = TRAFFIC_NOON;
export const WEATHER_STATION_ID = TRAFFIC_STATION_ID;
const NOON_MS = Date.parse(WEATHER_NOON);

/** The instant `minutes` after the map lab's noon, as the API writes it. */
export const weatherInstant = minutes => new Date(NOON_MS + minutes * 60_000).toISOString();

/** The credit the API always sends with the weather. */
export const WEATHER_CREDIT = Object.freeze({
  name: 'NOAA Aviation Weather Center',
  homeUrl: 'https://aviationweather.gov',
});

/** When each state's METAR was observed: Live ten minutes before noon (14:50Z), Stale three hours before (12:00Z). */
export const WEATHER_OBSERVED_AT = Object.freeze({ Live: weatherInstant(-10), Stale: weatherInstant(-180) });

/** When the server last heard from the weather service: three minutes before noon. */
export const WEATHER_RETRIEVED_AT = weatherInstant(-3);

/** The wind of the METAR, where it blows from, in degrees true and knots. */
export const WEATHER_WIND = Object.freeze({ directionDeg: 100, speedKt: 13, gustKt: null, variable: false });

/** The raw TAF; its groups are the four periods of createTaf(). */
export const WEATHER_TAF_RAW = 'TAF MDPC 131100Z 1312/1412 09012KT 9999 FEW020 SCT040 TEMPO 1316/1320 10015G25KT 4000 '
  + 'SHRA BKN015 FM132200 07008KT 9999 FEW020 PROB30 1404/1408 3000 TSRA BKN012CB';

const pad = (value, length) => String(value).padStart(length, '0');

/** «100° 13 kt» as the report writes it: «10013KT», «VRB03KT», «09015G25KT», «00000KT». */
function windGroup({ directionDeg, speedKt, gustKt, variable }) {
  const direction = variable ? 'VRB' : pad(directionDeg ?? 0, 3);
  return `${direction}${pad(speedKt ?? 0, 2)}${gustKt ? `G${pad(gustKt, 2)}` : ''}KT`;
}

/** «131450»: the day, hour and minute of an instant in UTC. */
function dayTime(instant) {
  const date = new Date(instant);
  return `${pad(date.getUTCDate(), 2)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}`;
}

const cloudLayers = layers => layers.map(([cover, baseFeet]) => ({ cover, baseFeet }));

/** The METAR the API decodes: its raw text and the basics, with every key the contract has. */
export function createMetar({ observedAt = WEATHER_OBSERVED_AT.Live, wind = WEATHER_WIND, raw } = {}) {
  const blowing = { ...WEATHER_WIND, ...wind };
  return {
    raw: raw ?? `MDPC ${dayTime(observedAt)}Z ${windGroup(blowing)} 9999 SCT020 29/22 Q1015`,
    observedAt,
    flightCategory: 'VFR',
    windDirectionDegrees: blowing.variable ? null : blowing.directionDeg,
    windVariable: blowing.variable,
    windSpeedKnots: blowing.speedKt,
    windGustKnots: blowing.gustKt,
    // «9999»: the service writes ten kilometres or more as 6 statute miles («6+»).
    visibilityStatuteMiles: 6,
    temperatureCelsius: 29,
    dewpointCelsius: 22,
    altimeterHectopascals: 1015,
    weather: null,
    clouds: cloudLayers([['SCT', 2000]]),
  };
}

/** One TAF period as the API sends it; `from` and `to` in minutes after noon, `wind` as [direction, speed, gust]. */
function period({ from, to, change = null, probabilityPercent = null, wind = [], visibility = null, weather = null,
  clouds = [] }) {
  const [directionDeg = null, speedKt = null, gustKt = null] = wind;
  return {
    from: weatherInstant(from),
    to: weatherInstant(to),
    change,
    probabilityPercent,
    windDirectionDegrees: directionDeg,
    windVariable: false,
    windSpeedKnots: speedKt,
    windGustKnots: gustKt,
    visibilityStatuteMiles: visibility,
    weather,
    clouds: cloudLayers(clouds),
  };
}

/** The TAF the API sends: issued at 11:00Z, valid 1312/1412, with its raw text and its four periods in order. */
export function createTaf() {
  return {
    raw: WEATHER_TAF_RAW,
    issuedAt: weatherInstant(-240),
    validFrom: weatherInstant(-180),
    validTo: weatherInstant(1260),
    periods: [
      period({ from: -180, to: 420, wind: [90, 12], visibility: 6, clouds: [['FEW', 2000], ['SCT', 4000]] }),
      period({ from: 60, to: 300, change: 'TEMPO', wind: [100, 15, 25], visibility: 2.49, weather: 'SHRA',
        clouds: [['BKN', 1500]] }),
      period({ from: 420, to: 1260, change: 'FM', wind: [70, 8], visibility: 6, clouds: [['FEW', 2000]] }),
      period({ from: 780, to: 1020, change: 'PROB', probabilityPercent: 30, visibility: 1.86, weather: 'TSRA',
        clouds: [['BKN', 1200]] }),
    ],
  };
}

const HAS_METAR = new Set(['Live', 'Stale']);

/**
 * A whole answer of GET occ/weather for the lab's station at noon, in one of its four states: Live (a METAR observed
 * at 14:50Z), Stale (one observed at 12:00Z), Unavailable (no METAR, the TAF still there) and Disabled (no METAR, no
 * TAF and never retrieved). `observedAt`, `wind` and `raw` change the METAR (`raw` replaces its text as given); `taf`
 * replaces the TAF (null for none); `retrievedAt` the last time the service answered. Every answer passes
 * isOccAerodromeWeather.
 */
export function createAerodromeWeather({ status = 'Live', observedAt, raw, wind, taf, retrievedAt,
  serverTime = WEATHER_NOON } = {}) {
  const disabled = status === 'Disabled';
  return {
    stationId: WEATHER_STATION_ID,
    icaoCode: 'MDPC',
    status,
    serverTime,
    retrievedAt: disabled ? null : (retrievedAt === undefined ? WEATHER_RETRIEVED_AT : retrievedAt),
    source: { ...WEATHER_CREDIT },
    metar: HAS_METAR.has(status)
      ? createMetar({ observedAt: observedAt ?? WEATHER_OBSERVED_AT[status], wind, raw })
      : null,
    taf: disabled ? null : (taf === undefined ? createTaf() : taf),
  };
}

/** The scenario of the simulated weather adapter (services/weatherService.js): one answer written at noon. */
export function createWeatherScenario(options = {}) {
  return { at: WEATHER_NOON, weather: createAerodromeWeather(options), failure: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The regional weather (lane M7): synthetic answers of GET occ/weather/region, occ/weather/sigmet, occ/weather/wind and
// occ/weather/radar in the shapes lane M6 builds (OccRegionWeatherResponse, OccSigmetsResponse, OccWindGridResponse,
// OccRadarFramesResponse), at the lab's noon. Invented reports at the real positions of six airports of
// region.context.json; nothing comes from aviationweather.gov, Open-Meteo, RainViewer or IEM.

/** The credit of the regional reads. */
export const REGION_CREDIT = Object.freeze({ name: 'NOAA Aviation Weather Center', url: 'https://aviationweather.gov' });

// One station's METAR with the fields of the contract; `wind` as [direction, speed, gust].
function regionMetar({ icao, category, wind = [100, 12, null], visibility = 6, ceiling = null, observedMinutes = -10,
  temperature = 28 }) {
  const [direction, speed, gust] = wind;
  const observedAt = weatherInstant(observedMinutes);
  const windText = direction === null
    ? `VRB${pad(speed, 2)}KT`
    : `${pad(direction, 3)}${pad(speed, 2)}${gust ? `G${pad(gust, 2)}` : ''}KT`;
  return {
    raw: `${icao} ${dayTime(observedAt)}Z ${windText} 9999 SCT020 ${temperature}/22 Q1014`,
    observedAt,
    windDirectionDegrees: direction,
    windSpeedKnots: speed,
    windGustKnots: gust,
    visibilityStatuteMiles: visibility,
    ceilingFeet: ceiling,
    flightCategory: category,
    temperatureCelsius: temperature,
    dewpointCelsius: 22,
    altimeterHectopascals: 1014,
  };
}

/**
 * The stations of the regional answer: MDPC VFR with the airfield's wind, MDSD MVFR, MDLR IFR in a shower, TJSJ LIFR in
 * a squall (gust 45 kt), MDST without a category and calm, and MDCY without a report (no METAR).
 */
export const REGION_STATIONS = Object.freeze([
  { icao: 'MDPC', iata: 'PUJ', name: 'Punta Cana', p: [-68.364558, 18.567093], metar: { category: 'VFR', wind: [100, 13, null] } },
  { icao: 'MDSD', iata: 'SDQ', name: 'Las Américas', p: [-69.6689, 18.429701], metar: { category: 'MVFR', wind: [120, 8, null], ceiling: 2500 } },
  { icao: 'MDLR', iata: 'LRM', name: 'La Romana', p: [-68.911111, 18.452222], metar: { category: 'IFR', wind: [90, 18, 28], visibility: 2, ceiling: 800 } },
  { icao: 'TJSJ', iata: 'SJU', name: 'San Juan', p: [-66.001801, 18.4394], metar: { category: 'LIFR', wind: [60, 35, 45], visibility: 0.5, ceiling: 300 } },
  { icao: 'MDST', iata: 'STI', name: 'Cibao', p: [-70.604431, 19.40406], metar: { category: null, wind: [0, 0, null] } },
  { icao: 'MDCY', iata: 'AZS', name: 'Samaná El Catey', p: [-69.737405, 19.269259], metar: null },
].map(entry => Object.freeze(entry)));

const regionStation = ({ icao, iata, name, p, metar }, observedMinutes) => ({
  icao,
  iata,
  name,
  latitude: p[1],
  longitude: p[0],
  metar: metar === null ? null : regionMetar({ icao, ...metar, observedMinutes }),
  taf: icao === 'MDPC'
    ? { raw: WEATHER_TAF_RAW, issuedAt: weatherInstant(-240), validFrom: weatherInstant(-180), validTo: weatherInstant(1260) }
    : null,
});

const WITH_REPORTS = new Set(['Live', 'Stale']);

// The envelope every regional answer has.
function envelope(status, { serverTime = WEATHER_NOON, refreshAfterSeconds = 300 } = {}) {
  let reason = null;
  if (status === 'Disabled') reason = 'disabled';
  else if (status !== 'Live') reason = 'upstream-unavailable';
  return {
    stationId: WEATHER_STATION_ID,
    status,
    reason,
    serverTime,
    refreshAfterSeconds,
    credit: { ...REGION_CREDIT },
  };
}

/**
 * An answer of GET occ/weather/region at noon in one of its four states: Live and Stale carry REGION_STATIONS (a Stale
 * one observed three hours before), Unavailable and Disabled none. `stations` replaces the list as given.
 */
export function createRegionWeather({ status = 'Live', stations, serverTime } = {}) {
  const observed = status === 'Stale' ? -180 : -10;
  return {
    ...envelope(status, { serverTime }),
    stations: stations ?? (WITH_REPORTS.has(status) ? REGION_STATIONS.map(station => regionStation(station, observed)) : []),
  };
}

/**
 * The SIGMETs of the region at noon: a convective one (TS, EMBD, up to FL450) north of Hispaniola in force from an
 * hour before to three hours after noon, a turbulence one already over, and a tropical cyclone that starts tomorrow.
 */
export function createSigmets({ status = 'Live', sigmets, serverTime } = {}) {
  const list = [
    {
      id: 'MDCS-SIGMET-A1', firId: 'MDCS', hazard: 'TS', qualifier: 'EMBD', validFrom: weatherInstant(-60),
      validTo: weatherInstant(180), baseFeet: null, topFeet: 45000,
      raw: 'MDCS SIGMET A1 VALID 131400/131800 MDSD- MDCS SANTO DOMINGO FIR EMBD TS OBS TOP FL450 MOV W 10KT NC',
      polygon: [[-70.5, 20.2], [-68.5, 20.4], [-68.2, 19.6], [-70.2, 19.4], [-70.5, 20.2]],
    },
    {
      id: 'TJZS-SIGMET-B2', firId: 'TJZS', hazard: 'TURB', qualifier: 'SEV', validFrom: weatherInstant(-360),
      validTo: weatherInstant(-60), baseFeet: 25000, topFeet: 39000, raw: 'TJZS SIGMET B2 SEV TURB FL250/390',
      polygon: [[-67, 19.5], [-65.5, 19.5], [-65.5, 18.8], [-67, 18.8]],
    },
    {
      id: 'MDCS-SIGMET-A2', firId: 'MDCS', hazard: 'TC', qualifier: null, validFrom: weatherInstant(1440),
      validTo: weatherInstant(1800), baseFeet: null, topFeet: null, raw: 'MDCS SIGMET A2 TC',
      polygon: [[-72, 17], [-70, 17], [-70, 16], [-72, 16]],
    },
  ];
  return {
    ...envelope(status, { serverTime, refreshAfterSeconds: 600 }),
    sigmets: sigmets ?? (WITH_REPORTS.has(status) ? list : []),
  };
}

/** A radar tile template of the fixtures for a frame time, on the IEM origin the CSP allows. */
export const radarTemplateAt = time => 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::TJUA-N0Q-'
  + `${time.replace(/\D/g, '').slice(0, 12)}/{z}/{x}/{y}.png`;

/**
 * An answer of GET occ/weather/radar at noon: `count` frames ten minutes apart, the latest five minutes before noon,
 * from IEM's TJUA (`provider` iem-tjua, max zoom 8). Unavailable and Disabled answers have no frames.
 */
export function createRadarFrames({ status = 'Live', count = 8, provider = 'iem-tjua', frames, serverTime } = {}) {
  const withFrames = WITH_REPORTS.has(status);
  const list = Array.from({ length: count }, (_, index) => {
    const time = weatherInstant(-5 - (count - 1 - index) * 10);
    return { time, tileUrlTemplate: radarTemplateAt(time) };
  });
  return {
    ...envelope(status, { serverTime, refreshAfterSeconds: 300 }),
    provider: withFrames ? provider : null,
    maxZoom: 8,
    frames: frames ?? (withFrames ? list : []),
  };
}

/** An answer of GET occ/weather/wind at noon: a 3 × 3 grid over the region, the trade wind from the east. */
export function createWindGrid({ status = 'Live', serverTime } = {}) {
  const [lonMin, lonMax, latMin, latMax] = [-72, -64, 16.5, 21.5];
  const points = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      points.push({
        latitude: latMin + (row * (latMax - latMin)) / 2,
        longitude: lonMin + (column * (lonMax - lonMin)) / 2,
        speedKnots: 12 + row * 2 + column,
        directionDegrees: 90 + column * 5,
      });
    }
  }
  return {
    ...envelope(status, { serverTime, refreshAfterSeconds: 3600 }),
    validAt: WEATHER_NOON,
    grid: WITH_REPORTS.has(status) ? { lonMin, lonMax, latMin, latMax, columns: 3, rows: 3, points } : null,
  };
}
