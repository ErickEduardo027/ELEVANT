import { createTranslator } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { mapMessages } from '../mapMessages';
import { REFERENCE_LEGEND_KINDS, runwayInUseLabel } from '../traffic/referenceFeatures';
import { WEATHER_LEGEND_KINDS, imageTimeWords } from '../traffic/weatherLayers';

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
});

const word = (entry, language) => entry?.[language] ?? entry?.es ?? null;

// The tag and the hint of a weather entry: the wind is «No oficial», and when stale it is still «No oficial» and is also
// dimmed and «Sin actualizar» (contracts 2.4 and 2.5: a late METAR is no more official, and nothing depends on hover);
// a satellite image says the time of its image.
function weatherExtras(kind, imagery, language) {
  if (kind === 'wind') return { tag: word(TAGS.unofficial, language), hint: null };
  if (kind === 'windStale') return { tag: word(TAGS.unofficial, language), hint: word(TAGS.stale.short, language) };
  return { tag: null, hint: imageTimeWords(imagery?.[kind] ?? null, language) };
}

/**
 * The legend's reference entries for `{ kinds, runway, imagery }` (what OccMap's referencesOnScreen holds), in the order
 * of REFERENCE_LEGEND_KINDS, then of the weather's WEATHER_LEGEND_KINDS: each `{ key, swatch, label }` in `language`,
 * the swatch naming what ui/ReferenceSwatch.jsx draws; a weather entry also has `tag`, a word of the vocabulary shown as
 * a plate, and `hint`, a few muted words after the label (null when there is none). The runway in use says where it comes from
 * («Pista 08 (estimada por el viento)»); without its runway it is not listed. The wind at the airfield is «Viento en
 * pista» with «No oficial», and also «Sin actualizar» as its hint when its METAR is stale; a satellite image says the
 * time of its image («Imagen de las 10:50»). Nothing on screen, no entry.
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
    .map(kind => ({ key: kind, swatch: kind, label: t(LABELS[kind]), ...weatherExtras(kind, imagery, language) }));
  return [...references, ...weather];
}
