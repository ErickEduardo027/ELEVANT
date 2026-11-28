import { createTranslator } from '../../../i18n/languageStore';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { runwayWinds } from '../../maps/airport/runwayWind';
import { mapMessages } from '../../maps/mapMessages';
import { FLIGHT_CATEGORIES, FLIGHT_CATEGORY_COLORS } from '../../maps/style/weatherColors';
import { describeTafPeriod, tafPeriodConditions } from '../../weather/taf';

// The model of the floating panel «Meteorología PUJ» of the console (WeatherPanel.jsx, lane M7, 2026-11-27): the flight
// category of the METAR, the TAF as rows of a band of time (occ-ui/OccTimeline.jsx) and the wind on each runway end
// with its gust. Pure: the instant and the language are parameters.

const HOUR_MS = 3_600_000;
/** How much of the TAF the band shows: eight hours from an hour before now, inside its validity. */
export const TAF_WINDOW_MS = 8 * HOUR_MS;
export const TAF_PAST_MS = HOUR_MS;

/** The rows of the TAF band, in this order: the prevailing forecast (base and FM), BECMG, TEMPO, PROB. */
export const TAF_ROWS = Object.freeze(['base', 'BECMG', 'TEMPO', 'PROB']);

const finite = value => typeof value === 'number' && Number.isFinite(value);

/**
 * The server's flight category of the METAR (AWC fltCat) as the panel draws it: `{ code, color }`, with the aviation
 * colour of style/weatherColors.js, or `{ code: null, color: null }` for none or one the panel does not know.
 */
export function flightCategoryOf(observation) {
  const code = String(observation?.flightCategory ?? '').trim().toUpperCase();
  return FLIGHT_CATEGORIES.includes(code)
    ? Object.freeze({ code, color: FLIGHT_CATEGORY_COLORS[code] })
    : Object.freeze({ code: null, color: null });
}

// The row of a period: a probability (PROB30, PROB40 TEMPO) first, then its change, else the prevailing forecast.
function rowOf(period) {
  if (finite(period.probabilityPercent) || period.change === 'PROB') return 'PROB';
  if (period.change === 'TEMPO' || period.change === 'BECMG') return period.change;
  return 'base';
}

// Where a period stands at `nowMs`: holding now (drawn as on stand), over (departed) or still to come (planned).
function stateOf(period, nowMs) {
  if (!finite(nowMs)) return 'planned';
  if (period.to <= nowMs) return 'departed';
  return period.from <= nowMs ? 'onStand' : 'planned';
}

/**
 * The TAF (features/weather/taf.js: toTafModel) as a band for OccTimeline at `nowMs`: `{ windowStart, windowEnd, rows }`,
 * or null without a TAF or periods. The window starts an hour before now and lasts eight hours, kept inside the TAF's
 * validity. Rows are TAF_ROWS that have periods, `{ id, label: id, bars }`; each bar is `{ id, startAt, endAt, state,
 * current, estimated: false, demo: false, conflict: null, inOperation: false, name, text }`: `name` its whole words
 * (describeTafPeriod, and «Ahora» while it holds), `text` what it forecasts (tafPeriodConditions).
 */
export function tafBand(model, nowMs, { language = 'es' } = {}) {
  if (!model || !Array.isArray(model.periods) || model.periods.length === 0) return null;
  const t = createTranslator(mapMessages, language);
  const latestStart = Math.max(model.validFrom, model.validTo - TAF_WINDOW_MS);
  const start = finite(nowMs) ? Math.min(Math.max(model.validFrom, nowMs - TAF_PAST_MS), latestStart) : model.validFrom;
  const end = Math.min(model.validTo, start + TAF_WINDOW_MS);
  const rows = new Map(TAF_ROWS.map(id => [id, []]));
  model.periods.forEach((period, index) => {
    const state = stateOf(period, nowMs);
    const current = state === 'onStand';
    const words = describeTafPeriod(period, { language });
    rows.get(rowOf(period)).push(Object.freeze({
      id: `taf-${index}`, startAt: period.from, endAt: period.to, state, current,
      estimated: false, demo: false, conflict: null, inOperation: false,
      name: current ? `${words}, ${t('weather.taf.now').toLowerCase()}` : words,
      text: tafPeriodConditions(period, { language }) || words,
    }));
  });
  return Object.freeze({
    windowStart: start,
    windowEnd: end,
    rows: Object.freeze(TAF_ROWS.filter(id => rows.get(id).length > 0)
      .map(id => Object.freeze({ id, label: id, bars: Object.freeze(rows.get(id)) }))),
  });
}

/**
 * The wind of the METAR on every runway end of `layout` for the panel's table (airport/runwayWind.js: runwayWinds):
 * `[{ ident, label, headwindKt, crosswindKt, side, gust, inUse }]`, frozen, `gust` the components at the gust's speed
 * or null, `inUse` for the end the runway in use lands on (`runway.arrival`). Empty for a calm, variable or no wind.
 */
export function runwayRows(wind, { layout = MDPC_LAYOUT, runway = null } = {}) {
  const arrival = runway?.arrival ?? null;
  return Object.freeze(runwayWinds(layout, wind).map(end => Object.freeze({
    ...end, gust: end.gust ?? null, inUse: arrival !== null && end.ident === arrival,
  })));
}

/**
 * The words of a wind component on a runway, from the map's tooltip (mapMessages wind.*): «12 kt de frente», «12 kt de
 * cola», «6 kt de la derecha», «6 kt de la izquierda»; «0 kt» for none.
 */
export function componentWords(components, language = 'es') {
  const t = createTranslator(mapMessages, language);
  const { headwindKt, crosswindKt, side } = components;
  const along = headwindKt < 0 ? t('wind.tail', { speed: -headwindKt }) : t('wind.head', { speed: headwindKt });
  let across = `${crosswindKt} kt`;
  if (side === 'right') across = t('wind.fromRight', { speed: crosswindKt });
  else if (side === 'left') across = t('wind.fromLeft', { speed: crosswindKt });
  return Object.freeze({ along, across });
}
