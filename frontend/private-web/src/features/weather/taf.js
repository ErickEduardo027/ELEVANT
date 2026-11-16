import { OCC_TAF_CHANGES } from '@elevant/api-client';
import { createTranslator, localeFor } from '../../i18n/languageStore';
import { parseInstant } from '../../services/serverClock';
import { mapMessages } from '../maps/mapMessages';
import { stationTime } from '../maps/traffic/stationTime';

// The TAF of the aerodrome as the OCC reads it (contracts 1.4 and its amendment, ADR-0043): the raw text and the
// periods the API decoded, in one model, and a compact readout of what holds now and what comes next. A screen may
// show only the raw text; the readout is there for the ones that want a line. Pure: the instant to read at is a
// parameter, and the times are written at the station (traffic/stationTime.js), as everywhere in the OCC.

const CHANGES = new Set(OCC_TAF_CHANGES);
// The periods that set the prevailing weather: the base forecast and each FM. TEMPO, PROB and BECMG cover them.
const PREVAILING = new Set([null, 'FM']);
const METRES_PER_STATUTE_MILE = 1609.344;
const EMPTY = Object.freeze([]);

const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const wholeOrNull = value => (Number.isInteger(value) ? value : null);
const numberOrNull = value => (isNumber(value) ? value : null);

/**
 * The groups of a raw TAF, in order: the base forecast, then one group for each FMddhhmm, BECMG, TEMPO and PROBnn (a
 * «PROB30 TEMPO» is one group). The heading (TAF, AMD or COR, the station and the issue time) is not a forecast and is
 * left out, so the base group starts with its validity («1312/1412 09012KT …»). Frozen; empty for no text.
 */
export function splitTafGroups(raw) {
  const tokens = String(raw ?? '').trim().replace(/=$/u, '').split(/\s+/u).filter(Boolean);
  let index = 0;
  // After the heading comes the validity (ddhh/ddhh), never four letters.
  if (tokens[index] === 'TAF') index += 1;
  while (/^(?:AMD|COR|RTD)$/u.test(tokens[index] ?? '')) index += 1;
  if (/^[A-Z]{4}$/u.test(tokens[index] ?? '')) index += 1;
  if (/^\d{6}Z$/u.test(tokens[index] ?? '')) index += 1;

  const groups = [];
  let group = [];
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    const opens = /^(?:FM\d{6}|BECMG|PROB\d{2})$/u.test(token)
      || (token === 'TEMPO' && !/^PROB\d{2}$/u.test(tokens[index - 1] ?? ''));
    if (opens && group.length > 0) {
      groups.push(group.join(' '));
      group = [];
    }
    group.push(token);
  }
  if (group.length > 0) groups.push(group.join(' '));
  return Object.freeze(groups);
}

function toPeriod(period) {
  const from = parseInstant(period?.from);
  const to = parseInstant(period?.to);
  if (from === null || to === null || to < from) return null;
  const variable = period.windVariable === true;
  return {
    from,
    to,
    change: CHANGES.has(period.change) ? period.change : null,
    probabilityPercent: wholeOrNull(period.probabilityPercent),
    wind: Object.freeze({
      directionDeg: variable ? null : wholeOrNull(period.windDirectionDegrees),
      variable,
      speedKt: wholeOrNull(period.windSpeedKnots),
      gustKt: wholeOrNull(period.windGustKnots),
    }),
    visibilityStatuteMiles: numberOrNull(period.visibilityStatuteMiles),
    weather: typeof period.weather === 'string' && period.weather.trim() !== '' ? period.weather.trim() : null,
    // The cloud layers in the shape of features/weather/metar.js, so one writer serves the METAR and the TAF.
    clouds: Object.freeze((Array.isArray(period.clouds) ? period.clouds : []).map(layer => Object.freeze({
      cover: String(layer?.cover ?? ''), baseFt: wholeOrNull(layer?.baseFeet), convective: null,
    }))),
  };
}

// The kind of period a raw group opens, and the kind of a decoded period: a «PROB30 TEMPO» is a PROB either way.
const GROUP_KINDS = Object.freeze([[/^FM\d{6}\b/u, 'FM'], [/^BECMG\b/u, 'BECMG'], [/^TEMPO\b/u, 'TEMPO'],
  [/^PROB\d{2}\b/u, 'PROB']]);
const groupKind = group => GROUP_KINDS.find(([pattern]) => pattern.test(group))?.[1] ?? null;
const periodKind = period => (period.probabilityPercent !== null ? 'PROB' : period.change);

/**
 * The TAF of an answer of GET occ/weather (`taf`, or null) as `{ raw, issuedAt, validFrom, validTo, periods }`, every
 * instant in milliseconds, frozen; null without a TAF or with an instant that cannot be read. Each period is
 * `{ from, to, change, probabilityPercent, wind: { directionDeg, variable, speedKt, gustKt }, visibilityStatuteMiles,
 * weather, clouds: [{ cover, baseFt, convective }], group }`, by its start (the API's order when two start together);
 * a period that ends before it starts is left out. `group` is the period's text in the raw TAF (splitTafGroups) when
 * the raw text has as many groups as there are periods, each of the same kind as its period; otherwise no period
 * carries one, because the two could not be matched.
 */
export function toTafModel(taf) {
  if (taf === null || typeof taf !== 'object' || typeof taf.raw !== 'string' || taf.raw.trim() === '') return null;
  const issuedAt = parseInstant(taf.issuedAt);
  const validFrom = parseInstant(taf.validFrom);
  const validTo = parseInstant(taf.validTo);
  if (issuedAt === null || validFrom === null || validTo === null) return null;
  const periods = (Array.isArray(taf.periods) ? taf.periods : []).map(toPeriod).filter(Boolean);
  // Array sorts are stable: periods that start together keep the API's order, which is the raw text's.
  periods.sort((left, right) => left.from - right.from);
  const groups = splitTafGroups(taf.raw);
  const matched = groups.length === periods.length
    && periods.every((period, index) => periodKind(period) === groupKind(groups[index]));
  const withGroups = periods.map((period, index) => Object.freeze({ ...period, group: matched ? groups[index] : null }));
  return Object.freeze({ raw: taf.raw, issuedAt, validFrom, validTo, periods: Object.freeze(withGroups) });
}

/**
 * What the TAF says at `nowMs`: `{ state, current, next, validTo }`, frozen.
 * - `state`: `none` (no TAF, or one without periods), `notYet` (its validity starts later), `expired` (its validity is
 *   over) or `current`.
 * - `current`: the base or FM period that holds now, then the TEMPO, PROB and BECMG periods that cover now, in order;
 *   empty unless `current`.
 * - `next`: the first period that starts after now, or null (none once the TAF expired).
 * - `validTo`: the end of the validity in milliseconds, or null without a TAF.
 */
export function tafReadout(model, nowMs) {
  const validTo = model?.validTo ?? null;
  const answer = (state, current = EMPTY, next = null) => Object.freeze({ state, current, next, validTo });
  if (!model || !isNumber(nowMs)) return answer('none');
  if (nowMs >= model.validTo) return answer('expired');
  const next = model.periods.find(period => period.from > nowMs) ?? null;
  if (nowMs < model.validFrom) return answer('notYet', EMPTY, next);
  if (model.periods.length === 0) return answer('none');
  const covering = model.periods.filter(period => period.from <= nowMs && nowMs < period.to);
  let prevailing = null;
  for (const period of covering) if (PREVAILING.has(period.change)) prevailing = period;
  const others = covering.filter(period => !PREVAILING.has(period.change));
  return answer('current', Object.freeze(prevailing ? [prevailing, ...others] : others), next);
}

/** «Temporal», «Probabilidad 30 %»…: what kind of period it is; nothing for the base forecast. */
function changeLabel(t, period, language) {
  if (isNumber(period.probabilityPercent)) {
    const percent = language === 'en' ? `${period.probabilityPercent}%` : `${period.probabilityPercent} %`;
    return t('weather.taf.change.PROB', { percent });
  }
  if (period.change === 'PROB') return t('weather.taf.change.PROB', { percent: '' }).trim();
  return period.change ? t(`weather.taf.change.${period.change}`) : null;
}

/** «090° 15 kt G25», «VRB 3 kt» or «Calma»; nothing without a speed. */
function windText(t, wind) {
  if (!wind || !isNumber(wind.speedKt)) return null;
  if (wind.speedKt === 0) return t('weather.wind.calm');
  let direction = null;
  if (wind.variable) direction = t('weather.wind.variable');
  else if (isNumber(wind.directionDeg)) direction = `${String(wind.directionDeg).padStart(3, '0')}°`;
  const gust = isNumber(wind.gustKt) ? ` ${t('weather.wind.gust', { speed: wind.gustKt })}` : '';
  return `${direction ? `${direction} ` : ''}${wind.speedKt} kt${gust}`;
}

/** «400 m», «4,5 km» (the locale's decimal mark) or «10 km»; nothing without a visibility. */
function visibilityText(miles, locale) {
  if (!isNumber(miles)) return null;
  const metres = miles * METRES_PER_STATUTE_MILE;
  if (metres < 1_000) return `${Math.round(metres / 100) * 100} m`;
  const km = metres / 1_000;
  const value = km >= 5 ? Math.round(km) : Math.round(km * 10) / 10;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} km`;
}

/** «FEW020 SCT040»: each layer's cover and its base in hundreds of feet, as the report writes them. */
function cloudsText(clouds) {
  const layers = (clouds ?? []).map(layer => (isNumber(layer.baseFt)
    ? `${layer.cover}${String(Math.round(layer.baseFt / 100)).padStart(3, '0')}`
    : layer.cover)).filter(Boolean);
  return layers.length > 0 ? layers.join(' ') : null;
}

/**
 * One period in a line, in `language`: what kind of period it is (none for the base forecast) and its span at the
 * station, then the wind, the visibility, the weather and the clouds it forecasts, joined by « · »:
 * «Temporal 12:00–16:00 · 100° 15 kt G25 · 4 km · SHRA · BKN015». The weather and the clouds keep the TAF's codes.
 * An empty string without a period.
 */
export function describeTafPeriod(period, { language = 'es' } = {}) {
  if (!period) return '';
  const t = createTranslator(mapMessages, language);
  const locale = localeFor(language);
  const span = `${stationTime(period.from, locale)}–${stationTime(period.to, locale)}`;
  const label = changeLabel(t, period, language);
  return [label ? `${label} ${span}` : span, windText(t, period.wind),
    visibilityText(period.visibilityStatuteMiles, locale), period.weather, cloudsText(period.clouds)]
    .filter(Boolean).join(' · ');
}
