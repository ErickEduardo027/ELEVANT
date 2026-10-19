'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../../../components/Modal';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { formatTreasuryMoney as money, getTreasuryAdjustments, issueTreasuryAdjustment, parseTreasuryAmount,
  treasuryError, treasuryIntent, treasuryToday } from '../../../services/financeTreasuryService';

const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const primary = 'min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

export default function AdjustmentNotesPanel({ invoiceId, invoiceNumber, currencyCode, onChanged, onOpenInvoice }) {
  const { access } = useDepartmentAccess(); const canRead = Boolean(access?.can('finance.adjustments.read'));
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [form, setForm] = useState(null); const [busy, setBusy] = useState(false);
  const submitting = useRef(false); const intent = useRef(null);
  const load = useCallback(signal => {
    if (!canRead || !invoiceId) return Promise.resolve();
    return getTreasuryAdjustments(invoiceId, { signal }).then(
      response => { if (!signal?.aborted) { setData(response); setError(''); } },
      failure => { if (!signal?.aborted) { setData(null); setError(treasuryError(failure)); } },
    );
  }, [canRead, invoiceId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function open() { intent.current = null; setError(''); setForm({ source: data, kind: 'Credit', effectiveOn: treasuryToday(), reason: '', relatedNoteId: '', values: {} }); }
  function close() { if (!submitting.current) setForm(null); }
  function update(lineId, key, value) { setForm(current => ({ ...current, values: { ...current.values, [lineId]: { ...current.values[lineId], [key]: value } } })); }
  async function submit(event) {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError('');
    try {
      const lines = form.source.lines.filter(l => {
        const values = form.values[l.invoiceLineId]; return values && (values.quantity !== '' && values.quantity !== undefined || values.amount !== '' && values.amount !== undefined);
      }).map(l => {
        const values = form.values[l.invoiceLineId];
        const maxQuantity = form.kind === 'Credit' ? l.creditQuantityRemaining : l.debitQuantityRemaining;
        const maxAmount = form.kind === 'Credit' ? l.creditAmountRemaining : l.debitAmountRemaining;
        const quantity = parseTreasuryAmount(values.quantity, { allowZero: maxQuantity === 0 }); const amount = parseTreasuryAmount(values.amount);
        if (quantity > maxQuantity || amount > maxAmount) throw new Error('La nota supera la cantidad o el importe restante de una línea.');
        return { invoiceLineId: l.invoiceLineId, quantity, amount };
      });
      if (!lines.length || form.reason.trim().length < 3) throw new Error('Complete al menos una línea y un motivo válido.');
      const payload = { expectedVersion: form.source.version, effectiveOn: form.effectiveOn, reason: form.reason.trim(), kind: form.kind, lines, relatedNoteId: form.relatedNoteId || null };
      intent.current = treasuryIntent(intent.current, payload);
      await issueTreasuryAdjustment(invoiceId, intent.current.body); setForm(null); setNotice('Nota emitida. Los cobros y las devoluciones se gestionan por separado.');
      await load(); onChanged?.();
    } catch (failure) { setError(treasuryError(failure)); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (!canRead) return <p className="text-sm">No tiene permiso para consultar notas de ajuste.</p>;
  return <section className="space-y-3" aria-label="Notas de ajuste">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Notas de ajuste{invoiceNumber && ' · ' + invoiceNumber}</h3>
      {data && access?.can('finance.adjustments.issue') && <button type="button" onClick={open} className={primary}>Emitir nota</button>}</div>
    {onOpenInvoice && <button type="button" onClick={() => onOpenInvoice(invoiceId)} className="min-h-[36px] text-sm text-accent-600">Ver factura vinculada</button>}
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && !form && <p role="alert" className="text-sm text-status-danger">{error} <button type="button" className="font-semibold" onClick={() => void load()}>Reintentar</button></p>}
    {!data ? !error && <p role="status">Cargando notas…</p> : <>
      {data.legacyCredited > 0 && <p className="text-xs">Créditos históricos: {money(data.legacyCredited, currencyCode)}. El límite disponible ya reserva ese importe.</p>}
      {!data.notes.length && <p className="text-sm text-text-secondary-light">Sin notas de ajuste emitidas.</p>}
      <ul className="space-y-2">{data.notes.map(note => <li id={'adjustment-' + note.id} key={note.id} className="space-y-1 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
        <p className="font-semibold">{note.kind === 'Credit' ? 'Crédito' : 'Débito'} · {note.number} · {money(note.amount, note.currencyCode)}</p>
        <p>{note.effectiveOn} · {note.reason}</p>
        {note.relatedNoteId && <a href={'#adjustment-' + note.relatedNoteId} className="text-accent-600">Nota vinculada: {data.notes.find(n => n.id === note.relatedNoteId)?.number ?? 'Ver referencia'}</a>}
        <p className="text-xs">{note.lines.length} {note.lines.length === 1 ? 'línea vinculada a la factura' : 'líneas vinculadas a la factura'}</p>
      </li>)}</ul>
    </>}
    <Modal open={Boolean(form)} onClose={close} title="Emitir nota de ajuste" widthClassName="max-w-2xl" footer={<><button type="button" disabled={busy} onClick={close} className="min-h-[40px] rounded-lg border px-4 py-2 text-sm">Cancelar</button>
      <button type="submit" form="treasury-adjustment-form" disabled={busy} className={primary}>{busy ? 'Guardando…' : 'Confirmar nota'}</button></>}>
      {form && <form id="treasury-adjustment-form" onSubmit={submit} className="space-y-3 pb-1">
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-status-danger">{error}</p>}
        <label className="block text-xs font-semibold">Tipo de nota<select value={form.kind} disabled={busy} onChange={event => { intent.current = null; setForm(current => ({ ...current, kind: event.target.value, values: {} })); }} className={field}><option value="Credit">Crédito</option><option value="Debit">Débito</option></select></label>
        <p className="text-xs">Complete las líneas a ajustar. Los máximos corresponden al remanente de cada línea y a los créditos históricos.</p>
        <div className="max-h-72 space-y-3 overflow-y-auto">{form.source.lines.map(line => {
          const quantity = form.kind === 'Credit' ? line.creditQuantityRemaining : line.debitQuantityRemaining;
          const amount = form.kind === 'Credit' ? line.creditAmountRemaining : line.debitAmountRemaining;
          return <fieldset key={line.invoiceLineId} className="rounded-lg border border-black/10 p-3 dark:border-white/10"><legend className="px-1 text-xs font-semibold">Línea {line.lineNumber}</legend><div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Cantidad línea {line.lineNumber}<input type="number" min={quantity === 0 ? 0 : '0.0001'} max={quantity} step="0.0001" value={form.values[line.invoiceLineId]?.quantity ?? ''} disabled={busy || amount <= 0} onChange={event => update(line.invoiceLineId, 'quantity', event.target.value)} className={field} /></label>
            <label className="text-xs">Importe línea {line.lineNumber} ({currencyCode ?? 'moneda de factura'})<input type="number" min="0.0001" max={amount} step="0.0001" value={form.values[line.invoiceLineId]?.amount ?? ''} disabled={busy || amount <= 0} onChange={event => update(line.invoiceLineId, 'amount', event.target.value)} className={field} /></label>
          </div></fieldset>;
        })}</div>
        <label className="block text-xs font-semibold">Nota relacionada (opcional)<select value={form.relatedNoteId} disabled={busy} onChange={event => setForm(current => ({ ...current, relatedNoteId: event.target.value }))} className={field}><option value="">Sin referencia adicional</option>{form.source.notes.map(note => <option key={note.id} value={note.id}>{note.number}</option>)}</select></label>
        <label className="block text-xs font-semibold">Fecha de la nota<input required type="date" value={form.effectiveOn} max={treasuryToday()} disabled={busy} onChange={event => setForm(current => ({ ...current, effectiveOn: event.target.value }))} className={field} /></label>
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={1000} value={form.reason} rows={3} disabled={busy} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={field} /></label>
      </form>}
    </Modal>
  </section>;
}
