'use client';

import { useSyncExternalStore } from 'react';
import { useTranslation } from '../../../../i18n/LanguageScope';
import { CheckCircleIcon } from '../../../shell/components/icons';
import OccGlyph from '../../../occ-ui/OccGlyph';
import OccPopover from '../../../occ-ui/OccPopover';
import OccStandSwatch from '../../../occ-ui/OccStandSwatch';
import { TAGS } from '../../../occ-ui/statusVocabulary';
import { LIVE_STATES } from '../../live/occLive';
import { OCC_SOURCES } from '../../live/sourceHealth';
import { occShellMessages } from '../occShellMessages';
import { formatStationTime } from './OccClocks';
import { STATUS_CONTROL, STATUS_CONTROL_REST, STATUS_TONE } from './statusBarLayout';

// The summary's signal (design C.3): sources running late ask for attention; ELEVANT unreachable is urgent.
const SUMMARY_SIGNAL = Object.freeze({ delayed: 'attention', disconnected: 'urgent' });
// The same two signals on the rows of the list.
const ROW_SIGNAL = Object.freeze({ delayed: 'attention', offline: 'urgent' });

const SECOND_MS = 1_000;
const RECENT_MS = 60_000;

// A one-second clock for «hace 8 s»; the list subscribes to it only while it is open.
function subscribeSeconds(listener) {
  const timer = setInterval(listener, SECOND_MS);
  return () => clearInterval(timer);
}
const currentSecond = () => Math.floor(Date.now() / SECOND_MS) * SECOND_MS;

// The tag's word without its time («Sin actualizar»); null for a tag the vocabulary does not have.
function tagWord(tag, language) {
  if (!Object.hasOwn(TAGS, tag)) return null;
  return tag === 'stale' ? TAGS.stale.short[language] : TAGS[tag][language];
}

/** «Al día, hace 8 s» under a minute old, «Al día, 14:31» after it; the state alone without a time. */
function SourceState({ item, now }) {
  const { t, locale } = useTranslation(occShellMessages);
  // The realtime source names its state with the live link's own words (design C.4).
  const word = item.id === 'realtime' && LIVE_STATES.includes(item.detail)
    ? t(`status.live.${item.detail}`)
    : t(`sourceStates.${item.state}`);
  let age = null;
  if (item.at != null && item.state !== 'idle') {
    age = now - item.at < RECENT_MS
      ? t('status.sources.secondsAgo', { count: Math.max(0, Math.floor((now - item.at) / SECOND_MS)) })
      : formatStationTime(item.at, locale);
  }
  return <>{age ? `${word}, ${age}` : word}</>;
}

function SourcesList({ items }) {
  const { t, language } = useTranslation(occShellMessages);
  const now = useSyncExternalStore(subscribeSeconds, currentSecond, currentSecond);
  if (items.length === 0) return <p className="text-occ-muted">{t('status.sources.empty')}</p>;
  return (
    <ul className="divide-y divide-occ-line">
      {items.map(item => {
        const signal = ROW_SIGNAL[item.state];
        const tags = (item.tags ?? []).map(tag => [tag, tagWord(tag, language)]).filter(([, word]) => word);
        return (
          <li key={item.id} data-source={item.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <span className="min-w-0 text-occ-text">{OCC_SOURCES[item.id]?.[language] ?? item.id}</span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-right">
              <span className="flex items-center gap-1.5 text-occ-muted">
                {signal ? <OccGlyph name={signal} /> : null}
                <SourceState item={item} now={now} />
              </span>
              {tags.length > 0 ? (
                <span className="flex flex-wrap justify-end gap-x-2 gap-y-1">
                  {/* Each tag with its texture, drawn as in «Leyenda»: «Demo» keeps its stripes, «est.» its dashes. */}
                  {tags.map(([tag, word]) => (
                    <span key={tag} data-tag={tag} className="flex items-center gap-1 text-xs text-occ-muted">
                      <OccStandSwatch tag={tag} />
                      {word}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Fuentes al día», «1 fuente con retraso», «{count} fuentes con retraso» or «Sin conexión con ELEVANT», from the
 * shell's `sources` (`{ items, summary }`). It opens the list of every source with its state, its age and its tags.
 * `labelClassName` places the summary's word (between 640 and 1023 px only the glyph shows).
 */
export default function OccSourcesButton({ sources, className = '', labelClassName = '' }) {
  const { t } = useTranslation(occShellMessages);
  const items = sources?.items ?? [];
  const { kind = 'ok', delayedCount = 0 } = sources?.summary ?? {};
  const signal = SUMMARY_SIGNAL[kind] ?? null;
  let word;
  if (kind === 'disconnected') word = t('status.sources.disconnected');
  else if (kind === 'delayed') word = t(delayedCount === 1 ? 'status.sources.one' : 'status.sources.many', { count: delayedCount });
  else word = t('status.sources.ok');

  return (
    <OccPopover className={className} panelLabel={t('status.sources.panel')} panelClassName="w-80"
      triggerClassName={`${STATUS_CONTROL} ${STATUS_TONE[signal] ?? STATUS_CONTROL_REST}`}
      trigger={<>
        {signal ? <OccGlyph name={signal} /> : <CheckCircleIcon className="h-4 w-4 shrink-0 text-occ-muted" />}
        <span className={labelClassName}>{word}</span>
      </>}>
      <p className="mb-2 text-xs font-semibold text-occ-muted">{t('status.sources.panel')}</p>
      <SourcesList items={items} />
    </OccPopover>
  );
}
