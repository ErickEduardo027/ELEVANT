import { useState } from 'react';
import Modal from '../../../components/Modal';
import { addPreinvoiceAdjustment, editPreinvoiceLine, formatMoney } from '../../../services/financeBookService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const KIND_LABELS = { Service: 'Servicio', Charge: 'Cargo', Adjustment: 'Ajuste' };

/**
 * Lines of a preinvoice: each service with the charges the agent marked and any
 * Finance adjustment beneath it. In a draft, Finance can change a charge or
 * service amount, exclude a charge, or add a manual charge or discount.
 */
export default function PreinvoiceLinesEditor({ preinvoice, canEdit, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const currency = preinvoice.currencyCode;
  const editable = canEdit && preinvoice.status === 'Draft' && Boolean(preinvoice.version);
  const lines = preinvoice.lines ?? [];
  const roots = lines.filter(line => !line.parentLineId);
  const childrenOf = id => lines.filter(line => line.parentLineId === id);

  function open(kind, line = null) {
    setEditing({ kind, line });
    setForm(kind === 'adjust'
      ? { description: '', amount: '', reason: '', parentLineId: line?.id ?? '' }
      : { amount: line.amount, exclude: false, reason: line.adjustmentReason ?? '' });
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing.kind === 'adjust') {
        await addPreinvoiceAdjustment(preinvoice.id, { description: form.description.trim(), amount: Number(form.amount),
          reason: form.reason.trim(), expectedVersion: preinvoice.version, parentLineId: form.parentLineId || null });
      } else {
        await editPreinvoiceLine(preinvoice.id, editing.line.id, { amount: form.exclude ? null : Number(form.amount),
          exclude: Boolean(form.exclude), reason: form.reason.trim(), expectedVersion: preinvoice.version });
      }
      setEditing(null);
      onChanged(editing.kind === 'adjust' ? 'Ajuste añadido.' : 'Línea actualizada.');
    } catch (failure) {
      setError(failure.status === 409 ? 'La prefactura cambió o ya no es un borrador. Se actualizará.' : failure.message);
      if (failure.status === 409) onChanged('');
    } finally {
      setBusy(false);
    }
  }

  function Line({ line, nested }) {
    const edited = line.computedAmount !== null && line.computedAmount !== undefined && line.computedAmount !== line.amount;
    return (
      <li className={`flex flex-wrap items-start justify-between gap-2 py-2 ${nested ? 'ml-4 border-l border-black/10 pl-3 dark:border-white/10' : ''} ${line.isExcluded ? 'opacity-60' : ''}`}>
        <div className="min-w-0">
          <p className="text-sm">
            <span className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-white/10">{KIND_LABELS[line.kind] ?? line.kind}</span>
            {line.kind === 'Service' ? `${line.operationCode} · ` : ''}{line.serviceName}
            {line.isExcluded && <span className="ml-1 text-xs text-status-danger">excluido</span>}
          </p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {line.executedQuantity} {line.billingUnit}{edited ? ` · calculado ${formatMoney(line.computedAmount, currency)}` : ''}
            {line.adjustmentReason ? ` · ${line.adjustmentReason}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`tabular-nums font-semibold ${line.amount < 0 ? 'text-status-success' : ''}`}>{formatMoney(line.amount, currency)}</span>
          {editable && line.kind !== 'Adjustment' && (
            <button type="button" onClick={() => open('edit', line)} className="min-h-[32px] text-xs font-semibold text-accent-600"
              aria-label={`Editar ${line.serviceName}`}>Editar</button>
          )}
          {editable && line.kind === 'Service' && (
            <button type="button" onClick={() => open('adjust', line)} className="min-h-[32px] text-xs font-semibold text-accent-600"
              aria-label={`Ajustar ${line.serviceName}`}>Ajuste</button>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="mt-3">
      <ul className="divide-y divide-black/5 dark:divide-white/5">
        {roots.map(line => (
          <li key={line.id}>
            <ul>
              <Line line={line} />
              {childrenOf(line.id).map(child => <Line key={child.id} line={child} nested />)}
            </ul>
          </li>
        ))}
      </ul>
      {editable && (
        <button type="button" onClick={() => open('adjust')} className="mt-3 min-h-[36px] rounded-lg border border-accent-600 px-3 text-xs font-semibold text-accent-600">
          Añadir ajuste general
        </button>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)}
        title={editing?.kind === 'adjust' ? 'Añadir cargo o descuento' : `Editar ${editing?.line?.serviceName ?? ''}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="preinvoice-line-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar'}</button></div>}>
        <form id="preinvoice-line-form" onSubmit={submit} className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          {editing?.kind === 'adjust' ? (
            <>
              <label className="block text-xs font-semibold">Descripción<input required minLength={3} maxLength={160} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} className={fieldClass} /></label>
              <label className="block text-xs font-semibold">Importe ({currency}; negativo para un descuento)<input required type="number" step="0.01" value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} className={fieldClass} /></label>
            </>
          ) : (
            <>
              {editing?.line?.computedAmount !== null && editing?.line?.computedAmount !== undefined &&
                <p className="text-xs text-text-secondary-light">Valor calculado por ELEVANT: {formatMoney(editing.line.computedAmount, currency)}</p>}
              {editing?.line?.kind === 'Charge' && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.exclude} onChange={event => setForm(current => ({ ...current, exclude: event.target.checked }))} />No cobrar este cargo</label>
              )}
              {!form.exclude && <label className="block text-xs font-semibold">Importe facturado ({currency})<input required type="number" min="0" step="0.01" value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} className={fieldClass} /></label>}
            </>
          )}
          <label className="block text-xs font-semibold">Motivo (lo verá la aerolínea)<textarea required minLength={3} maxLength={500} rows={2} value={form.reason ?? ''} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
        </form>
      </Modal>
    </div>
  );
}
