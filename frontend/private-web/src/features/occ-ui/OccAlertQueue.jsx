'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { notificationKindLabel } from '../notifications/notificationKinds';
import OccGlyph from './OccGlyph';
import OccPlate from './OccPlate';
import { occUiMessages } from './occUiMessages';
import { SIGNALS, TAGS } from './statusVocabulary';

/** The places a queue is drawn in. U3 adds the console's alerts panel. */
export const ALERT_QUEUE_VARIANTS = Object.freeze(['drawer']);

const NO_ENTRIES = Object.freeze([]);
const NO_ROW_STATES = Object.freeze({});
const LOADING = new Set(['idle', 'loading']);
const FAILED = new Set(['error', 'timeout']);
const REFUSED = new Set(['forbidden', 'unauthorized']);
const EMPTY_TIME = '--:--';

// An unreceived alert keeps the soft slab of its signal and a 3 px bar in its colour, its text staying plain (design
// B.4 and H.2). Once received, nothing on the row is lit: the receipt turns the light off.
const ROW = 'border-l-[3px] px-3 py-2.5';
const ROW_LIT = Object.freeze({
  urgent: 'border-occ-danger bg-occ-danger-soft',
  attention: 'border-occ-warn bg-occ-warn-soft',
});
const ROW_CALM = 'border-transparent bg-occ-panel';

// Alert actions are at least 44 px wide, and 44 px high on a touch screen (design H.2). «Recibido» is the light key of
// the primary action (contratos 2.4); «Abrir» a plain control.
const KEY = 'inline-flex h-8 min-w-11 items-center justify-center rounded px-3 text-sm font-semibold '
  + '[@media(pointer:coarse)]:h-11';
const PRIMARY_KEY = `${KEY} bg-occ-primary text-occ-on-primary hover:bg-occ-primary-hover aria-disabled:cursor-wait `
  + 'aria-disabled:opacity-60';
const PLAIN_KEY = `${KEY} border border-occ-line-strong text-occ-text hover:bg-occ-panel-raised`;

const formatters = new Map();

/** «14:32» for an ISO instant in `timeZone`, without seconds; --:-- without a valid instant. */
function formatTime(value, locale, timeZone) {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) return EMPTY_TIME;
  const key = `${locale}|${timeZone}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }));
  }
  return formatters.get(key).format(ms);
}

function QueueRow({ entry, state, language, locale, timeZone, t, onAcknowledge, onOpen }) {
  const lineId = useId();
  const { notice, priority, receivedAt } = entry;
  const alert = priority !== 'notice';
  const unreceived = alert && receivedAt === null;
  // Both buttons are described by the row, so «Recibido» and «Abrir» keep their short names in every row. The spaces
  // between the parts of a line take no room in the flex line, but keep its words apart when it is read out.
  const describedBy = `${lineId}-signal ${lineId}-what`;
  const pending = state === 'pending';

  return (
    <li data-alert-id={entry.id} data-priority={priority} data-received={alert ? String(!unreceived) : undefined}
      className={`${ROW} ${unreceived ? ROW_LIT[priority] : ROW_CALM}`}>
      <p id={`${lineId}-signal`} className="flex items-center gap-2 text-xs font-semibold text-occ-text">
        {/* Only an unreceived urgent alert blinks; OccGlyph keeps it still under reduced motion. */}
        <OccGlyph name={priority} blink={unreceived && priority === 'urgent'} />
        <span>{SIGNALS[priority][language]}</span>{' '}
        <time dateTime={notice.occurredAt ?? undefined} className="ml-auto font-mono font-medium text-occ-muted">
          {formatTime(notice.occurredAt, locale, timeZone)}
        </time>
      </p>
      <p id={`${lineId}-what`} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-occ-text">
        <span className="min-w-0">{notificationKindLabel(notice.kind, language)}</span>
        {notice.operationCode ? <>{' '}<OccPlate kind="code">{notice.operationCode}</OccPlate></> : null}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {unreceived ? (
          <button type="button" data-occ-acknowledge="" aria-describedby={describedBy}
            aria-disabled={pending ? 'true' : undefined} onClick={() => onAcknowledge(entry)} className={PRIMARY_KEY}>
            {t('alerts.acknowledge')}
          </button>
        ) : null}
        {/* The receipt takes the place of the button that asked for it. */}
        {alert && !unreceived ? (
          <span className="text-xs text-occ-muted">
            {t('alerts.receivedAt', { time: formatTime(receivedAt, locale, timeZone) })}
          </span>
        ) : null}
        <button type="button" aria-describedby={describedBy} onClick={() => onOpen?.(entry)} className={PLAIN_KEY}>
          {t('alerts.open')}
        </button>
      </div>
      {unreceived && state === 'failed'
        ? <p role="alert" className="mt-2 text-xs text-occ-text">{t('alerts.acknowledgeFailed')}</p>
        : null}
    </li>
  );
}

function QueueList({ entries, rowStates, ...row }) {
  // 1 px joints between flat slabs: the list's own colour shows through the gaps.
  return (
    <ul className="mt-2 flex flex-col gap-px overflow-hidden rounded-md border border-occ-line bg-occ-line">
      {entries.map(entry => <QueueRow key={entry.id} entry={entry} state={rowStates[entry.id]} {...row} />)}
    </ul>
  );
}

function QueueNote({ children, role, action }) {
  return (
    <div role={role} className="rounded-md border border-occ-line bg-occ-panel px-3 py-3 text-sm text-occ-text">
      <p>{children}</p>
      {action}
    </div>
  );
}

/**
 * The queue of alerts and notices (design F): `alerts` and `recent` come from buildAlertQueue
 * (dashboard/noc/alertModel.js), each entry `{ id, priority, receivedAt, notice }`.
 * - Section «Alertas», with its unreceived count: an unreceived alert offers «Recibido» and «Abrir»; a received one says
 *   «Recibida a las 14:32» and offers «Abrir». Section «Avisos recientes»: plain notices, with «Abrir» only.
 * - `onAcknowledge(entry)` is the server read receipt and returns a promise. «Recibido» calls it once: it stays
 *   `aria-disabled` (and keeps its focus) until the answer. A failure leaves the alert unreceived with a fixed message
 *   on its row, never the server's text. After a receipt, focus moves to the next «Recibido», or to the «Alertas»
 *   title when none is left.
 * - Only the glyph of an unreceived urgent alert blinks, and never under reduced motion.
 * - `status` is the notices' read status: loading, a recoverable error with «Reintentar» (`onRetry`), no permission, or
 *   the lists. `staleSince` (an ISO instant) says the list is the last one read, with «Reintentar».
 * - Times are «14:32» in `timeZone`, written for `locale` (the language's by default).
 */
export default function OccAlertQueue({
  alerts = NO_ENTRIES, recent = NO_ENTRIES, status = 'success', onAcknowledge, onOpen, onRetry, locale,
  timeZone = 'UTC', staleSince = null, variant = 'drawer', className = '',
}) {
  const { t, language, locale: languageLocale } = useTranslation(occUiMessages);
  const timeLocale = locale ?? languageLocale;
  const alertsTitleId = useId();
  const recentTitleId = useId();
  const rootRef = useRef(null);
  const titleRef = useRef(null);
  const inFlight = useRef(new Set());
  const focusAfter = useRef(null);
  const [rowStates, setRowStates] = useState(NO_ROW_STATES);

  const setRowState = useCallback((id, value) => setRowStates(current => {
    if ((current[id] ?? null) === value) return current;
    const next = { ...current };
    if (value === null) delete next[id];
    else next[id] = value;
    return next;
  }), []);

  async function acknowledge(entry) {
    if (typeof onAcknowledge !== 'function' || inFlight.current.has(entry.id)) return;
    inFlight.current.add(entry.id);
    const index = alerts.filter(item => item.receivedAt === null).findIndex(item => item.id === entry.id);
    focusAfter.current = { id: entry.id, index: Math.max(0, index) };
    setRowState(entry.id, 'pending');
    try {
      await onAcknowledge(entry);
      setRowState(entry.id, null);
    } catch {
      if (focusAfter.current?.id === entry.id) focusAfter.current = null;
      setRowState(entry.id, 'failed');
    } finally {
      inFlight.current.delete(entry.id);
    }
  }

  // Once the list shows the receipt, the row's «Recibido» is gone with its focus: hand it to the next «Recibido», or to
  // the title. The list and the answer can arrive in either order, so this checks after every render. Focus the user
  // moved somewhere else on purpose stays where it is.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || alerts.some(entry => entry.id === target.id && entry.receivedAt === null)) return;
    focusAfter.current = null;
    const root = rootRef.current;
    const active = document.activeElement;
    if (!root || (active && active !== document.body && !root.contains(active))) return;
    const buttons = root.querySelectorAll('[data-occ-acknowledge]');
    (buttons[Math.min(target.index, buttons.length - 1)] ?? titleRef.current)?.focus();
  });

  // A typo never draws a silent queue.
  if (!ALERT_QUEUE_VARIANTS.includes(variant)) throw new RangeError(`Unknown OCC alert queue variant: ${String(variant)}`);
  const retry = typeof onRetry === 'function'
    ? <button type="button" onClick={onRetry} className={`${PLAIN_KEY} mt-2`}>{t('alerts.retry')}</button>
    : null;
  let body;
  if (LOADING.has(status)) body = <QueueNote role="status">{t('alerts.loading')}</QueueNote>;
  else if (FAILED.has(status)) body = <QueueNote role="alert" action={retry}>{t('alerts.error')}</QueueNote>;
  else if (REFUSED.has(status)) body = <QueueNote>{t('alerts.forbidden')}</QueueNote>;
  else {
    const unreceivedCount = alerts.filter(entry => entry.receivedAt === null).length;
    const row = { rowStates, language, locale: timeLocale, timeZone, t, onAcknowledge: acknowledge, onOpen };
    body = (
      <>
        {staleSince ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-occ-muted">
            <p>{TAGS.stale[language].replace('{time}', formatTime(staleSince, timeLocale, timeZone))}</p>
            {typeof onRetry === 'function'
              ? <button type="button" onClick={onRetry} className={PLAIN_KEY}>{t('alerts.retry')}</button>
              : null}
          </div>
        ) : null}
        <section aria-labelledby={alertsTitleId}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 ref={titleRef} id={alertsTitleId} tabIndex={-1} className="text-sm font-semibold text-occ-text">
              {t('alerts.title')}
            </h3>
            {/* Polite: a new alert or a receipt is announced while the queue is open. */}
            <p aria-live="polite" aria-atomic="true" className="text-xs text-occ-muted">
              {unreceivedCount > 0 ? t('alerts.unreceived', { count: unreceivedCount }) : ''}
            </p>
          </div>
          {unreceivedCount === 0 ? <p className="mt-2 text-sm text-occ-muted">{t('alerts.empty')}</p> : null}
          {alerts.length > 0 ? <QueueList entries={alerts} {...row} /> : null}
        </section>
        <section aria-labelledby={recentTitleId} className="mt-5">
          <h3 id={recentTitleId} className="text-sm font-semibold text-occ-text">{t('alerts.recentTitle')}</h3>
          {recent.length > 0
            ? <QueueList entries={recent} {...row} />
            : <p className="mt-2 text-sm text-occ-muted">{t('alerts.emptyRecent')}</p>}
        </section>
      </>
    );
  }

  return <div ref={rootRef} data-occ-alert-queue={variant} className={className}>{body}</div>;
}
