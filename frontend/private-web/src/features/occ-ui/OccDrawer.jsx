'use client';

import { useEffect, useId } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useTranslation } from '../../i18n/LanguageScope';
import { XIcon } from '../shell/components/icons';
import { occUiMessages } from './occUiMessages';

/**
 * How the drawer is drawn (design B.5, elevation 3: the panel slab with a joint, over the veil, flat). Pure classes, so
 * a test can read the layout that jsdom does not apply. The overlay radius comes from its token, because the legacy
 * bridge turns `rounded-lg` into the 4 px control radius inside the OCC.
 * - `sheet`: below 640 px, a bottom sheet the width of the screen, at most 85 % of its height, its top corners rounded.
 * - `side`: from 640 px, a panel on the right the height of the screen, its two left corners rounded.
 */
export const OCC_DRAWER_LAYOUT = Object.freeze({
  root: 'fixed inset-0 z-drawer flex items-end justify-end sm:items-stretch',
  scrim: 'absolute inset-0 bg-occ-scrim',
  panel: 'relative flex w-full flex-col border-occ-line bg-occ-panel text-occ-text',
  sheet: 'max-h-[85dvh] rounded-t-[var(--occ-radius-overlay)] border-t',
  side: 'sm:h-full sm:max-h-none sm:w-[min(28rem,calc(100vw_-_3rem))] sm:rounded-tr-none '
    + 'sm:rounded-bl-[var(--occ-radius-overlay)] sm:border-l sm:border-t-0',
});

const CLOSE = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-raised '
  + 'hover:text-occ-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/**
 * A modal drawer (design F): a `dialog` with `aria-modal`, named by its title (or by `labelledBy`), over the OCC veil.
 * - While it is open, Tab stays inside it (useDialogFocus) and focus starts on its first control.
 * - It closes with its «Cerrar» button, a press on the veil, or Esc, which it marks with preventDefault so the map's
 *   keys and any other listener leave that Esc alone (contratos 2.2).
 * - On closing, focus goes back where it was, or to `returnFocusRef` (the control that opens it) when that is given:
 *   some browsers do not focus a button on a click.
 * - `footer` sits under the scrolling body; `id` lets the opening button point at it with `aria-controls`.
 * It renders nothing while closed.
 */
export default function OccDrawer({
  id, open, onClose, title, children, footer, labelledBy, returnFocusRef, className = '',
}) {
  const { t } = useTranslation(occUiMessages);
  const titleId = useId();
  const dialogRef = useDialogFocus(open);

  // Declared after useDialogFocus, so this cleanup runs after its own and has the last word on where focus goes: the
  // control that was there to open the drawer.
  useEffect(() => {
    const target = open ? returnFocusRef?.current : null;
    if (!target) return undefined;
    return () => { target.focus?.(); };
  }, [open, returnFocusRef]);

  if (!open) return null;

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose?.();
  }

  return (
    <div data-occ-drawer="" className={OCC_DRAWER_LAYOUT.root}>
      <div aria-hidden="true" data-occ-drawer-scrim="" onClick={onClose} className={OCC_DRAWER_LAYOUT.scrim} />
      <div ref={dialogRef} id={id} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}
        tabIndex={-1} onKeyDown={onKeyDown}
        className={`${OCC_DRAWER_LAYOUT.panel} ${OCC_DRAWER_LAYOUT.sheet} ${OCC_DRAWER_LAYOUT.side} ${className}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-occ-line py-1.5 pl-4 pr-2">
          <h2 id={titleId} tabIndex={-1} className="min-w-0 truncate text-base font-semibold text-occ-text">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('drawer.close')} className={CLOSE}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-occ-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
