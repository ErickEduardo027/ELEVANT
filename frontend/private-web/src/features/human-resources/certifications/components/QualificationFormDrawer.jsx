import { useEffect, useState } from 'react';
import Drawer from '../../../../components/Drawer';
import FormField, { inputClassName } from './FormField';
import { DEFAULT_CERTIFYING_ENTITY } from '../statusMeta';

function buildInitialState(defaultAgentId) {
  return {
    agentId: defaultAgentId ?? '',
    equipmentId: '',
    trainingDate: '',
    obtainedAt: '',
    expiresAt: '',
    certifyingEntity: DEFAULT_CERTIFYING_ENTITY,
    instructor: '',
    notes: '',
    supportDocumentName: '',
  };
}

function isFormValid(formState) {
  return Boolean(
    formState.agentId &&
      formState.equipmentId &&
      formState.trainingDate &&
      formState.obtainedAt &&
      formState.expiresAt &&
      formState.certifyingEntity.trim() &&
      formState.instructor.trim()
  );
}

// Registro de una nueva habilitación (skill.md §"REGISTRAR NUEVA
// HABILITACIÓN"), reutilizando el patrón Drawer + FormField de
// UserFormDrawer. `ALC` aparece como entidad certificadora por defecto,
// pero es un dato del modelo (statusMeta.js), no un texto rígido aquí.
export default function QualificationFormDrawer({ open, onClose, agents, equipmentCatalog, defaultAgentId, onSubmit }) {
  const [formState, setFormState] = useState(() => buildInitialState(defaultAgentId));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (open) {
      setFormState(buildInitialState(defaultAgentId));
      setSubmitError(null);
    }
  }, [open, defaultAgentId]);

  const valid = isFormValid(formState);

  function update(patch) {
    setFormState(current => ({ ...current, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || !valid) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        agentId: formState.agentId,
        equipmentId: formState.equipmentId,
        trainingDate: new Date(`${formState.trainingDate}T00:00:00-04:00`).toISOString(),
        obtainedAt: new Date(`${formState.obtainedAt}T00:00:00-04:00`).toISOString(),
        expiresAt: new Date(`${formState.expiresAt}T00:00:00-04:00`).toISOString(),
        certifyingEntity: formState.certifyingEntity.trim(),
        instructor: formState.instructor.trim(),
        notes: formState.notes.trim() || undefined,
        supportDocument: formState.supportDocumentName.trim() ? { name: formState.supportDocumentName.trim(), url: '#' } : null,
      });
      onClose();
    } catch (error) {
      setSubmitError(error?.message ?? 'No fue posible registrar la habilitación. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Agregar habilitación"
      description="Registra una nueva habilitación otorgada por la entidad certificadora."
      widthClassName="lg:w-[480px]"
      footer={
        <div className="flex items-center justify-end gap-2">
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
            form="qualification-form"
            disabled={submitting || !valid}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Registrar habilitación'}
          </button>
        </div>
      }
    >
      <form id="qualification-form" onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Agente" required>
          <select className={inputClassName} value={formState.agentId} onChange={event => update({ agentId: event.target.value })} disabled={Boolean(defaultAgentId)}>
            <option value="">Seleccione un agente</option>
            {agents.map(agent => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.agentName} · {agent.employeeNumber}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Tipo de equipo" required>
          <select className={inputClassName} value={formState.equipmentId} onChange={event => update({ equipmentId: event.target.value })}>
            <option value="">Seleccione un equipo</option>
            {equipmentCatalog.map(equipment => (
              <option key={equipment.id} value={equipment.id}>
                {equipment.name}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Fecha de entrenamiento" required>
            <input type="date" className={inputClassName} value={formState.trainingDate} onChange={event => update({ trainingDate: event.target.value })} />
          </FormField>
          <FormField label="Fecha de obtención" required>
            <input type="date" className={inputClassName} value={formState.obtainedAt} onChange={event => update({ obtainedAt: event.target.value })} />
          </FormField>
          <FormField label="Fecha de vencimiento" required>
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
    </Drawer>
  );
}
