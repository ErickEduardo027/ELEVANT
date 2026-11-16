import { useEffect, useRef } from 'react';

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(open) {
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector(focusable)?.focus();
    function onKeyDown(event) {
      if (event.key !== 'Tab' || !dialog) return;
      const visibleDialogs = [...document.querySelectorAll('[aria-modal="true"]')]
        .filter(element => !element.closest('[aria-hidden="true"]'));
      if (visibleDialogs.at(-1) !== dialog) return;
      const candidates = [...dialog.querySelectorAll(focusable)];
      if (!candidates.length) { event.preventDefault(); dialog.focus(); return; }
      const first = candidates[0];
      const last = candidates.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [open]);
  return dialogRef;
}
