import { createTranslator } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { mapMessages } from '../mapMessages';

// What the map legend says of the traffic on screen (owner request: every map explains only what it shows), from
// OccMap's `trafficOnScreen` (traffic/trafficFeatures.js). Apart from legendEntries.js, so the stands and the traffic
// grow without touching each other. The tags take their words from occ-ui/statusVocabulary.js. Pure.

const KIND_LABELS = Object.freeze({
  aviamArrival: 'legend.traffic.aviamArrival',
  aviamDeparture: 'legend.traffic.aviamDeparture',
  other: 'legend.traffic.other',
  otherGround: 'legend.traffic.otherGround',
});

const TRAIL_ENTRIES = Object.freeze({
  live: { key: 'trail', label: 'legend.traffic.trail' },
  estimated: { key: 'trailEstimated', label: 'legend.traffic.trailEstimated' },
});

const word = (entry, language) => entry?.[language] ?? entry?.es ?? '';

// A tag in its word of the vocabulary, with a short hint after it.
function tagEntry(tag, t, language) {
  if (tag === 'demo') return { label: word(TAGS.demo, language), hint: t('legend.traffic.demoHint') };
  if (tag === 'estimated') return { label: word(TAGS.estimated, language), hint: t('legend.traffic.estimatedHint') };
  if (tag === 'stale') return { label: word(TAGS.stale.short, language), hint: t('legend.traffic.staleHint') };
  return null;
}

/**
 * The legend's traffic entries for `{ kinds, tags, trails }` (what trafficOnScreen answers), in that order: each
 * `{ key, swatch, label, hint, span }` with its words in `language`. The legend sits over the map, so it stays short:
 * a kind of aircraft is its swatch and its name on one line, a tag its word with a short hint, and the two trails share
 * a line (`span` 1, half the legend) when both are on screen. The swatch names what ui/TrafficSwatch.jsx draws: the
 * solid and hollow ELEVANT silhouettes, the small muted other traffic, the plate, the ring, the dimmed aircraft and the
 * two trails. Nothing on screen, no entry.
 */
export function trafficLegendEntries({ kinds = [], tags = [], trails = [] } = {}, { language = 'es' } = {}) {
  const t = createTranslator(mapMessages, language);
  const shownTrails = trails.filter(kind => Object.hasOwn(TRAIL_ENTRIES, kind));
  return [
    ...kinds.filter(kind => Object.hasOwn(KIND_LABELS, kind))
      .map(kind => ({ key: kind, swatch: kind, label: t(KIND_LABELS[kind]), hint: null, span: 2 })),
    ...tags.map(tag => {
      const entry = tagEntry(tag, t, language);
      return entry === null ? null : { key: tag, swatch: tag, ...entry, span: 2 };
    }).filter(Boolean),
    ...shownTrails.map(kind => {
      const entry = TRAIL_ENTRIES[kind];
      return { key: entry.key, swatch: entry.key, label: t(entry.label), hint: null, span: shownTrails.length === 2 ? 1 : 2 };
    }),
  ];
}
