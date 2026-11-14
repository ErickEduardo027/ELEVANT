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
