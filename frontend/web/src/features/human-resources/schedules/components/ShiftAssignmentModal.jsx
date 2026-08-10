import { useEffect, useMemo, useState } from 'react';
import Modal from '../../../../components/Modal';
import FormField, { inputClassName } from './FormField';
import { TERMINAL_OPTIONS } from '../statusMeta';
import { formatDate, hasBlockingConflict } from '../mappers';
import { AlertTriangleIcon } from '../../../shell/components/icons';

function findMatchingBlock(shiftBlocks, shift) {
  if (!shift) return shiftBlocks[0]?.id ?? '';
  return shiftBlocks.find(block => block.startTime === shift.startTime && block.endTime === shift.endTime)?.id ?? shiftBlocks[0]?.id ?? '';
}

function buildInitialState(context, shiftBlocks) {
  const { agent, existingShift } = context ?? {};
  return {
    block: findMatchingBlock(shiftBlocks, existingShift),
    terminal: existingShift?.terminal ?? agent?.terminals?.[0] ?? 'A',
    positionId: existingShift?.positionId ?? '',
  };
}

// Modal reutilizable de asignación de turno (skill.md §"ASIGNACIÓN DE
// TURNO"), abierto desde una celda del calendario — agente y fecha ya
// quedan fijados por la celda, por eso se muestran de solo lectura (mismo
// criterio que PermitRenewalModal con el tipo de documento). Las
// validaciones (disponibilidad, conflictos de horario, habilitación) se
// recalculan en cada cambio para mostrar el aviso ANTES de intentar
// guardar, no solo como error de envío.
export default function ShiftAssignmentModal({ open, context, shiftBlocks, positions, validateAssignment, onClose, onSubmit, onRemove }) {
  const { agent, dateKey, existingShift } = context ?? {};
  const [formState, setFormState] = useState(() => buildInitialState(context, shiftBlocks));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (open) {
      setFormState(buildInitialState(context, shiftBlocks));
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context]);

  const selectedBlock = shiftBlocks.find(block => block.id === formState.block);

  const conflicts = useMemo(() => {
    if (!open || !agent || !dateKey || !selectedBlock) return [];
    return validateAssignment({
      agentId: agent.agentId,
      date: dateKey,
      startTime: selectedBlock.startTime,
      endTime: selectedBlock.endTime,
      terminal: formState.terminal,
      positionId: formState.positionId || null,
      excludeShiftId: existingShift?.id,
    });
  }, [open, agent, dateKey, selectedBlock, formState.terminal, formState.positionId, existingShift, validateAssignment]);

  if (!agent || !dateKey) return null;

  const blocked = hasBlockingConflict(conflicts);

  function update(patch) {
    setFormState(current => ({ ...current, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || blocked || !selectedBlock) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        id: existingShift?.id,
        agentId: agent.agentId,
        date: dateKey,
        startTime: selectedBlock.startTime,
        endTime: selectedBlock.endTime,
        terminal: formState.terminal,
        positionId: formState.positionId || null,
      });
      onClose();
    } catch (error) {
      setSubmitError(error?.message ?? 'No fue posible guardar la asignación. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!existingShift || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onRemove(existingShift.id);
      onClose();
    } catch (error) {
      setSubmitError(error?.message ?? 'No fue posible quitar el turno. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={existingShift ? 'Editar turno' : 'Asignar turno'}
      widthClassName="max-w-md"
      footer={
        <>
          {existingShift && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={submitting}
              className="mr-auto rounded-lg border border-status-danger/30 px-4 py-2 text-sm font-medium text-status-danger hover:bg-status-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Quitar turno
            </button>
          )}
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
            form="shift-assignment-form"
            disabled={submitting || blocked}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Guardar turno'}
          </button>
        </>
      }
    >
      <form id="shift-assignment-form" onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {agent.agentName} · {agent.employeeNumber} · {formatDate(dateKey)}
        </p>

        <FormField label="Bloque de turno" required>
          <select className={inputClassName} value={formState.block} onChange={event => update({ block: event.target.value })}>
            {shiftBlocks.map(block => (
              <option key={block.id} value={block.id}>
                {block.label} ({block.startTime}–{block.endTime})
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Terminal" required>
          <select className={inputClassName} value={formState.terminal} onChange={event => update({ terminal: event.target.value })}>
            {TERMINAL_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                Terminal {option.value}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Posición" hint="Opcional: déjala en blanco si el turno aún no tiene posición asignada.">
          <select className={inputClassName} value={formState.positionId} onChange={event => update({ positionId: event.target.value })}>
            <option value="">Sin posición asignada</option>
            {positions.map(position => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </select>
        </FormField>

        {conflicts.map((conflict, index) => (
          <p
            key={index}
            role="alert"
            className={`flex items-start gap-2 rounded-lg p-3 text-xs ${
              conflict.severity === 'block' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-warning/10 text-status-warning'
            }`}
          >
            <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {conflict.message}
          </p>
        ))}

        {submitError && (
          <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
}
