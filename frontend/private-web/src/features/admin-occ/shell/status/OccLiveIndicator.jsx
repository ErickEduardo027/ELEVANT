'use client';

import { useTranslation } from '../../../../i18n/LanguageScope';
import OccGlyph from '../../../occ-ui/OccGlyph';
import OccPopover from '../../../occ-ui/OccPopover';
import { OCC_OBSERVER_POLL_MS } from '../../live/occCadence';
import { LIVE_STATES } from '../../live/occLive';
import { occShellMessages } from '../occShellMessages';
import { formatStationTime } from './OccClocks';
import { STATUS_CONTROL, STATUS_CONTROL_REST, STATUS_TONE } from './statusBarLayout';

// The four states of the live link (design C.4), each with its own shape. The two normal ones carry no hue: a filled
// dot while live, a half dot while reconnecting. Without real time the picture may lag (attention: the amber triangle);
// without ELEVANT it is not current at all (urgent: the red octagon).
const SIGNAL_OF = Object.freeze({ polling: 'attention', offline: 'urgent' });

function LinkGlyph({ state }) {
  const signal = SIGNAL_OF[state];
  if (signal) return <OccGlyph name={signal} />;
  const live = state === 'live';
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true" data-shape={live ? 'dot' : 'half-dot'}
      className="h-4 w-4 shrink-0">
      <circle cx="8" cy="8" r="5" fill={live ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
      {live ? null : <path d="M8 3a5 5 0 0 0 0 10Z" fill="currentColor" />}
    </svg>
  );
}

/**
 * «En vivo», «Reconectando», «Sin tiempo real» or «Sin conexión», from the shell's `live` (`{ state, since, lastOkAt }`).
 * A button whose panel says in one sentence what the state means. `labelClassName` places its word (below 640 px only
 * the glyph shows; the word stays for screen readers). A state it does not know reads as «Sin conexión».
 */
export default function OccLiveIndicator({ live, className = '', labelClassName = '' }) {
  const { t, locale } = useTranslation(occShellMessages);
  const state = LIVE_STATES.includes(live?.state) ? live.state : 'offline';
  let hint;
  if (state === 'polling') hint = t('status.liveHint.polling', { seconds: OCC_OBSERVER_POLL_MS / 1000 });
  else if (state === 'offline') {
    hint = t('status.liveHint.offline', { time: formatStationTime(live?.lastOkAt ?? live?.since, locale) });
  } else hint = t(`status.liveHint.${state}`);
  const tone = STATUS_TONE[SIGNAL_OF[state]] ?? STATUS_CONTROL_REST;

  return (
    <OccPopover className={className} panelLabel={t('status.livePanel')} panelClassName="w-64"
      triggerClassName={`${STATUS_CONTROL} ${tone}`}
      trigger={<><LinkGlyph state={state} /><span className={labelClassName}>{t(`status.live.${state}`)}</span></>}>
      <p data-live-state={state}>{hint}</p>
    </OccPopover>
  );
}
