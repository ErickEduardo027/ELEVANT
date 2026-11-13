'use client';

import { useId } from 'react';
import { useTranslation } from '../../../../i18n/LanguageScope';
import { BellIcon } from '../../../shell/components/icons';
import OccGlyph from '../../../occ-ui/OccGlyph';
import { SIGNALS, TAGS } from '../../../occ-ui/statusVocabulary';
import { occShellMessages } from '../occShellMessages';
import { formatStationTime } from './OccClocks';
import { STATUS_CONTROL, STATUS_CONTROL_REST, STATUS_TONE } from './statusBarLayout';

// How the button reads the status of the shell's notices (useOccResource): read, with alerts or without; failed, a
// first read that failed or ran out of time, which the drawer can retry; anything else (loading, idle, an account the
// server refused) counts nothing and says «Alertas» in neutral.
const READ_STATUSES = new Set(['success', 'empty']);
const FAILED_STATUSES = new Set(['error', 'timeout']);
const ALERT_SIGNALS = new Set(['urgent', 'attention']);

// Words of a phrase in a span of their own, with the spaces around them left outside it: an accessible name trims
// what each element says, so a space kept inside the span would run «3» and «alertas» together.
function Words({ text, className }) {
  const [, lead, words, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!words) return text || null;
  return <>{lead}<span className={className}>{words}</span>{trail}</>;
}

// «{count} alertas» with the number in a node of its own, which keeps the frozen test id `notifications-badge`. The
// words around it take `wordClassName`, so a narrow bar can show the number alone and still say the whole phrase.
function CountPhrase({ template, count, wordClassName }) {
  const [before, after = ''] = template.split('{count}');
  return (
    <span>
      <Words text={before} className={wordClassName} />
      <span data-testid="notifications-badge" className="tabular-nums">{count}</span>
      <Words text={after} className={wordClassName} />
    </span>
  );
}

/**
 * «Sin alertas», «1 alerta» or «{count} alertas», from `summary` (alertSummary of dashboard/noc/alertModel.js) once
 * `status` (the shell's notices) says they were read. With unreceived alerts it shows the glyph of the highest priority,
 * whose word is the button's description: shape and word, never colour alone. `onOpen` opens the alerts. When the
 * button opens a panel, `expanded` is passed on as `aria-expanded` (with `aria-haspopup="dialog"`) and `controls`, the
 * panel's id while it is open, as `aria-controls`; `ref` reaches the button, so the panel can give focus back to it.
 *
 * Two states say that the count cannot be trusted, with the amber triangle unless an urgent alert is already known:
 * - the first read failed or timed out: «Alertas: sin datos», with no count;
 * - a refresh failed after a good read (`staleSince`, the ISO instant of that read): the last count stays, dimmed,
 *   followed by «, sin actualizar», and the description says «Sin actualizar desde las 14:02» (station time).
 * Either way the button still opens the alerts, whose drawer offers «Reintentar».
 *
 * `labelClassName` goes on the words, never on the count: below 640 px the bar shows the glyph and the number, and the
 * words stay for screen readers. `detailClassName` goes on «: sin datos» and «, sin actualizar», which the bar shows
 * only where it always has room for them (statusBarLayout.js).
 */
export default function OccAlertsButton({
  ref, summary, status, staleSince = null, onOpen, expanded, controls, className = '', labelClassName = '',
  detailClassName = '',
}) {
  const { t, language, locale } = useTranslation(occShellMessages);
  const descriptionId = useId();
  const read = READ_STATUSES.has(status);
  const failed = FAILED_STATUSES.has(status);
  const stale = read && staleSince != null;
  const count = read ? Math.max(0, summary?.unreceivedCount ?? 0) : 0;
  const highest = count > 0 && ALERT_SIGNALS.has(summary?.highest) ? summary.highest : null;
  // A count the button cannot vouch for asks for attention; a known urgent alert keeps its own signal.
  const signal = highest ?? (failed || stale ? 'attention' : null);
  const description = [
    highest ? SIGNALS[highest][language] : null,
    stale ? TAGS.stale[language].replace('{time}', formatStationTime(staleSince, locale)) : null,
  ].filter(Boolean).join('. ');

  let words;
  if (!read) words = <span className={labelClassName}>{t('status.alerts.unavailable')}</span>;
  else if (count === 0) words = <span className={labelClassName}>{t('status.alerts.none')}</span>;
  else {
    words = <CountPhrase template={t(count === 1 ? 'status.alerts.one' : 'status.alerts.many')} count={count}
      wordClassName={labelClassName} />;
  }
  let detail = null;
  if (failed) detail = t('status.alerts.failedDetail');
  else if (stale) detail = t('status.alerts.staleDetail');

  return (
    <button ref={ref} type="button" onClick={onOpen} aria-expanded={expanded} aria-controls={controls}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      aria-describedby={description ? descriptionId : undefined} data-alert-priority={highest ?? 'none'}
      className={`${STATUS_CONTROL} ${STATUS_TONE[signal] ?? STATUS_CONTROL_REST} ${className}`}>
      {signal ? <OccGlyph name={signal} /> : <BellIcon className="h-4 w-4 shrink-0 text-occ-muted" />}
      {description ? <span id={descriptionId} hidden>{description}</span> : null}
      {/* The last count of a failed refresh is dimmed, as the «Sin actualizar» tag draws stale data. */}
      <span className={stale ? 'text-occ-muted' : undefined}>
        {words}
        {detail ? <span className={detailClassName}>{detail}</span> : null}
      </span>
    </button>
  );
}
