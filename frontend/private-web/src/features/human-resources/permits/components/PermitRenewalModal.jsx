import { useEffect, useState } from 'react';
import Modal from '../../../../components/Modal';
import FormField, { inputClassName } from './FormField';

function toDateInputValue(isoString) {
  return isoString ? isoString.slice(0, 10) : '';
}

function buildInitialState(item) {
  const record = item?.record;
  return {
    number: record?.number ?? '',
    issuedAt: toDateInputValue(new Date().toISOString()),
    expiresAt: '',
    supportDocumentName: '',
  };
}

// Formulario reutilizable de renovación (skill.md §"RENOVACIÓN"): mismo
// componente para carnet y licencia, según el `item` con el que se abra.
// El tipo de documento se muestra de solo lectura porque la renovación está
// atada a un documento existente — cambiarlo aquí no tendría un documento
// destino válido. No borra el historial anterior: el servicio agrega un
// evento nuevo y conserva los previos.
export default function PermitRenewalModal({ open, onClose, item, onSubmit }) {
  const [formState, setFormState] = useState(() => buildInitialState(item));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (open) {
      setFormState(buildInitialState(item));
      setSubmitError(null);
    }
  }, [open, item]);

  if (!item) return null;

  const valid = Boolean(formState.number.trim() && formState.issuedAt && formState.expiresAt);

  function update(patch) {
    setFormState(current => ({ ...current, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || !valid) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(item, {
        number: formState.number.trim(),
        issuedAt: new Date(`${formState.issuedAt}T00:00:00-04:00`).toISOString(),
        expiresAt: new Date(`${formState.expiresAt}T00:00:00-04:00`).toISOString(),
        supportDocument: formState.supportDocumentName.trim() ? { name: formState.supportDocumentName.trim(), url: '#' } : null,
      });
      onClose();
    } catch (error) {
      setSubmitError(error?.message ?? 'No fue posible registrar la renovación. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={`Registrar renovación — ${item.typeLabel}`}
      widthClassName="max-w-md"
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
            type="submit"
            form="permit-renewal-form"
            disabled={submitting || !valid}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Registrar renovación'}
          </button>
        </>
      }
    >
      <form id="permit-renewal-form" onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {item.agentName} · {item.employeeNumber}
        </p>

        <FormField label="Tipo de documento">
          <input className={inputClassName} value={item.typeLabel} disabled />
        </FormField>

        <FormField label="Número" required>
          <input className={inputClassName} value={formState.number} onChange={event => update({ number: event.target.value })} />
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Fecha de emisión" required>
            <input type="date" className={inputClassName} value={formState.issuedAt} onChange={event => update({ issuedAt: event.target.value })} />
          </FormField>
          <FormField label="Fecha de vencimiento" required>
            <input type="date" className={inputClassName} value={formState.expiresAt} onChange={event => update({ expiresAt: event.target.value })} />
          </FormField>
        </div>

        <FormField label="Documento de soporte (opcional)" hint="Se adjuntará cuando exista almacenamiento de archivos en el backend.">
          <input className={inputClassName} value={formState.supportDocumentName} onChange={event => update({ supportDocumentName: event.target.value })} />
        </FormField>

        {submitError && (
          <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
}
