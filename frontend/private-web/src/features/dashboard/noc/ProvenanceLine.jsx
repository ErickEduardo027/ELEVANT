'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { pictureAgeSeconds } from '../../maps/ui/MapSourceStatus';
import { consoleMessages } from './consoleMessages';
import { useConsoleClock } from './useConsoleClock';

// The provenance line of the console's status bar, at the foot of its map (contratos 2.5, owner decision 6; M1): where
// what the map shows comes from, one sentence per source and only when it applies. «Posiciones: referencia interna sin
// verificar.» while a stand sits at its internal reference point; «Aviones: {red}, hace N s.» with the age of the air
// picture on the server's clock; «N posiciones estimadas.» when the map draws aircraft from the schedule; «Incluye un
// vuelo demo.» with a demo flight.

const SECOND_MS = 1_000;
const LIVE_PICTURES = new Set(['Live', 'Stale']);

/**
 * The sentences of the line, in order: `{ key, text }`. `stands` are the console's stands, `picture` the air picture
 * model and `situation` the map situation (useMapSituation); `nowMs` is the server's time. Pure.
 */
export function provenanceSentences({ stands = [], picture = null, situation = null, flights = [], nowMs = null, t }) {
  const sentences = [];
  if ((Array.isArray(stands) ? stands : []).some(stand => stand?.locationSource === 'reference')) {
    sentences.push({ key: 'stands', text: t('provenance.stands') });
  }
  const source = picture?.source?.name ?? null;
  if (picture !== null && LIVE_PICTURES.has(picture.status) && source) {
    const ageS = Math.max(0, Math.floor(pictureAgeSeconds(picture, nowMs)));
    sentences.push(ageS < 60
      ? { key: 'aircraft', text: t('provenance.aircraft', { source, age: ageS }) }
      : { key: 'aircraft', text: t('provenance.aircraftMinutes', { source, age: Math.floor(ageS / 60) }) });
  } else if (picture !== null) {
    sentences.push({ key: 'aircraft', text: t('provenance.noTraffic') });
  }
  const estimated = (situation?.aircraft ?? []).filter(item => item?.quality === 'estimated' && !item.hiddenInStand).length;
  if (estimated === 1) sentences.push({ key: 'estimated', text: t('provenance.estimatedOne') });
  else if (estimated > 1) sentences.push({ key: 'estimated', text: t('provenance.estimated', { count: estimated }) });
  if ((Array.isArray(flights) ? flights : []).some(flight => flight?.isDemo === true)) {
    sentences.push({ key: 'demo', text: t('provenance.demo') });
  }
  return sentences;
}

/**
 * The line itself (`data-testid="occ-console-provenance"`), its age counted second by second with `clock` (the map's
 * server clock) while the tab shows. Nothing to say, nothing rendered.
 */
export default function ProvenanceLine({ stands, picture, situation, flights, clock, className = '' }) {
  const { t } = useTranslation(consoleMessages);
  const nowMs = useConsoleClock(picture ? clock : null, SECOND_MS);
  const sentences = provenanceSentences({ stands, picture, situation, flights, nowMs, t });
  if (sentences.length === 0) return null;
  return (
    <p data-testid="occ-console-provenance" className={`min-w-0 text-xs leading-snug text-occ-muted ${className}`}>
      {sentences.map((sentence, index) => (
        <span key={sentence.key} data-provenance={sentence.key}>{index > 0 ? ' ' : ''}{sentence.text}</span>
      ))}
    </p>
  );
}
