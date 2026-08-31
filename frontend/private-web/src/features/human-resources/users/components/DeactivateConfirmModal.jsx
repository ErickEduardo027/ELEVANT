import Modal from '../../../../components/Modal';

// skill.md §15: confirmación obligatoria antes de desactivar, incluyendo el
// nombre del usuario y aclarando que no se pierde historial.
export default function DeactivateConfirmModal({ open, onClose, user, onConfirm, submitting }) {
  if (!user) return null;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="¿Desactivar esta cuenta?"
      tone="danger"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Desactivando…' : 'Desactivar cuenta'}
          </button>
        </>
      }
    >
      <p>
        <span className="font-medium text-ink-900 dark:text-text-primary-dark">{user.fullName}</span> perderá el acceso a
        los portales asociados hasta que la cuenta vuelva a activarse. El historial de la cuenta se conserva.
      </p>
    </Modal>
  );
}
