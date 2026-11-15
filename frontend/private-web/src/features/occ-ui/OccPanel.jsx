'use client';

import { useId } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import OccEmptyState from './OccEmptyState';
import OccSkeleton from './OccSkeleton';
import { formatClock } from './occTime';
import { occUiMessages } from './occUiMessages';

/** The states of a remote read, as admin-occ/live/useOccResource.js reports them. */
export const OCC_PANEL_STATUSES = Object.freeze([
  'idle', 'loading', 'success', 'empty', 'error', 'timeout', 'forbidden', 'unauthorized',
]);

const LOADING = new Set(['idle', 'loading']);
const FAILED = new Set(['error', 'timeout']);
const REFUSED = new Set(['forbidden', 'unauthorized']);
const HEADING_LEVELS = Object.freeze([2, 3, 4]);

// A plain control, 44 px wide at least and 44 px high on a touch screen (design H.2).
const RETRY = 'inline-flex h-8 min-w-11 shrink-0 items-center justify-center rounded border border-occ-line-strong px-3 '
  + 'text-sm font-semibold text-occ-text hover:bg-occ-panel-raised [@media(pointer:coarse)]:h-11';
// Kept data whose refresh failed stays on screen, dimmed (design D26).
const DIMMED = 'opacity-70';

const interpolate = (text, values) => text.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));

/**
 * The panel state of a useOccResource view: `{ status, staleSince, onRetry }`. `staleSince` is the instant of the data
 * on screen when its last refresh failed, and null otherwise.
 */
export function panelStateOf(view) {
  return {
    status: view?.status ?? 'idle',
    staleSince: view?.refreshFailed ? view.fetchedAt ?? null : null,
    onRetry: view?.retry,
  };
}

/**
 * The five states of a remote view without a frame (frontend/AGENTS.md; design F), for the body of a floating panel or
 * of an OccPanel. `status` is a useOccResource status (panelStateOf turns a view into these props):
 * - `idle` and `loading`: the first load draws `skeleton` (an OccSkeleton by default), never a zero.
 * - `success`: `children`. `empty`: `emptyState`, or one sentence («No hay datos para mostrar.»).
 * - `error` and `timeout`: a fixed sentence announced as an `alert`, and «Reintentar» when `onRetry` is given.
 * - `forbidden` and `unauthorized` (after a 401 or a 403, contratos 2.7): the no-permission sentence, with no retry.
 * - `staleSince` (an instant) with `success` or `empty`: the last data stays, dimmed and marked `data-stale`, under a
 *   polite note «La última actualización falló; se muestran los datos consultados a las 14:32.» with «Reintentar».
 * The body keeps its place in the tree in both cases, so what it holds keeps its state when a refresh fails or
 * recovers. `labels` replaces any of the texts `loading`, `empty`, `error`, `timeout`, `forbidden`, `unauthorized`,
 * `retry` and `stale` (`{time}` is replaced). It never shows a text from the server. An unknown status throws.
 */
export function OccRemoteView({
  status = 'success', staleSince = null, onRetry, labels, emptyState, skeleton, locale, timeZone = 'UTC', children,
  className = '',
}) {
  const { t, locale: languageLocale } = useTranslation(occUiMessages);
  if (!OCC_PANEL_STATUSES.includes(status)) throw new RangeError(`Unknown OCC panel status: ${String(status)}`);
  const text = (key, values) => (typeof labels?.[key] === 'string' ? interpolate(labels[key], values) : t(`panel.${key}`, values));
  const retry = typeof onRetry === 'function'
    ? <button type="button" onClick={() => onRetry()} className={RETRY}>{text('retry')}</button>
    : null;

  let state = null;
  if (LOADING.has(status)) state = skeleton ?? <OccSkeleton label={text('loading')} />;
  else if (FAILED.has(status)) {
    state = (
      <>
        <p role="alert" className="text-sm text-occ-text">{text(status)}</p>
        {retry ? <div className="mt-2">{retry}</div> : null}
      </>
    );
  } else if (REFUSED.has(status)) {
    const refusal = status === 'unauthorized' && typeof labels?.unauthorized === 'string'
      ? labels.unauthorized
      : text('forbidden');
    state = <p className="text-sm text-occ-text">{refusal}</p>;
  }
  if (state !== null) return <div data-occ-remote-view={status} className={className}><div className="p-3">{state}</div></div>;

  const stale = staleSince !== null && staleSince !== undefined;
  return (
    <div data-occ-remote-view={status} className={className}>
      {stale ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-occ-line px-3 py-2">
          <p role="status" className="min-w-0 text-xs text-occ-muted">
            {text('stale', { time: formatClock(staleSince, locale ?? languageLocale, timeZone) })}
          </p>
          {retry}
        </div>
      ) : null}
      <div data-stale={stale ? '' : undefined} className={stale ? DIMMED : undefined}>
        {status === 'empty'
          ? <div className="p-3">{emptyState ?? <OccEmptyState title={text('empty')} />}</div>
          : children}
      </div>
    </div>
  );
}

/**
 * A panel of the OCC (design F): a `section` named by its title, so it is a region with that name (like the
 * dashboard's ConsolePanel), on the panel slab with a 1 px joint and the 6 px panel radius, flat.
 * - Header: the title as an `h2` (`headingLevel` 3 or 4 inside another section), then `meta` in secondary text and
 *   `actions` at the end of the line.
 * - Body: OccRemoteView with `status`, `staleSince`, `onRetry`, `labels`, `emptyState`, `skeleton`, `locale` and
 *   `timeZone`; `bodyClassName` goes on it. Without `status` it shows `children`.
 * It forwards `data-testid`; `className` goes on the section. An unknown heading level or status throws.
 */
export default function OccPanel({
  title, meta, actions, headingLevel = 2, status, staleSince, onRetry, labels, emptyState, skeleton, locale, timeZone,
  className = '', bodyClassName = '', children, 'data-testid': testId,
}) {
  const titleId = useId();
  if (!HEADING_LEVELS.includes(headingLevel)) throw new RangeError(`Unknown OCC panel heading level: ${String(headingLevel)}`);
  const Heading = `h${headingLevel}`;
  return (
    <section aria-labelledby={titleId} data-occ-panel="" data-testid={testId}
      className={`flex min-w-0 flex-col overflow-hidden rounded-md border border-occ-line bg-occ-panel text-occ-text ${className}`}>
      <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-occ-line px-3 py-2">
        <Heading id={titleId} className="text-sm font-semibold text-occ-text">{title}</Heading>
        {meta ? <div className="text-xs text-occ-muted">{meta}</div> : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      <OccRemoteView status={status} staleSince={staleSince} onRetry={onRetry} labels={labels} emptyState={emptyState}
        skeleton={skeleton} locale={locale} timeZone={timeZone} className={`min-h-0 flex-1 ${bodyClassName}`}>
        {children}
      </OccRemoteView>
    </section>
  );
}
