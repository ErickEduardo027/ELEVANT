import { expect, it } from 'vitest';
import { parseMetar } from './metar';

it('decodes the routine MDPC report groups', () => {
  const metar = parseMetar('MDPC 111900Z 10013KT 9999 FEW022 30/23 Q1015');
  expect(metar).toMatchObject({
    station: 'MDPC', day: 11, time: '19:00',
    wind: { directionDeg: 100, speedKt: 13, gustKt: null, variable: false },
    visibility: { meters: 10_000, orMore: true },
    clouds: [{ cover: 'FEW', baseFt: 2200, convective: null }],
    temperatureC: 30, dewPointC: 23, qnhHpa: 1015, weather: [], unparsed: [],
  });
});

it('decodes gusts, variable sectors, weather, convective clouds, negative values and trends', () => {
  const metar = parseMetar('METAR MDPC 112000Z 09018G28KT 060V130 3000 +TSRA BKN015CB OVC080 M01/M03 A2992 TEMPO 1500 TSRA');
  expect(metar.wind).toEqual({ directionDeg: 90, variable: false, speedKt: 18, gustKt: 28, variableFrom: 60, variableTo: 130 });
  expect(metar.visibility).toEqual({ meters: 3000, orMore: false });
  expect(metar.weather).toEqual([{ code: '+TSRA', intensity: '+', descriptor: 'TS', phenomena: ['RA'] }]);
  expect(metar.clouds).toEqual([
    { cover: 'BKN', baseFt: 1500, convective: 'CB' },
    { cover: 'OVC', baseFt: 8000, convective: null },
  ]);
  expect(metar.temperatureC).toBe(-1);
  expect(metar.dewPointC).toBe(-3);
  expect(metar.altimeterInHg).toBe(29.92);
  expect(metar.qnhHpa).toBe(1013);
  expect(metar.trend).toBe('TEMPO 1500 TSRA');
});

it('handles calm/variable wind, CAVOK and keeps unknown groups instead of guessing', () => {
  const metar = parseMetar('MDPC 110600Z VRB02KT CAVOK 24/22 Q1016 XYZ');
  expect(metar.wind).toMatchObject({ directionDeg: null, variable: true, speedKt: 2 });
  expect(metar.cavok).toBe(true);
  expect(metar.visibility).toEqual({ meters: 10_000, orMore: true });
  expect(metar.unparsed).toEqual(['XYZ']);
});

it('returns an empty decoding for missing input', () => {
  expect(parseMetar(null)).toMatchObject({ raw: '', station: null, wind: null, clouds: [] });
});
