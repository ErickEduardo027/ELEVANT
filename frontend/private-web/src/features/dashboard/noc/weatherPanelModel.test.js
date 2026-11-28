import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { FLIGHT_CATEGORY_COLORS } from '../../maps/style/weatherColors';
import { createTaf, WEATHER_NOON } from '../../maps/testing/weatherFixtures';
import { parseMetar } from '../../weather/metar';
import { toTafModel } from '../../weather/taf';
import { componentWords, flightCategoryOf, runwayRows, TAF_PAST_MS, TAF_WINDOW_MS, tafBand } from './weatherPanelModel';

const NOON = Date.parse(WEATHER_NOON);
const at = minutes => NOON + minutes * 60_000;

describe('the model of «Meteorología PUJ» (M7)', () => {
  it('flightCategoryOf gives the server category with its aviation colour, and nothing for an unknown one', () => {
    expect(flightCategoryOf({ flightCategory: 'IFR' })).toEqual({ code: 'IFR', color: FLIGHT_CATEGORY_COLORS.IFR });
    expect(flightCategoryOf({ flightCategory: ' mvfr ' }).code).toBe('MVFR');
    for (const value of [null, undefined, '', 'XYZ']) {
      expect(flightCategoryOf({ flightCategory: value })).toEqual({ code: null, color: null });
    }
    expect(flightCategoryOf(null)).toEqual({ code: null, color: null });
  });

  it('tafBand puts each period in its row, with its state at now, in an eight-hour window from an hour before now', () => {
    const model = toTafModel(createTaf());
    // 16:30Z, inside the TEMPO of 16:00Z–20:00Z and the base period.
    const now = at(90);
    const band = tafBand(model, now);
    expect(band.windowStart).toBe(now - TAF_PAST_MS);
    expect(band.windowEnd).toBe(now - TAF_PAST_MS + TAF_WINDOW_MS);
    expect(band.rows.map(row => row.id)).toEqual(['base', 'TEMPO', 'PROB']);
    const [base, tempo, prob] = band.rows;
    expect(base.bars.map(bar => [bar.id, bar.state])).toEqual([['taf-0', 'onStand'], ['taf-2', 'planned']]);
    expect(tempo.bars[0]).toMatchObject({ state: 'onStand', current: true, text: '100° 15 kt G25 · 4 km · SHRA · BKN015',
      name: 'Temporal 12:00–16:00 · 100° 15 kt G25 · 4 km · SHRA · BKN015, ahora' });
    expect(prob.bars[0]).toMatchObject({ state: 'planned', current: false });
    expect(prob.bars[0].name).toBe('Probabilidad 30 % 00:00–04:00 · 3 km · TSRA · BKN012');
    // In English, and before the validity starts or near its end the window stays inside it.
    expect(tafBand(model, now, { language: 'en' }).rows[1].bars[0].name).toMatch(/^Temporary .*, now$/u);
    expect(tafBand(model, at(-600)).windowStart).toBe(model.validFrom);
    expect(tafBand(model, at(1250)).windowEnd).toBe(model.validTo);
    expect(tafBand(model, at(1250)).windowStart).toBe(model.validTo - TAF_WINDOW_MS);
    // Past periods are drawn as over; nothing without a TAF or periods.
    expect(tafBand(model, at(500)).rows[1].bars[0].state).toBe('departed');
    expect(tafBand(null, now)).toBeNull();
    expect(tafBand({ ...model, periods: [] }, now)).toBeNull();
  });

  it('runwayRows marks the runway in use and carries the gust; componentWords uses the map tooltip words', () => {
    const wind = parseMetar('MDPC 131450Z 10013G25KT 9999 SCT020 29/22 Q1015').wind;
    const rows = runwayRows(wind, { layout: MDPC_LAYOUT, runway: { arrival: '08', departure: '08' } });
    expect(rows.map(row => [row.ident, row.inUse])).toEqual([['08', true], ['26', false], ['09', false], ['27', false]]);
    expect(rows[0].gust).toEqual({ headwindKt: 22, crosswindKt: 11, side: 'right' });
    expect(runwayRows(parseMetar('MDPC 131450Z 10013KT 9999').wind).every(row => row.gust === null && !row.inUse)).toBe(true);
    expect(runwayRows(null)).toEqual([]);
    expect(componentWords(rows[0])).toEqual({ along: '12 kt de frente', across: '6 kt de la derecha' });
    expect(componentWords(rows[1])).toEqual({ along: '12 kt de cola', across: '6 kt de la izquierda' });
    expect(componentWords({ headwindKt: 10, crosswindKt: 0, side: null }, 'en').across).toBe('0 kt');
  });
});
