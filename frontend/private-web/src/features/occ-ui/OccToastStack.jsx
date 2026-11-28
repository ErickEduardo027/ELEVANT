'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import { XIcon } from '../shell/components/icons';
import OccGlyph from './OccGlyph';
import OccPlate from './OccPlate';
import { occUiMessages } from './occUiMessages';
import { SIGNALS } from './statusVocabulary';

/**
 * The room a full-screen OCC map keeps at the right edge of the screen for its control column, its zoom buttons over
 * its rail (M1: the 12 px gap, the 5.5 rem rail and 12 px more; --occ-map-rail-reserve of styles/occ-map.css). No toast
 * covers it, on any OCC screen: a stack sits left of it, so it is in the same place on every screen.
 */
export const OCC_MAP_COLUMN_RESERVE_PX = 112;

/**
 * Where the stack sits (design D27; M1): fixed under the 48 px status bar, 8 px below it, so it never covers the clocks
 * or the alert count, which live in the bar; and left of the control column of a full-screen map
 * (OCC_MAP_COLUMN_RESERVE_PX from the right edge), so it never covers its zoom buttons or its rail. `className` is
 * literal so that Tailwind generates it: `top-14` is 3.5 rem (56 px) and `right-28` 7 rem (112 px); the stack keeps
 * 1 rem clear at the left of a narrow screen. Above the drawers and dialogs (`z-toast`).
 */
export const OCC_TOAST_PLACEMENT = Object.freeze({
  statusBarPx: 48,
  topPx: 56,
  rightPx: OCC_MAP_COLUMN_RESERVE_PX,
  className: 'fixed right-28 top-14 z-toast flex w-[min(24rem,calc(100vw_-_8rem))] flex-col gap-2',
});

/**
 * The places a stack can take. `statusBar` (the default) is OCC_TOAST_PLACEMENT, where the frame's own stack sits.
 * `workArea` is for a screen's own toasts (Monitoreo de vuelos, Mapa de posiciones): fixed to the bottom of the work
 * area, 24 px from the bottom, so they never pile onto the frame's stack under the status bar, and left of the map's
 * control column like it (M1), so they never cover the foot of its rail. Literal classes, so that Tailwind generates
 * them: `bottom-6` is 1.5 rem (24 px) and `right-28` 7 rem (112 px).
 */
export const OCC_TOAST_PLACEMENTS = Object.freeze({
  statusBar: OCC_TOAST_PLACEMENT,
  workArea: Object.freeze({
    bottomPx: 24,
    rightPx: OCC_MAP_COLUMN_RESERVE_PX,
    className: 'fixed bottom-6 right-28 z-toast flex w-[min(24rem,calc(100vw_-_8rem))] flex-col gap-2',
  }),
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

const priorityOf = toast => (Object.hasOwn(SIGNALS, toast.priority) ? toast.priority : 'notice');
// An urgent toast interrupts; the rest wait their turn to be read.
const roleOf = priority => (priority === 'urgent' ? 'alert' : 'status');

// What a toast says, in the stack and in the announcer alike: its signal's word, then «{tipo}, {código}».
function ToastWords({ toast, priority, language }) {
  return (
    <>
      <p className="text-xs font-semibold">{SIGNALS[priority][language]}</p>
      <p className="mt-0.5 text-sm">
        {toast.message}
        {toast.code ? <>{', '}<OccPlate kind="code" className="align-middle">{toast.code}</OccPlate></> : null}
      </p>
    </>
  );
}

/**
 * The OCC toasts (design F and D27). Each toast is `{ id, priority, message, code, action }`: `priority` is `urgent`,
 * `attention` or `notice` and draws its glyph and word; `code` (optional) is an operation code, drawn after the message
 * and a comma as a plate, «Incidencia reportada en rampa, OP-0412», so it never breaks across lines; `action`
 * (`{ label, onClick }`, «Abrir» or «Ver») runs and then closes the toast, like «Cerrar notificación» (`onDismiss(id)`).
 * An urgent toast is an `alert`, the rest are `status`: a toast never takes focus. It decides nothing about when a
 * toast shows or goes (shell/occToastQueue.js does). `placement` is a key of OCC_TOAST_PLACEMENTS: `statusBar` (default)
 * under the status bar, or `workArea` at the bottom of the work area, both left of a map's control column; an unknown
 * placement throws.
 */
export default function OccToastStack({ toasts = [], onDismiss, placement = 'statusBar', className = '' }) {
  const { t, language } = useTranslation(occUiMessages);
  if (!Object.hasOwn(OCC_TOAST_PLACEMENTS, placement)) {
    throw new RangeError(`Unknown OCC toast placement: ${String(placement)}`);
  }
  if (toasts.length === 0) return null;

  return (
    <div data-occ-toasts="" data-placement={placement} className={`${OCC_TOAST_PLACEMENTS[placement].className} ${className}`}>
      {toasts.map(toast => {
        const priority = priorityOf(toast);
        return (
          <div key={toast.id} role={roleOf(priority)} data-priority={priority}
            className={`flex items-start gap-2.5 rounded-[var(--occ-radius-overlay)] border border-occ-line-strong p-3 text-occ-text ${TONE[priority]}`}>
            <OccGlyph name={priority} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <ToastWords toast={toast} priority={priority} language={language} />
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

/**
 * The same toasts read out instead of drawn, for where the stack cannot speak: inside a modal drawer, which hides from
 * assistive technology everything outside it (shell/OccShellOverlays.jsx puts it in «Alertas y avisos»). Each toast
 * says what the stack would say, in the same role (an urgent one is an `alert`, the rest are `status`), once, when it
 * comes in. Visually hidden and without a control, it covers nothing and adds no stop for Tab.
 */
export function OccToastAnnouncer({ toasts = [] }) {
  const { language } = useTranslation(occUiMessages);
  return (
    <div data-occ-toast-announcer="" className="sr-only">
      {toasts.map(toast => {
        const priority = priorityOf(toast);
        return (
          <div key={toast.id} role={roleOf(priority)} data-priority={priority}>
            <ToastWords toast={toast} priority={priority} language={language} />
          </div>
        );
      })}
    </div>
  );
}
