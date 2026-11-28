import { createTranslator } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { mapMessages } from '../mapMessages';
import { REFERENCE_LEGEND_KINDS, runwayInUseLabel } from '../traffic/referenceFeatures';
import { WEATHER_LEGEND_KINDS, imageTimeWords, loopSpanWords } from '../traffic/weatherLayers';

// What the map legend says of the references on screen (PR M8, owner request: every map explains only what it shows),
// from OccMap's `referencesOnScreen` (traffic/referenceFeatures.js: referencesOnScreen), and then of the weather drawn
// with them (traffic/weatherLayers.js: weatherOnScreen). Apart from legendEntries.js and trafficLegend.js, so the
// stands, the traffic and the references grow without touching each other. Pure.

const LABELS = Object.freeze({
  rings: 'legend.reference.rings',
  centrelines: 'legend.reference.centrelines',
  airports: 'legend.reference.airports',
  counterparts: 'legend.reference.counterparts',
  vor: 'legend.reference.vor',
  ndb: 'legend.reference.ndb',
  night: 'legend.reference.night',
  wind: 'legend.weather.wind',
  windStale: 'legend.weather.wind',
  goes: 'legend.weather.goes',
  imerg: 'legend.weather.imerg',
  // The regional weather (lane M7).
  loopIr: 'legend.weather.loopIr',
  loopGeocolor: 'legend.weather.loopGeocolor',
  radar: 'legend.weather.radar',
  sigmet: 'legend.weather.sigmet',
  categoryVFR: 'legend.weather.categoryVFR',
  categoryMVFR: 'legend.weather.categoryMVFR',
  categoryIFR: 'legend.weather.categoryIFR',
  categoryLIFR: 'legend.weather.categoryLIFR',
  categoryNone: 'legend.weather.categoryNone',
  barb: 'legend.weather.barb',
});

// The regional kinds read from a weather service (lane M7): «No oficial» like the wind, or «Demo» when simulated.
const REPORTED = new Set(['sigmet', 'categoryVFR', 'categoryMVFR', 'categoryIFR', 'categoryLIFR', 'categoryNone', 'barb']);
// The regional images: a loop says its span, and «Demo» when simulated.
const LOOPS = new Set(['loopIr', 'loopGeocolor', 'radar']);

const word = (entry, language) => entry?.[language] ?? entry?.es ?? null;

// The tag and the hint of a weather entry: the wind is «No oficial», and when stale it is still «No oficial» and is also
// dimmed and «Sin actualizar» (contracts 2.4 and 2.5: a late METAR is no more official, and nothing depends on hover);
// a satellite image says the time of its image.
function weatherExtras(kind, imagery, language, t) {
  if (kind === 'wind') return { tag: word(TAGS.unofficial, language), hint: null };
  if (kind === 'windStale') return { tag: word(TAGS.unofficial, language), hint: word(TAGS.stale.short, language) };
  const detail = imagery?.[kind] ?? null;
  const demo = detail?.demo === true ? word(TAGS.demo, language) : null;
  if (LOOPS.has(kind)) return { tag: demo, hint: loopSpanWords(detail, language) };
  if (kind === 'sigmet') {
    const hazards = Array.isArray(detail?.hazards) ? detail.hazards : [];
    return { tag: demo ?? word(TAGS.unofficial, language),
      hint: hazards.length === 0 ? null : hazards.map(hazard => t(`weather.sigmet.hazard.${hazard}`)).join(', ') };
  }
  if (REPORTED.has(kind)) {
    return { tag: demo ?? word(TAGS.unofficial, language), hint: kind === 'barb' ? t('legend.weather.barbHint') : null };
  }
  return { tag: null, hint: imageTimeWords(detail, language) };
}

/**
 * The legend's reference entries for `{ kinds, runway, imagery }` (what OccMap's referencesOnScreen holds), in the order
 * of REFERENCE_LEGEND_KINDS, then of the weather's WEATHER_LEGEND_KINDS: each `{ key, swatch, label }` in `language`,
 * the swatch naming what ui/ReferenceSwatch.jsx draws; a weather entry also has `tag`, a word of the vocabulary shown as
 * a plate, and `hint`, a few muted words after the label (null when there is none). The runway in use says where it comes from
 * («Pista 08 (estimada por el viento)»); without its runway it is not listed. The wind at the airfield is «Viento en
 * pista» with «No oficial», and also «Sin actualizar» as its hint when its METAR is stale; a satellite image says the
 * time of its image («Imagen de las 10:50»). The regional weather (lane M7): a loop or the radar says its span («De las
 * 14:00 a las 14:50»), the SIGMETs the hazards on screen, each flight category its limits and the barbs their steps;
 * what a weather service reports is «No oficial», and anything simulated «Demo». Nothing on screen, no entry.
 */
export function referenceLegendEntries({ kinds = [], runway = null, imagery = null } = {}, { language = 'es' } = {}) {
  const t = createTranslator(mapMessages, language);
  const shown = new Set(Array.isArray(kinds) ? kinds : []);
  const references = REFERENCE_LEGEND_KINDS.filter(kind => shown.has(kind)).flatMap(kind => {
    if (kind === 'runwayInUse') {
      const label = runwayInUseLabel(runway, language);
      return label === null ? [] : [{ key: kind, swatch: kind, label }];
    }
    return [{ key: kind, swatch: kind, label: t(LABELS[kind]) }];
  });
  const weather = WEATHER_LEGEND_KINDS.filter(kind => shown.has(kind))
    .map(kind => ({ key: kind, swatch: kind, label: t(LABELS[kind]), ...weatherExtras(kind, imagery, language, t) }));
  return [...references, ...weather];
}
