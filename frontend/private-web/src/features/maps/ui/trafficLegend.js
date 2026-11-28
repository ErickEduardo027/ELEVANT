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

// PR M5: in 3D, up close, an AVIAM aircraft wears its airline's livery and other traffic keeps its plain colour
// (aircraft/instancePlan.js: liveries); other traffic on the ground stays 2D.
const KIND_3D_HINTS = Object.freeze({
  aviamArrival: 'legend.traffic.aviam3dHint',
  aviamDeparture: 'legend.traffic.aviam3dHint',
  other: 'legend.traffic.other3dHint',
});
// Integration of M5 with M9: with the map's liveries (Mapa de posiciones, OccMap aircraft3d={{ liveries: true }}) every
// aircraft wears its airline's livery, and other traffic on the ground near the field is drawn in 3D too.
const KIND_3D_LIVERY_HINTS = Object.freeze({
  aviamArrival: 'legend.traffic.aviam3dHint',
  aviamDeparture: 'legend.traffic.aviam3dHint',
  other: 'legend.traffic.aviam3dHint',
  otherGround: 'legend.traffic.aviam3dHint',
});

const TRAIL_ENTRIES = Object.freeze({
  live: { key: 'trail', label: 'legend.traffic.trail' },
  estimated: { key: 'trailEstimated', label: 'legend.traffic.trailEstimated' },
});

// The chosen flight's route (traffic/routeFeatures.js): what it flew as observed and as estimated, what it still has to
// fly, and the points marked on it. «Trayecto estimado» is the label kinematics/kinematicsMessages.js gives that part.
const ROUTE_ENTRIES = Object.freeze({
  flownObserved: { key: 'routeFlownObserved', label: 'legend.traffic.routeFlownObserved' },
  flownEstimated: { key: 'routeFlownEstimated', label: 'legend.traffic.routeFlownEstimated' },
  remaining: { key: 'routeRemaining', label: 'legend.traffic.routeRemaining' },
  mark: { key: 'routeMark', label: 'legend.traffic.routeMark', hint: 'legend.traffic.routeMarkHint' },
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
 * The legend's traffic entries for `{ kinds, tags, trails, route }` (what trafficOnScreen answers), in that order:
 * each `{ key, swatch, label, hint, span }` with its words in `language`. The legend sits over the map, so it stays
 * short: a kind of aircraft is its swatch and its name on one line, a tag its word with a short hint, and the two trails
 * share a line (`span` 1, half the legend) when both are on screen. Each part of the chosen flight's route takes a line:
 * «Recorrido observado», «Trayecto estimado», «Ruta prevista» and its marked points with a short hint. The swatch names
 * what ui/TrafficSwatch.jsx draws: the solid and hollow ELEVANT silhouettes, the small muted other traffic, the plate,
 * the ring, the dimmed aircraft, the two trails and the route's solid, faint and dashed lines and its ring.
 * With `models3d` (the map in 3D), a kind its 3D aircraft draw says in a short hint whether they wear a livery; with
 * `liveries3d` too (M9, the map dresses every 3D aircraft in its airline's livery) every kind says it wears one.
 * Nothing on screen, no entry.
 */
export function trafficLegendEntries({ kinds = [], tags = [], trails = [], route = [] } = {},
  { language = 'es', models3d = false, liveries3d = false } = {}) {
  const t = createTranslator(mapMessages, language);
  const hints3d = liveries3d ? KIND_3D_LIVERY_HINTS : KIND_3D_HINTS;
  const shownTrails = trails.filter(kind => Object.hasOwn(TRAIL_ENTRIES, kind));
  return [
    ...kinds.filter(kind => Object.hasOwn(KIND_LABELS, kind))
      .map(kind => ({ key: kind, swatch: kind, label: t(KIND_LABELS[kind]),
        hint: models3d && Object.hasOwn(hints3d, kind) ? t(hints3d[kind]) : null, span: 2 })),
    ...tags.map(tag => {
      const entry = tagEntry(tag, t, language);
      return entry === null ? null : { key: tag, swatch: tag, ...entry, span: 2 };
    }).filter(Boolean),
    ...shownTrails.map(kind => {
      const entry = TRAIL_ENTRIES[kind];
      return { key: entry.key, swatch: entry.key, label: t(entry.label), hint: null, span: shownTrails.length === 2 ? 1 : 2 };
    }),
    ...(Array.isArray(route) ? route : []).filter(part => Object.hasOwn(ROUTE_ENTRIES, part)).map(part => {
      const entry = ROUTE_ENTRIES[part];
      return { key: entry.key, swatch: entry.key, label: t(entry.label), hint: entry.hint ? t(entry.hint) : null, span: 2 };
    }),
  ];
}
