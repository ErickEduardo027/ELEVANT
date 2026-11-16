'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Elevation 2 of the design (B.5) without a shadow: the raised slab, a strong joint and the overlay radius. Below
// 640 px the panel spans the screen 8 px under the 48 px status bar, so it never runs off either edge. The radius comes
// from its token because the legacy bridge turns `rounded-lg` into the 4 px control radius inside the OCC. The panel
// scrolls when it is taller than the screen, so a popover opened inside another one passes `panelClassName` classes
// that fix it to the screen (`sm:fixed …`) rather than letting the outer panel clip it.
const PANEL = 'absolute top-full z-overlay mt-2 max-h-[calc(100dvh_-_4.5rem)] overflow-y-auto '
  + 'rounded-[var(--occ-radius-overlay)] border border-occ-line-strong bg-occ-panel-raised p-3 text-sm text-occ-text '
  + 'max-sm:fixed max-sm:inset-x-2 max-sm:top-12 max-sm:w-auto';

/**
 * A non-modal disclosure: a button that opens a small panel under it (design C.3).
 * - The button carries `aria-expanded`, `aria-controls` and `aria-haspopup="dialog"`; `label` names it when its
 *   visible content (`trigger`) is not its name.
 * - The panel is a `dialog` named `panelLabel`, without `aria-modal`, so the map keeps its keys while it is open.
 *   Focus moves into it on opening.
 * - It opens with a click, Enter or Space (a native button). It closes with the button again; with Esc, which it
 *   marks with preventDefault before returning focus to the button; with a pointer press outside; or when focus moves
 *   to a control outside it.
 * - `children` is the panel's content, or a function of `{ close }`. `align` puts the panel under the button's `end`
 *   (default) or `start` edge. `onOpenChange(open)` hears every change.
 * - `panelClassName` sizes (default `w-72`) or places the panel; `className` goes on the wrapper around both, which is
 *   where a layout shows or hides the whole control.
 */
export default function OccPopover({
  label, trigger, triggerClassName = '', panelLabel, panelClassName = 'w-72', align = 'end', className = '',
  children, onOpenChange,
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  // onOpenChange hears each change once, after it is on screen; never on mount.
  const notify = useRef(onOpenChange);
  const reported = useRef(false);
  useEffect(() => { notify.current = onOpenChange; });
  useEffect(() => {
    if (reported.current === open) return;
    reported.current = open;
    notify.current?.(open);
  }, [open]);

  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onKeyDown(event) {
    // A nested popover that closed on this same Esc has already marked it; a closed one leaves Esc to the page.
    if (event.key !== 'Escape' || event.defaultPrevented || !open) return;
    event.preventDefault();
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onBlur(event) {
    // Focus leaving for another control closes it. Focus leaving the window (no related target) does not.
    const next = event.relatedTarget;
    if (next && !rootRef.current?.contains(next)) setOpen(false);
  }

  return (
    <div ref={rootRef} className={`relative flex ${className}`} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? panelId : undefined} aria-label={label} onClick={() => setOpen(value => !value)}
        className={triggerClassName}>
        {trigger}
      </button>
      {open ? (
        <div ref={panelRef} id={panelId} role="dialog" aria-label={panelLabel} tabIndex={-1}
          className={`${PANEL} ${align === 'start' ? 'left-0' : 'right-0'} ${panelClassName}`}>
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      ) : null}
    </div>
  );
}
