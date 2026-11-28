import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { parseMetar } from '../../weather/metar';
import { consoleMessages } from './consoleMessages';
import { describeClouds, describeVisibility, describeWeather, describeWind, weatherStateKey } from './weatherWords';

// Synthetic METAR reports of MDPC, in the format the station publishes.
const words = (metar, t) => ({
  wind: describeWind(t, metar.wind),
  visibility: describeVisibility(t, metar.visibility),
  clouds: describeClouds(t, metar.clouds),
  weather: metar.weather.map(item => describeWeather(t, item)),
});

describe('weatherWords', () => {
  it('same words as the old weather panel', () => {
    const t = createTranslator(consoleMessages, 'es');
    // The observation the old dashboard's tests read: «100° · 13 kt · ráfagas 25 kt» and «Escasas 2,200 ft».
    expect(words(parseMetar('MDPC 111900Z 10013G25KT 9999 FEW022 30/23 Q1015'), t)).toEqual({
      wind: '100° · 13 kt · ráfagas 25 kt', visibility: '10 km o más', clouds: 'Escasas 2,200 ft', weather: [],
    });
    expect(words(parseMetar('MDPC 111900Z VRB03KT 3000 +TSRA SCT015CB BKN040 25/23 Q1012'), t)).toEqual({
      wind: 'Variable · 3 kt', visibility: '3 km', clouds: 'Dispersas 1,500 ft CB · Fragmentadas 4,000 ft',
      weather: ['fuerte tormenta lluvia'],
    });
    expect(words(parseMetar('MDPC 111900Z 00000KT 1200 BR NSC 24/23 Q1013'), t)).toMatchObject({
      wind: 'Calma', visibility: '1.2 km', weather: ['neblina'],
    });
    expect(describeWind(t, null)).toBe('—');
    expect(describeVisibility(t, null)).toBe('—');
    expect(describeClouds(t, [])).toBe('Sin nubes reportadas');

    // The console's words are the old dashboard's panel's, word for word, in both languages (that panel and its message
    // file are gone with PR U3; these are the sentences it wrote for the same reports).
    const reports = ['MDPC 111900Z 10013G25KT 280V340 9999 FEW022 30/23 Q1015',
      'MDPC 111900Z VRB03KT 3000 -SHRA VCTS SCT015CB BKN040 25/23 Q1012'];
    const expected = {
      es: [
        { wind: '100° · 13 kt · ráfagas 25 kt · variable 280°–340°', visibility: '10 km o más', clouds: 'Escasas 2,200 ft',
          weather: [] },
        { wind: 'Variable · 3 kt', visibility: '3 km', clouds: 'Dispersas 1,500 ft CB · Fragmentadas 4,000 ft',
          weather: ['ligera chubascos lluvia'] },
      ],
      en: [
        { wind: '100° · 13 kt · gusts 25 kt · variable 280°–340°', visibility: '10 km or more', clouds: 'Few 2,200 ft',
          weather: [] },
        { wind: 'Variable · 3 kt', visibility: '3 km', clouds: 'Scattered 1,500 ft CB · Broken 4,000 ft',
          weather: ['light showers rain'] },
      ],
    };
    for (const language of ['es', 'en']) {
      const fromConsole = createTranslator(consoleMessages, language);
      reports.forEach((report, index) => {
        expect(words(parseMetar(report), fromConsole), `${language}: ${report}`).toEqual(expected[language][index]);
      });
    }
    expect(describeWind(createTranslator(consoleMessages, 'en'), parseMetar('MDPC 111900Z 10013G25KT 9999 Q1015').wind))
      .toBe('100° · 13 kt · gusts 25 kt');
  });

  it('weatherStateKey says every state without an observation, never «Consultando…» for ever (M7)', () => {
    expect(weatherStateKey(undefined)).toBe('weather.loading');
    expect(weatherStateKey({ status: 'loading', data: null })).toBe('weather.loading');
    expect(weatherStateKey({ status: 'error', data: null })).toBe('weather.error');
    expect(weatherStateKey({ status: 'unauthorized', data: null })).toBe('weather.forbidden');
    expect(weatherStateKey({ status: 'empty', apiStatus: 'Unavailable', data: null })).toBe('weather.unavailable');
    expect(weatherStateKey({ status: 'empty', apiStatus: 'Disabled', data: null })).toBe('weather.disabled');
    expect(weatherStateKey({ status: 'success', apiStatus: 'Live', data: { metar: {} } })).toBeNull();
    const t = createTranslator(consoleMessages, 'es');
    expect(t('weather.disabled')).toBe('El clima de MDPC no está activado en este entorno.');
    expect(t('weather.forbidden')).toBe('Tu acceso no incluye el clima de MDPC.');
  });
});
