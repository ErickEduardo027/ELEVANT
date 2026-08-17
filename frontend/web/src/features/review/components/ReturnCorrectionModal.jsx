import { useState } from 'react';

export default function ReturnCorrectionModal({ open, count = 1, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const isValid = reason.trim().length > 0;

  function handleConfirm() {
    if (!isValid) return;
    onConfirm(reason.trim());
    setReason('');
  }

  function handleCancel() {
    setReason('');
    onCancel();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/40 p-4" onClick={handleCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-correction-title"
        onClick={event => event.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-2xl border border-black/5 bg-white/95 p-5 shadow-lg backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
      >
        <h3 id="return-correction-title" className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          Devolver con correcciones{count > 1 ? ` (${count} operaciones)` : ''}
        </h3>
        <label className="block space-y-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          Motivo de devolución
          <textarea
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Indique qué información debe corregirse o completarse."
            rows={4}
            className="w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isValid}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              isValid
                ? 'bg-status-danger text-white hover:bg-status-danger/90'
                : 'cursor-not-allowed bg-status-danger/30 text-white/70'
            }`}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
