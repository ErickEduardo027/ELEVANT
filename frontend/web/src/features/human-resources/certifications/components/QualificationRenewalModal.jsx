import { useEffect, useState } from 'react';
import Modal from '../../../../components/Modal';
import FormField, { inputClassName } from './FormField';

function toDateInputValue(isoString) {
  return isoString ? isoString.slice(0, 10) : '';
}

function buildInitialState(item) {
  const record = item?.record;
  return {
    obtainedAt: toDateInputValue(new Date().toISOString()),
    expiresAt: '',
    certifyingEntity: record?.certifyingEntity ?? '',
    instructor: record?.instructor ?? '',
    notes: '',
    supportDocumentName: '',
  };
}

// Formulario corto de renovación (skill.md §"REGISTRAR RENOVACIÓN"). No
// borra el historial anterior: el servicio agrega un evento nuevo y
// conserva los previos.
export default function QualificationRenewalModal({ open, onClose, item, onSubmit }) {
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

  const valid = Boolean(formState.obtainedAt && formState.expiresAt && formState.certifyingEntity.trim() && formState.instructor.trim());

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
        obtainedAt: new Date(`${formState.obtainedAt}T00:00:00-04:00`).toISOString(),
        expiresAt: new Date(`${formState.expiresAt}T00:00:00-04:00`).toISOString(),
        certifyingEntity: formState.certifyingEntity.trim(),
        instructor: formState.instructor.trim(),
        notes: formState.notes.trim() || undefined,
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
      title={`Registrar renovación — ${item.equipmentName}`}
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
            form="qualification-renewal-form"
            disabled={submitting || !valid}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Registrar renovación'}
          </button>
        </>
      }
    >
      <form id="qualification-renewal-form" onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {item.agentName} · {item.employeeNumber}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nueva fecha de obtención" required>
            <input type="date" className={inputClassName} value={formState.obtainedAt} onChange={event => update({ obtainedAt: event.target.value })} />
          </FormField>
          <FormField label="Nueva fecha de vencimiento" required>
            <input type="date" className={inputClassName} value={formState.expiresAt} onChange={event => update({ expiresAt: event.target.value })} />
          </FormField>
        </div>
        <FormField label="Entidad certificadora" required>
          <input className={inputClassName} value={formState.certifyingEntity} onChange={event => update({ certifyingEntity: event.target.value })} />
        </FormField>
        <FormField label="Instructor / evaluador" required>
          <input className={inputClassName} value={formState.instructor} onChange={event => update({ instructor: event.target.value })} />
        </FormField>
        <FormField label="Observaciones">
          <textarea rows={2} className={inputClassName} value={formState.notes} onChange={event => update({ notes: event.target.value })} />
        </FormField>
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
