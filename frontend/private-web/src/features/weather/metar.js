// Decodificador de los grupos principales de un METAR (OMM / OACI Anexo 3).
// Solo traduce lo que el reporte contiene; no calcula categorías de vuelo ni
// umbrales operacionales. Lo que no reconoce se conserva en `unparsed`.
const CLOUD_COVER = new Set(['FEW', 'SCT', 'BKN', 'OVC', 'VV']);
const NO_CLOUD = new Set(['NSC', 'NCD', 'SKC', 'CLR']);
const TREND_MARKERS = new Set(['NOSIG', 'BECMG', 'TEMPO', 'RMK']);
const WEATHER = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/;

function signedTemperature(value) {
  return value.startsWith('M') ? -Number(value.slice(1)) : Number(value);
}

export function parseMetar(raw) {
  const text = String(raw ?? '').trim().replace(/=$/, '');
  const tokens = text.split(/\s+/).filter(Boolean);
  const result = {
    raw: text, station: null, day: null, time: null, auto: false,
    wind: null, visibility: null, weather: [], clouds: [], cavok: false,
    temperatureC: null, dewPointC: null, qnhHpa: null, altimeterInHg: null,
    trend: null, unparsed: [],
  };
  let index = 0;
  if (tokens[index] === 'METAR' || tokens[index] === 'SPECI') index += 1;
  if (/^[A-Z]{4}$/.test(tokens[index] ?? '')) result.station = tokens[index++];
  const time = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[index] ?? '');
  if (time) {
    result.day = Number(time[1]);
    result.time = `${time[2]}:${time[3]}`;
    index += 1;
  }

  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (TREND_MARKERS.has(token)) {
      result.trend = tokens.slice(index).join(' ');
      break;
    }
    if (token === 'AUTO' || token === 'COR') { result.auto = result.auto || token === 'AUTO'; continue; }
    const wind = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(token);
    if (wind) {
      const toKnots = value => (wind[4] === 'MPS' ? Math.round(Number(value) * 1.943844) : Number(value));
      result.wind = {
        directionDeg: wind[1] === 'VRB' ? null : Number(wind[1]),
        variable: wind[1] === 'VRB',
        speedKt: toKnots(wind[2]),
        gustKt: wind[3] ? toKnots(wind[3]) : null,
        variableFrom: null, variableTo: null,
      };
      continue;
    }
    const variation = /^(\d{3})V(\d{3})$/.exec(token);
    if (variation && result.wind) {
      result.wind.variableFrom = Number(variation[1]);
      result.wind.variableTo = Number(variation[2]);
      continue;
    }
    if (token === 'CAVOK') {
      result.cavok = true;
      result.visibility = { meters: 10_000, orMore: true };
      continue;
    }
    if (/^\d{4}$/.test(token) && !result.visibility) {
      const meters = Number(token);
      result.visibility = { meters: meters === 9999 ? 10_000 : meters, orMore: meters === 9999 };
      continue;
    }
    const statute = /^(P)?(\d+)?(?:(\d)\/(\d))?SM$/.exec(token);
    if (statute && !result.visibility) {
      const miles = Number(statute[2] ?? 0) + (statute[3] ? Number(statute[3]) / Number(statute[4]) : 0);
      result.visibility = { meters: Math.round(miles * 1609.344), orMore: Boolean(statute[1]) };
      continue;
    }
    if (/^R\d{2}[LCR]?\//.test(token)) continue;
    const weather = WEATHER.exec(token);
    if (weather) {
      result.weather.push({ code: token, intensity: weather[1] ?? null, descriptor: weather[2] ?? null,
        phenomena: weather[3].match(/.{2}/g) });
      continue;
    }
    const cloud = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(token);
    if (cloud && CLOUD_COVER.has(cloud[1])) {
      result.clouds.push({ cover: cloud[1], baseFt: cloud[2] === '///' ? null : Number(cloud[2]) * 100,
        convective: cloud[3] ?? null });
      continue;
    }
    if (NO_CLOUD.has(token)) { result.clouds.push({ cover: token, baseFt: null, convective: null }); continue; }
    const temperature = /^(M?\d{2})\/(M?\d{2})?$/.exec(token);
    if (temperature) {
      result.temperatureC = signedTemperature(temperature[1]);
      result.dewPointC = temperature[2] ? signedTemperature(temperature[2]) : null;
      continue;
    }
    const qnh = /^Q(\d{4})$/.exec(token);
    if (qnh) { result.qnhHpa = Number(qnh[1]); continue; }
    const altimeter = /^A(\d{4})$/.exec(token);
    if (altimeter) {
      result.altimeterInHg = Number(altimeter[1]) / 100;
      result.qnhHpa = result.qnhHpa ?? Math.round(result.altimeterInHg * 33.8639);
      continue;
    }
    result.unparsed.push(token);
  }
  return result;
}
