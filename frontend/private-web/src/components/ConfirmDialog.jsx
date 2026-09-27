import Modal from './Modal';

export default function ConfirmDialog({ open, title, description, confirmLabel = 'Confirmar', onConfirm, onClose, busy = false }) {
  return <Modal open={open} onClose={busy ? () => {} : onClose} title={title} tone="danger" footer={<>
    <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/15">Cancelar</button>
    <button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Procesando…' : confirmLabel}</button>
  </>}>{description}</Modal>;
}
