import { createTranslator } from '../../../i18n/languageStore';
import { mapMessages } from '../mapMessages';
import { REFERENCE_LEGEND_KINDS, runwayInUseLabel } from '../traffic/referenceFeatures';

// What the map legend says of the references on screen (PR M8, owner request: every map explains only what it shows),
// from OccMap's `referencesOnScreen` (traffic/referenceFeatures.js: referencesOnScreen). Apart from legendEntries.js
// and trafficLegend.js, so the stands, the traffic and the references grow without touching each other. Pure.

const LABELS = Object.freeze({
  rings: 'legend.reference.rings',
  centrelines: 'legend.reference.centrelines',
  airports: 'legend.reference.airports',
  counterparts: 'legend.reference.counterparts',
  vor: 'legend.reference.vor',
  ndb: 'legend.reference.ndb',
  night: 'legend.reference.night',
});

/**
 * The legend's reference entries for `{ kinds, runway }` (what referencesOnScreen answers), in the order of
 * REFERENCE_LEGEND_KINDS: each `{ key, swatch, label }` in `language`, the swatch naming what ui/ReferenceSwatch.jsx
 * draws. The runway in use says where it comes from («Pista 08 (estimada por el viento)»); without its runway it is
 * not listed. Nothing on screen, no entry.
 */
export function referenceLegendEntries({ kinds = [], runway = null } = {}, { language = 'es' } = {}) {
  const t = createTranslator(mapMessages, language);
  const shown = new Set(Array.isArray(kinds) ? kinds : []);
  return REFERENCE_LEGEND_KINDS.filter(kind => shown.has(kind)).flatMap(kind => {
    if (kind === 'runwayInUse') {
      const label = runwayInUseLabel(runway, language);
      return label === null ? [] : [{ key: kind, swatch: kind, label }];
    }
    return [{ key: kind, swatch: kind, label: t(LABELS[kind]) }];
  });
}
