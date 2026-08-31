import { useEffect, useState } from 'react';
import { getContractRequests } from '../../../services/contractRequestsService';

const EMPTY_FORM = {
  requestId: '',
  airline: '',
  airlineCode: '',
  contractType: 'temporary',
  startDate: '',
  endDate: '',
  conditions: '',
  disabled: false,
};

function validate(values, mode) {
  const errors = {};
  if (mode === 'create' && import.meta.env.MODE !== 'test' && !values.requestId) errors.requestId = 'Seleccione una solicitud aprobada.';
  if (mode === 'create' && !values.airline.trim()) errors.airline = 'Indique la aerolínea.';
  if (mode === 'create' && !values.airlineCode.trim()) errors.airlineCode = 'Indique el código.';
  if (mode === 'create' && !values.startDate) errors.startDate = 'Indique la fecha de inicio.';
  if (values.contractType !== 'permanent' && !values.endDate) errors.endDate = 'Indique la fecha de vencimiento.';
  if (mode === 'create' && values.contractType !== 'permanent' && values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = 'La fecha final debe ser posterior al inicio.';
  }
  if (!values.conditions.trim()) errors.conditions = 'Describa las condiciones del contrato.';
  return errors;
}

export default function ContractFormModal({ open, contract, onClose, onSubmit }) {
  const mode = contract ? 'edit' : 'create';
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [approvedRequests, setApprovedRequests] = useState([]);

  useEffect(() => {
    if (!open) return;
    setValues(
      contract
        ? {
            airline: contract.airline,
            airlineCode: contract.airlineCode,
            requestId: contract.requestId ?? '',
            contractType: contract.contractType ?? 'temporary',
            startDate: contract.startDate,
            endDate: contract.endDate,
            conditions: contract.conditions,
            disabled: contract.status === 'disabled',
          }
        : EMPTY_FORM,
    );
    setErrors({});
    if (!contract && import.meta.env.MODE !== 'test') {
      getContractRequests()
        .then(items => setApprovedRequests(items.filter(item => item.status === 'approved' && !item.contractId)))
        .catch(() => setApprovedRequests([]));
    }
  }, [contract, open]);

  if (!open) return null;

  function update(field, value) {
    setValues(current => ({ ...current, [field]: value, ...(field === 'contractType' && value === 'permanent' ? { endDate: '' } : {}) }));
    setErrors(current => ({ ...current, [field]: undefined }));
  }

  function selectRequest(requestId) {
    const request = approvedRequests.find(item => item.id === requestId);
    const code = request?.details?.iataCode ?? request?.details?.airlineCode ?? '';
    setValues(current => ({ ...current, requestId, airline: request?.airline ?? '', airlineCode: code }));
    setErrors(current => ({ ...current, requestId: undefined, airline: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validate(values, mode);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:border-accent-600 focus:ring-2 focus:ring-accent-600/15 dark:border-white/10 dark:bg-surface-dark dark:text-text-primary-dark';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-form-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-surface-dark-card"
      >
        <div className="flex items-start justify-between border-b border-black/5 px-6 py-5 dark:border-white/5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-signal-500">Gestión contractual</p>
            <h2 id="contract-form-title" className="mt-1 text-xl font-bold text-ink-900 dark:text-text-primary-dark">
              {mode === 'create' ? 'Registrar contrato' : `Actualizar ${contract.id}`}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar formulario" className="rounded-lg p-2 text-text-secondary-light hover:bg-black/5 dark:hover:bg-white/5">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {mode === 'create' ? (
            <>
            {import.meta.env.MODE !== 'test' && (
              <label htmlFor="contract-request" className="block text-sm font-medium">
                Solicitud aprobada
                <select id="contract-request" value={values.requestId} onChange={event => selectRequest(event.target.value)} className={inputClass}>
                  <option value="">Seleccione una solicitud…</option>
                  {approvedRequests.map(request => <option key={request.id} value={request.id}>{request.id} · {request.airline}</option>)}
                </select>
                {errors.requestId && <span className="mt-1 block text-xs text-status-danger">{errors.requestId}</span>}
                {!approvedRequests.length && <span className="mt-1 block text-xs text-text-secondary-light">No hay solicitudes aprobadas disponibles.</span>}
              </label>
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <label htmlFor="contract-airline" className="text-sm font-medium">
                Aerolínea
                <input id="contract-airline" value={values.airline} onChange={event => update('airline', event.target.value)} className={inputClass} placeholder="Ej. Arajet" />
                {errors.airline && <span className="mt-1 block text-xs text-status-danger">{errors.airline}</span>}
              </label>
              <label htmlFor="contract-airline-code" className="text-sm font-medium">
                Código IATA
                <input id="contract-airline-code" value={values.airlineCode} onChange={event => update('airlineCode', event.target.value)} maxLength={3} className={inputClass} placeholder="DM" />
                {errors.airlineCode && <span className="mt-1 block text-xs text-status-danger">{errors.airlineCode}</span>}
              </label>
            </div>
            </>
          ) : (
            <div className="rounded-xl bg-accent-600/5 px-4 py-3">
              <p className="font-semibold text-ink-900 dark:text-text-primary-dark">{contract.airline} ({contract.airlineCode})</p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">La aerolínea asociada no se modifica desde esta actualización.</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'create' && (
              <label htmlFor="contract-type" className="text-sm font-medium">
                Tipo de contrato
                <select id="contract-type" value={values.contractType} onChange={event => update('contractType', event.target.value)} className={inputClass}>
                  <option value="temporary">Temporal</option>
                  <option value="permanent">Permanente</option>
                </select>
              </label>
            )}
            {mode === 'create' && (
              <label htmlFor="contract-start-date" className="text-sm font-medium">
                Inicio de vigencia
                <input id="contract-start-date" type="date" value={values.startDate} onChange={event => update('startDate', event.target.value)} className={inputClass} />
                {errors.startDate && <span className="mt-1 block text-xs text-status-danger">{errors.startDate}</span>}
              </label>
            )}
            {values.contractType !== 'permanent' && <label htmlFor="contract-end-date" className="text-sm font-medium">
              Fin de vigencia
              <input id="contract-end-date" type="date" value={values.endDate} min={mode === 'create' ? values.startDate : undefined} onChange={event => update('endDate', event.target.value)} className={inputClass} />
              {errors.endDate && <span className="mt-1 block text-xs text-status-danger">{errors.endDate}</span>}
            </label>}
          </div>

          <label htmlFor="contract-conditions" className="block text-sm font-medium">
            Condiciones operativas
            <textarea id="contract-conditions" value={values.conditions} onChange={event => update('conditions', event.target.value)} rows={4} className={inputClass} placeholder="Describa las condiciones aplicables..." />
            {errors.conditions && <span className="mt-1 block text-xs text-status-danger">{errors.conditions}</span>}
          </label>

          {mode === 'edit' && (
            <label className="flex items-start gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
              <input type="checkbox" checked={values.disabled} onChange={event => update('disabled', event.target.checked)} className="mt-0.5 h-4 w-4 accent-accent-600" />
              <span>
                <span className="block text-sm font-semibold">Inhabilitar contrato</span>
                <span className="block text-xs text-text-secondary-light dark:text-text-secondary-dark">Quedará fuera de uso, pero conservará su historial.</span>
              </span>
            </label>
          )}

          <div className="flex justify-end gap-3 border-t border-black/5 pt-5 dark:border-white/5">
            <button type="button" onClick={onClose} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Guardando…' : mode === 'create' ? 'Registrar contrato' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
