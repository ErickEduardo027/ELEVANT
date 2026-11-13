'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import { XIcon } from '../shell/components/icons';
import OccGlyph from './OccGlyph';
import OccPlate from './OccPlate';
import { occUiMessages } from './occUiMessages';
import { SIGNALS } from './statusVocabulary';

/**
 * Where the stack sits (design D27): fixed to the top right of the screen, 8 px under the 48 px status bar, so it never
 * covers the clocks or the alert count, which live in the bar. `className` is literal so that Tailwind generates it:
 * `top-14` is 3.5 rem (56 px) and `right-4` 1 rem (16 px). Above the drawers and dialogs (`z-toast`).
 */
export const OCC_TOAST_PLACEMENT = Object.freeze({
  statusBarPx: 48,
  topPx: 56,
  rightPx: 16,
  className: 'fixed right-4 top-14 z-toast flex w-[min(24rem,calc(100vw_-_2rem))] flex-col gap-2',
});

// Elevation 2 (design B.5) without a shadow: the raised slab with a strong joint. An urgent or attention toast takes
// the soft slab of its signal and a 3 px bar in its colour; its text stays plain.
const TONE = Object.freeze({
  urgent: 'border-l-[3px] border-l-occ-danger bg-occ-danger-soft',
  attention: 'border-l-[3px] border-l-occ-warn bg-occ-warn-soft',
  notice: 'bg-occ-panel-raised',
});

const ACTION = 'mt-2 inline-flex h-8 min-w-11 items-center justify-center rounded border border-occ-line-strong px-3 '
  + 'text-sm font-semibold text-occ-text hover:bg-occ-panel [@media(pointer:coarse)]:h-11';
const DISMISS = '-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-occ-muted '
  + 'hover:bg-occ-panel hover:text-occ-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/**
 * The OCC toasts (design F and D27). Each toast is `{ id, priority, message, code, action }`: `priority` is `urgent`,
 * `attention` or `notice` and draws its glyph and word; `code` (optional) is an operation code, drawn after the message
 * and a comma as a plate, «Incidencia reportada en rampa, OP-0412», so it never breaks across lines; `action`
 * (`{ label, onClick }`, «Abrir» or «Ver») runs and then closes the toast, like «Cerrar notificación» (`onDismiss(id)`).
 * An urgent toast is an `alert`, the rest are `status`: a toast never takes focus. It decides nothing about when a
 * toast shows or goes (shell/occToastQueue.js does).
 */
export default function OccToastStack({ toasts = [], onDismiss, className = '' }) {
  const { t, language } = useTranslation(occUiMessages);
  if (toasts.length === 0) return null;

  return (
    <div data-occ-toasts="" className={`${OCC_TOAST_PLACEMENT.className} ${className}`}>
      {toasts.map(toast => {
        const priority = Object.hasOwn(SIGNALS, toast.priority) ? toast.priority : 'notice';
        return (
          <div key={toast.id} role={priority === 'urgent' ? 'alert' : 'status'} data-priority={priority}
            className={`flex items-start gap-2.5 rounded-[var(--occ-radius-overlay)] border border-occ-line-strong p-3 text-occ-text ${TONE[priority]}`}>
            <OccGlyph name={priority} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">{SIGNALS[priority][language]}</p>
              <p className="mt-0.5 text-sm">
                {toast.message}
                {toast.code ? <>{', '}<OccPlate kind="code" className="align-middle">{toast.code}</OccPlate></> : null}
              </p>
              {toast.action ? (
                <button type="button" className={ACTION}
                  onClick={() => { toast.action.onClick?.(); onDismiss?.(toast.id); }}>
                  {toast.action.label}
                </button>
              ) : null}
            </div>
            <button type="button" onClick={() => onDismiss?.(toast.id)} aria-label={t('toasts.dismiss')} className={DISMISS}>
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
