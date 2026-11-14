'use client';

import { useEffect, useId } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useTranslation } from '../../i18n/LanguageScope';
import { XIcon } from '../shell/components/icons';
import { occUiMessages } from './occUiMessages';

/** A dialog asks something (`default`) or confirms what cannot be undone (`danger`); `md` or `lg` wide. */
export const OCC_DIALOG_TONES = Object.freeze(['default', 'danger']);
export const OCC_DIALOG_SIZES = Object.freeze(['md', 'lg']);

/**
 * How the dialog is drawn (design B.5, elevation 3: the panel slab with a joint, over the veil, flat), as pure classes
 * a test can read. The overlay radius comes from its token, like OccDrawer's.
 * - Below 640 px a bottom sheet the width of the screen, its top corners rounded; from 640 px centred, at most
 *   28 rem (`md`) or 42 rem (`lg`) wide.
 */
export const OCC_DIALOG_LAYOUT = Object.freeze({
  root: 'fixed inset-0 z-modal flex items-end justify-center sm:items-center sm:p-4',
  scrim: 'absolute inset-0 bg-occ-scrim',
  panel: 'relative flex max-h-[92dvh] w-full flex-col border border-occ-line bg-occ-panel text-occ-text '
    + 'rounded-t-[var(--occ-radius-overlay)] sm:max-h-[90dvh] sm:rounded-[var(--occ-radius-overlay)]',
  size: Object.freeze({ md: 'sm:max-w-md', lg: 'sm:max-w-2xl' }),
});

const CLOSE = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-raised '
  + 'hover:text-occ-text disabled:cursor-not-allowed disabled:text-occ-faint [@media(pointer:coarse)]:h-11 '
  + '[@media(pointer:coarse)]:w-11';

/** What a footer marks as its cancel button: a `danger` dialog starts there, so a hasty Enter changes nothing. */
export const OCC_DIALOG_CANCEL = 'data-occ-dialog-cancel';

/**
 * A modal dialog of the OCC (design F), drawn where it is rendered and never in a portal: a `region` around it (the
 * review's «Detalle de entrega») still contains its buttons, as the cycle E2E reads them.
 * - `role="dialog"`, or `alertdialog` with `tone="danger"`; `aria-modal`, named by its title (an `h2`), described by
 *   `descriptionId` when given, and `aria-busy` while `busy`.
 * - Focus: Tab stays inside (useDialogFocus) and starts on its first control, or on `initialFocusRef`; a `danger`
 *   dialog starts on the footer's cancel button (`data-occ-dialog-cancel`). On closing, focus goes back where it was,
 *   or to `returnFocusRef` when given.
 * - It closes with its «Cerrar» button, a press on the veil, or Esc, which it marks with preventDefault so the map's
 *   keys leave that Esc alone (contratos 2.2); an Esc someone already took is left alone. While `busy` none of the
 *   three closes it: the command decides.
 * - `footer` holds the actions, at the end of a line under the scrolling body.
 * Being `fixed`, it is placed against the screen unless an ancestor contains it: render it outside a stacked table,
 * whose container query box would hold it. It renders nothing while closed. An unknown tone or size throws.
 */
export default function OccDialog({
  open, onClose, title, tone = 'default', size = 'md', busy = false, footer, descriptionId, initialFocusRef,
  returnFocusRef, children, className = '', 'data-testid': testId,
}) {
  if (!OCC_DIALOG_TONES.includes(tone)) throw new RangeError(`Unknown OCC dialog tone: ${String(tone)}`);
  if (!OCC_DIALOG_SIZES.includes(size)) throw new RangeError(`Unknown OCC dialog size: ${String(size)}`);
  const { t } = useTranslation(occUiMessages);
  const titleId = useId();
  const dialogRef = useDialogFocus(open);

  // Declared after useDialogFocus, so it runs after that hook has focused the first control, and moves focus on.
  useEffect(() => {
    if (!open) return;
    const target = initialFocusRef?.current
      ?? (tone === 'danger' ? dialogRef.current?.querySelector(`[${OCC_DIALOG_CANCEL}]`) : null);
    target?.focus?.();
  }, [open, tone, initialFocusRef, dialogRef]);

  // Declared after useDialogFocus too, so this cleanup runs after its own and has the last word on where focus goes:
  // the control that opened the dialog.
  useEffect(() => {
    const target = open ? returnFocusRef?.current : null;
    if (!target) return undefined;
    return () => { target.focus?.(); };
  }, [open, returnFocusRef]);

  if (!open) return null;

  const close = () => { if (!busy) onClose?.(); };
  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    close();
  }

  return (
    <div data-occ-dialog="" className={OCC_DIALOG_LAYOUT.root}>
      <div aria-hidden="true" data-occ-dialog-scrim="" onClick={close} className={OCC_DIALOG_LAYOUT.scrim} />
      <div ref={dialogRef} role={tone === 'danger' ? 'alertdialog' : 'dialog'} aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy || undefined} tabIndex={-1}
        onKeyDown={onKeyDown} data-testid={testId}
        className={`${OCC_DIALOG_LAYOUT.panel} ${OCC_DIALOG_LAYOUT.size[size]} ${className}`}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-occ-line py-1.5 pl-4 pr-2">
          <h2 id={titleId} className="min-w-0 py-1.5 text-base font-semibold text-occ-text">{title}</h2>
          <button type="button" onClick={close} disabled={busy} aria-label={t('dialog.close')} className={CLOSE}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 text-sm">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-occ-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
