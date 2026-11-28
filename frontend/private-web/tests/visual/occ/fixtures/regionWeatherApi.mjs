// Synthetic answers of the four regional weather reads of Panorama (lane M7 over lane M6's API: GET occ/weather/region,
// occ/weather/sigmets, occ/weather/wind and occ/weather/radar) for the OCC visual suite, written around `now`, the
// instant of each answer, so the console draws them as live. Invented reports at the real positions of a few airports
// of the region and invented SIGMETs; nothing comes from aviationweather.gov or IEM. The radar frames name IEM's tile
// template of TJUA pinned to their minute, which support/isolate.mjs answers with synthetic echoes. They pass the strict
// validators of @elevant/api-client (tests/visualConsoleFixtures.test.js checks them).

export const REGION_WEATHER_PATHS = Object.freeze({
  region: '/api/v1/occ/weather/region',
  sigmets: '/api/v1/occ/weather/sigmets',
  wind: '/api/v1/occ/weather/wind',
  radar: '/api/v1/occ/weather/radar',
});

const CREDIT = Object.freeze({ name: 'NOAA Aviation Weather Center', url: 'https://aviationweather.gov' });
const at = (now, minutes) => new Date(now + minutes * 60_000).toISOString();
const pad = (value, length) => String(value).padStart(length, '0');
const dayTime = instant => {
  const date = new Date(instant);
  return `${pad(date.getUTCDate(), 2)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}`;
};

const envelope = ({ now, stationId, refreshAfterSeconds }) => ({
  stationId, status: 'Live', reason: null, serverTime: at(now, 0), refreshAfterSeconds, credit: { ...CREDIT },
});

// [icao, iata, name, longitude, latitude, category, [direction, speed, gust], visibility, ceiling]
const STATIONS = Object.freeze([
  ['MDPC', 'PUJ', 'Punta Cana', -68.364558, 18.567093, 'VFR', [100, 13, null], 6, null],
  ['MDSD', 'SDQ', 'Las Américas', -69.6689, 18.429701, 'MVFR', [120, 8, null], 6, 2500],
  ['MDLR', 'LRM', 'La Romana', -68.911111, 18.452222, 'IFR', [90, 18, 28], 2, 800],
  ['TJSJ', 'SJU', 'San Juan', -66.001801, 18.4394, 'LIFR', [60, 35, 45], 0.5, 300],
  ['MDST', 'STI', 'Cibao', -70.604431, 19.40406, 'VFR', [80, 6, null], 6, null],
]);

/** GET occ/weather/region: the METARs of the region's airports, and MDPC's TAF, observed ten minutes before `now`. */
export function regionWeather({ now = Date.now(), stationId }) {
  const observedAt = at(now, -10);
  const stations = STATIONS.map(([icao, iata, name, longitude, latitude, category, wind, visibility, ceiling]) => {
    const [direction, speed, gust] = wind;
    return {
      icao, iata, name, latitude, longitude,
      metar: {
        raw: `${icao} ${dayTime(observedAt)}Z ${pad(direction, 3)}${pad(speed, 2)}${gust ? `G${pad(gust, 2)}` : ''}KT `
          + '9999 SCT020 28/22 Q1014',
        observedAt,
        windDirectionDegrees: direction,
        windSpeedKnots: speed,
        windGustKnots: gust,
        visibilityStatuteMiles: visibility,
        ceilingFeet: ceiling,
        flightCategory: category,
        temperatureCelsius: 28,
        dewpointCelsius: 22,
        altimeterHectopascals: 1014,
      },
      taf: icao === 'MDPC'
        ? { raw: `TAF MDPC ${dayTime(at(now, -60))}Z 09012KT 9999 FEW020 SCT040 TEMPO 10015G25KT 4000 SHRA`,
          issuedAt: at(now, -60), validFrom: at(now, -60), validTo: at(now, 1380) }
        : null,
    };
  });
  return { ...envelope({ now, stationId, refreshAfterSeconds: 300 }), stations };
}

/** GET occ/weather/sigmets: an embedded thunderstorm north of Hispaniola in force now, and a severe turbulence one. */
export function sigmets({ now = Date.now(), stationId }) {
  return {
    ...envelope({ now, stationId, refreshAfterSeconds: 600 }),
    sigmets: [
      {
        id: 'MDCS-SIGMET-A1', firId: 'MDCS', hazard: 'TS', qualifier: 'EMBD', validFrom: at(now, -60), validTo: at(now, 180),
        baseFeet: null, topFeet: 45000,
        raw: 'MDCS SIGMET A1 MDSD- MDCS SANTO DOMINGO FIR EMBD TS OBS TOP FL450 MOV W 10KT NC',
        polygon: [[-70.5, 20.2], [-68.5, 20.4], [-68.2, 19.6], [-70.2, 19.4], [-70.5, 20.2]],
      },
      {
        id: 'TJZS-SIGMET-B2', firId: 'TJZS', hazard: 'TURB', qualifier: 'SEV', validFrom: at(now, -30), validTo: at(now, 210),
        baseFeet: 25000, topFeet: 39000, raw: 'TJZS SIGMET B2 SEV TURB FL250/390',
        polygon: [[-67, 19.5], [-65.5, 19.5], [-65.5, 18.8], [-67, 18.8], [-67, 19.5]],
      },
    ],
  };
}

/** GET occ/weather/wind: a 3 × 3 grid of the trade wind from the east over the region. */
export function windGrid({ now = Date.now(), stationId }) {
  const [lonMin, lonMax, latMin, latMax] = [-72, -64, 16.5, 21.5];
  const points = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      points.push({ latitude: latMin + (row * (latMax - latMin)) / 2, longitude: lonMin + (column * (lonMax - lonMin)) / 2,
        speedKnots: 12 + row * 2 + column, directionDegrees: 90 + column * 5 });
    }
  }
  return {
    ...envelope({ now, stationId, refreshAfterSeconds: 3600 }),
    validAt: at(now, 0),
    grid: { lonMin, lonMax, latMin, latMax, columns: 3, rows: 3, points },
  };
}

/** The tile template of IEM's TJUA N0B scan of the minute of `time`, as the API writes it. */
export const radarTemplateAt = time => 'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-'
  + `${time.replace(/\D/g, '').slice(0, 12)}/{z}/{x}/{y}.png`;

/** GET occ/weather/radar: eight frames of TJUA ten minutes apart, the latest five minutes before `now`. */
export function radarFrames({ now = Date.now(), stationId }) {
  // Whole minutes, as IEM names its frames.
  const minute = Math.floor(now / 60_000) * 60_000;
  const frames = Array.from({ length: 8 }, (_, index) => {
    const time = at(minute, -5 - (7 - index) * 10);
    return { time, tileUrlTemplate: radarTemplateAt(time) };
  });
  return { ...envelope({ now, stationId, refreshAfterSeconds: 300 }), provider: 'iem-tjua', maxZoom: 10, frames };
}

/** The answer of a regional read at `pathname`, or `null` when the path is not one of them. */
export function regionWeatherAnswer(pathname, { now, stationId }) {
  switch (pathname) {
    case REGION_WEATHER_PATHS.region: return regionWeather({ now, stationId });
    case REGION_WEATHER_PATHS.sigmets: return sigmets({ now, stationId });
    case REGION_WEATHER_PATHS.wind: return windGrid({ now, stationId });
    case REGION_WEATHER_PATHS.radar: return radarFrames({ now, stationId });
    default: return null;
  }
}
