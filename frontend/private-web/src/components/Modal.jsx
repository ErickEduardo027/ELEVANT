import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useDialogFocus } from '../hooks/useDialogFocus';

// Modal centrado genérico, generalizado del patrón de confirmación de
// `feat/adminocc` (ApprovalConfirmation / ReturnCorrectionModal).
// `widthClassName` es opcional (por defecto `max-w-md`, el ancho original)
// para permitir contenido más ancho (p. ej. detalle + historial) sin romper
// ningún uso existente. En teléfono se presenta como hoja inferior y el cuerpo
// desplaza su contenido cuando no cabe en la altura visible.
export default function Modal({ open, onClose, title, children, footer, tone = 'default', widthClassName = 'max-w-md' }) {
  useEscapeToClose(open, onClose);
  const dialogRef = useDialogFocus(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center sm:items-center sm:p-4">
      <div onClick={onClose} className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role={tone === 'danger' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-black/5 bg-white shadow-2xl dark:border-white/5 dark:bg-surface-dark-card sm:max-h-[90dvh] sm:rounded-2xl ${widthClassName}`}
      >
        <h2 className="px-5 pt-5 text-base font-semibold text-ink-900 dark:text-text-primary-dark sm:px-6 sm:pt-6">{title}</h2>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5 text-sm text-text-secondary-light dark:text-text-secondary-dark sm:px-6">{children}</div>
        {footer
          ? <div className="flex flex-wrap justify-end gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pb-6">{footer}</div>
          : <div className="pb-5 sm:pb-6" />}
      </div>
    </div>
  );
}
