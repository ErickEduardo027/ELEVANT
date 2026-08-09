import { useEscapeToClose } from '../hooks/useEscapeToClose';

// Modal centrado genérico, generalizado del patrón de confirmación de
// `feat/adminocc` (ApprovalConfirmation / ReturnCorrectionModal).
// `widthClassName` es opcional (por defecto `max-w-md`, el ancho original)
// para permitir contenido más ancho (p. ej. detalle + historial) sin romper
// ningún uso existente.
export default function Modal({ open, onClose, title, children, footer, tone = 'default', widthClassName = 'max-w-md' }) {
  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div
        role={tone === 'danger' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${widthClassName} rounded-2xl border border-black/5 bg-white p-6 shadow-2xl dark:border-white/5 dark:bg-surface-dark-card`}
      >
        <h2 className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
        <div className="mt-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
