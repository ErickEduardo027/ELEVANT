'use client';

import { useId } from 'react';
import { useTranslation } from '../../../../i18n/LanguageScope';
import { BellIcon } from '../../../shell/components/icons';
import OccGlyph from '../../../occ-ui/OccGlyph';
import { SIGNALS } from '../../../occ-ui/statusVocabulary';
import { occShellMessages } from '../occShellMessages';
import { STATUS_CONTROL, STATUS_CONTROL_REST, STATUS_TONE } from './statusBarLayout';

// The notices have been read, with alerts or without; while they load, after a failure or without permission the
// button cannot count anything and says «Alertas» in neutral.
const READ_STATUSES = new Set(['success', 'empty']);
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
 * `labelClassName` goes on the words, never on the count: below 640 px the bar shows the glyph and the number, and the
 * words stay for screen readers.
 */
export default function OccAlertsButton({
  ref, summary, status, onOpen, expanded, controls, className = '', labelClassName = '',
}) {
  const { t, language } = useTranslation(occShellMessages);
  const wordId = useId();
  const read = READ_STATUSES.has(status);
  const count = read ? Math.max(0, summary?.unreceivedCount ?? 0) : 0;
  const highest = count > 0 && ALERT_SIGNALS.has(summary?.highest) ? summary.highest : null;
  let phrase;
  if (!read) phrase = <span className={labelClassName}>{t('status.alerts.unavailable')}</span>;
  else if (count === 0) phrase = <span className={labelClassName}>{t('status.alerts.none')}</span>;
  else {
    phrase = <CountPhrase template={t(count === 1 ? 'status.alerts.one' : 'status.alerts.many')} count={count}
      wordClassName={labelClassName} />;
  }

  return (
    <button ref={ref} type="button" onClick={onOpen} aria-expanded={expanded} aria-controls={controls}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'} aria-describedby={highest ? wordId : undefined}
      data-alert-priority={highest ?? 'none'}
      className={`${STATUS_CONTROL} ${STATUS_TONE[highest] ?? STATUS_CONTROL_REST} ${className}`}>
      {highest ? <OccGlyph name={highest} /> : <BellIcon className="h-4 w-4 shrink-0 text-occ-muted" />}
      {highest ? <span id={wordId} hidden>{SIGNALS[highest][language]}</span> : null}
      {phrase}
    </button>
  );
}
