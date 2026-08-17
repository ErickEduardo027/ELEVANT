export default function ApprovalConfirmation({ open, count = 1, onConfirm, onCancel }) {
  if (!open) return null;
  const isBulk = count > 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/30 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approval-confirmation-title"
        onClick={event => event.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-2xl border border-black/5 bg-white/95 p-4 shadow-lg backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
      >
        <h3 id="approval-confirmation-title" className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          Aprobar operación{isBulk ? 'es' : ''}
        </h3>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {isBulk
            ? `Está a punto de aprobar ${count} operaciones. No podrá deshacer esta acción una vez confirmada.`
            : 'Confirme que la operación ha sido revisada y cumple con los requisitos para pasar a Finanzas.'}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-status-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-status-success/90"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
