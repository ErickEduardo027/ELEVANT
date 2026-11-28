import { describe, expect, it } from 'vitest';
import { createTaf, WEATHER_NOON, WEATHER_TAF_RAW } from '../maps/testing/weatherFixtures';
import { describeTafPeriod, splitTafGroups, tafPeriodConditions, tafReadout, toTafModel } from './taf';

const NOON = Date.parse(WEATHER_NOON);
const at = minutes => NOON + minutes * 60_000;

describe('the TAF model (contracts 1.4)', () => {
  it('splitTafGroups cuts the raw text at FM, BECMG, TEMPO and PROB', () => {
    expect(splitTafGroups(WEATHER_TAF_RAW)).toEqual([
      '1312/1412 09012KT 9999 FEW020 SCT040',
      'TEMPO 1316/1320 10015G25KT 4000 SHRA BKN015',
      'FM132200 07008KT 9999 FEW020',
      'PROB30 1404/1408 3000 TSRA BKN012CB',
    ]);
    // An amended TAF over several lines, with BECMG and a «PROB40 TEMPO», which is one group, and the closing «=».
    expect(splitTafGroups(`TAF AMD MDPC 131420Z 1315/1412 08010KT 9999 SCT020
        BECMG 1318/1320 06006KT
        PROB40 TEMPO 1402/1406 4000 SHRA=`)).toEqual([
      '1315/1412 08010KT 9999 SCT020', 'BECMG 1318/1320 06006KT', 'PROB40 TEMPO 1402/1406 4000 SHRA',
    ]);
    // Without the heading the text starts with its validity; a missing issue time still drops the station.
    expect(splitTafGroups('1312/1412 09012KT 9999 FEW020 TEMPO 1316/1320 SHRA')).toEqual([
      '1312/1412 09012KT 9999 FEW020', 'TEMPO 1316/1320 SHRA',
    ]);
    expect(splitTafGroups('TAF MDPC 1312/1412 09012KT')).toEqual(['1312/1412 09012KT']);
    expect(splitTafGroups('')).toEqual([]);
    expect(splitTafGroups(null)).toEqual([]);
    expect(Object.isFrozen(splitTafGroups(WEATHER_TAF_RAW))).toBe(true);
  });

  it('toTafModel keeps the periods in order with their raw group only when the counts match', () => {
    const model = toTafModel(createTaf());
    expect(model).toMatchObject({ raw: WEATHER_TAF_RAW, issuedAt: at(-240), validFrom: at(-180), validTo: at(1260) });
    expect(model.periods.map(period => [period.change, period.from, period.to, period.group])).toEqual([
      [null, at(-180), at(420), '1312/1412 09012KT 9999 FEW020 SCT040'],
      ['TEMPO', at(60), at(300), 'TEMPO 1316/1320 10015G25KT 4000 SHRA BKN015'],
      ['FM', at(420), at(1260), 'FM132200 07008KT 9999 FEW020'],
      ['PROB', at(780), at(1020), 'PROB30 1404/1408 3000 TSRA BKN012CB'],
    ]);
    expect(model.periods[1]).toEqual({
      from: at(60), to: at(300), change: 'TEMPO', probabilityPercent: null,
      wind: { directionDeg: 100, variable: false, speedKt: 15, gustKt: 25 },
      visibilityStatuteMiles: 2.49, weather: 'SHRA',
      clouds: [{ cover: 'BKN', baseFt: 1500, convective: null }],
      group: 'TEMPO 1316/1320 10015G25KT 4000 SHRA BKN015',
    });
    expect(model.periods[3]).toMatchObject({ probabilityPercent: 30,
      wind: { directionDeg: null, variable: false, speedKt: null, gustKt: null } });
    expect(Object.isFrozen(model) && Object.isFrozen(model.periods) && model.periods.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(model.periods[0].wind) && Object.isFrozen(model.periods[0].clouds)).toBe(true);

    // Out of order, the periods come back by their start, still with their own groups.
    const taf = createTaf();
    const shuffled = toTafModel({ ...taf, periods: [taf.periods[2], taf.periods[0], taf.periods[3], taf.periods[1]] });
    expect(shuffled.periods.map(period => period.change)).toEqual([null, 'TEMPO', 'FM', 'PROB']);
    expect(shuffled.periods.map(period => period.group)).toEqual(model.periods.map(period => period.group));
    // A raw text with fewer groups than periods, or groups of another kind, gives no period a group.
    const fewer = toTafModel({ ...taf, raw: 'TAF MDPC 131100Z 1312/1412 09012KT 9999 FEW020 SCT040' });
    expect(fewer.periods.map(period => period.group)).toEqual([null, null, null, null]);
    const otherKinds = toTafModel({ ...taf,
      raw: 'TAF MDPC 131100Z 1312/1412 09012KT BECMG 1316/1320 10015KT TEMPO 1322/1324 SHRA FM140400 07008KT' });
    expect(otherKinds.periods.map(period => period.group)).toEqual([null, null, null, null]);
    // A period that ends before it starts is left out; a variable wind has no direction; an unknown change is none.
    const odd = toTafModel({ ...taf, periods: [
      { ...taf.periods[0], windVariable: true, windDirectionDegrees: null },
      { ...taf.periods[1], from: taf.periods[1].to, to: taf.periods[1].from },
      { ...taf.periods[2], change: 'NOSIG' },
    ] });
    expect(odd.periods.map(period => [period.change, period.wind.variable, period.wind.directionDeg]))
      .toEqual([[null, true, null], [null, false, 70]]);

    // No TAF, or one whose instants cannot be read, is no model.
    expect(toTafModel(null)).toBeNull();
    expect(toTafModel(undefined)).toBeNull();
    expect(toTafModel({ ...taf, raw: '  ' })).toBeNull();
    expect(toTafModel({ ...taf, validTo: 'mañana' })).toBeNull();
    // The API may write .NET instants: seven decimals and an offset.
    expect(toTafModel({ ...taf, validFrom: '2026-11-13T12:00:00.0000000+00:00' }).validFrom).toBe(at(-180));
  });

  it('tafReadout gives the base period and the TEMPO that cover now, and the next one', () => {
    const model = toTafModel(createTaf());
    const [base, tempo, change, prob] = model.periods;
    // At noon only the base forecast holds; the showers come next.
    expect(tafReadout(model, at(0))).toEqual({ state: 'current', current: [base], next: tempo, validTo: at(1260) });
    // During the TEMPO: the base and the TEMPO, then the change at 22:00Z.
    expect(tafReadout(model, at(120))).toEqual({ state: 'current', current: [base, tempo], next: change, validTo: at(1260) });
    // After the change (FM) the base period is over.
    expect(tafReadout(model, at(480))).toEqual({ state: 'current', current: [change], next: prob, validTo: at(1260) });
    // In the chance of thunderstorms nothing starts later.
    expect(tafReadout(model, at(840))).toEqual({ state: 'current', current: [change, prob], next: null, validTo: at(1260) });
    // A period holds from its start up to, not including, its end.
    expect(tafReadout(model, at(300)).current).toEqual([base]);
    expect(tafReadout(model, at(420)).current).toEqual([change]);
    expect(Object.isFrozen(tafReadout(model, at(0))) && Object.isFrozen(tafReadout(model, at(0)).current)).toBe(true);
  });

  it('an expired TAF, one not yet valid and one without periods', () => {
    const model = toTafModel(createTaf());
    expect(tafReadout(model, at(1260))).toEqual({ state: 'expired', current: [], next: null, validTo: at(1260) });
    expect(tafReadout(model, at(-200))).toEqual({ state: 'notYet', current: [], next: model.periods[0], validTo: at(1260) });
    const empty = toTafModel({ ...createTaf(), periods: [] });
    expect(empty.periods).toEqual([]);
    expect(tafReadout(empty, at(0))).toEqual({ state: 'none', current: [], next: null, validTo: at(1260) });
    expect(tafReadout(null, at(0))).toEqual({ state: 'none', current: [], next: null, validTo: null });
    expect(tafReadout(model, Number.NaN).state).toBe('none');
  });

  it('describeTafPeriod in Spanish and English with station times', () => {
    const [base, tempo, change, prob] = toTafModel(createTaf()).periods;
    // Punta Cana is four hours behind UTC: the TEMPO of 16:00Z to 20:00Z holds from 12:00 to 16:00 at the station.
    expect(describeTafPeriod(tempo)).toBe('Temporal 12:00–16:00 · 100° 15 kt G25 · 4 km · SHRA · BKN015');
    expect(describeTafPeriod(tempo, { language: 'en' })).toBe('Temporary 12:00–16:00 · 100° 15 kt G25 · 4 km · SHRA · BKN015');
    expect(describeTafPeriod(base)).toBe('08:00–18:00 · 090° 12 kt · 10 km · FEW020 SCT040');
    expect(describeTafPeriod(change)).toBe('Cambio 18:00–08:00 · 070° 8 kt · 10 km · FEW020');
    expect(describeTafPeriod(prob)).toBe('Probabilidad 30 % 00:00–04:00 · 3 km · TSRA · BKN012');
    expect(describeTafPeriod(prob, { language: 'en' })).toBe('Probability 30% 00:00–04:00 · 3 km · TSRA · BKN012');

    // Calm and variable winds, short visibilities, a layer without a base and a gradual change.
    const quiet = { ...base, change: 'BECMG', wind: { directionDeg: null, variable: false, speedKt: 0, gustKt: null },
      visibilityStatuteMiles: 0.25, clouds: [{ cover: 'NSC', baseFt: null, convective: null }] };
    expect(describeTafPeriod(quiet)).toBe('Cambio gradual 08:00–18:00 · Calma · 400 m · NSC');
    expect(describeTafPeriod({ ...quiet, wind: { directionDeg: null, variable: true, speedKt: 3, gustKt: null },
      visibilityStatuteMiles: 3 }, { language: 'en' })).toBe('Gradual change 08:00–18:00 · VRB 3 kt · 4.8 km · NSC');
    // A PROB without its percent still says what it is; an empty period says nothing.
    expect(describeTafPeriod({ ...prob, probabilityPercent: null })).toBe('Probabilidad 00:00–04:00 · 3 km · TSRA · BKN012');
    expect(describeTafPeriod(null)).toBe('');
  });

  it('tafPeriodConditions says what a period forecasts without its kind or span (M7)', () => {
    const [base, tempo, , prob] = toTafModel(createTaf()).periods;
    expect(tafPeriodConditions(tempo)).toBe('100° 15 kt G25 · 4 km · SHRA · BKN015');
    expect(tafPeriodConditions(base, { language: 'en' })).toBe('090° 12 kt · 10 km · FEW020 SCT040');
    expect(tafPeriodConditions(prob)).toBe('3 km · TSRA · BKN012');
    expect(tafPeriodConditions({ ...base, wind: null, visibilityStatuteMiles: null, weather: null, clouds: [] })).toBe('');
    expect(tafPeriodConditions(null)).toBe('');
  });
});
