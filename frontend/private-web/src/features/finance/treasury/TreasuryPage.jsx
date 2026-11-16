'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer';
import Modal from '../../../components/Modal';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { applyTreasuryReceipt, formatTreasuryMoney as money, getTreasuryOptions, getTreasuryReceipt,
  getTreasuryStatement, listTreasuryReceipts, parseTreasuryAmount, recordTreasuryReceipt, refundTreasuryReceipt,
  reverseTreasuryReceipt, treasuryError, treasuryIntent, treasuryToday } from '../../../services/financeTreasuryService';
import { invoiceLabel } from '../financeLabels';

const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const primary = 'min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const secondary = 'min-h-[40px] rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold dark:border-white/10 disabled:opacity-50';
const METHODS = { Transfer: 'Transferencia', Check: 'Cheque', Cash: 'Efectivo', Other: 'Otro' };
// A card receipt only comes from the airline portal (ADR-0036): it is shown, never recorded by hand.
const METHOD_LABELS = { ...METHODS, Card: 'Tarjeta' };
const KINDS = { Application: 'Aplicación', ApplicationReversal: 'Reverso de aplicación', ReceiptReversal: 'Reverso de cobro', Refund: 'Devolución' };

function ReceiptDetail({ receiptId, revision, onChanged, onOpenInvoice, preferredInvoiceId }) {
  const { access } = useDepartmentAccess();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const intent = useRef(null);
  const submitting = useRef(false);
  const load = useCallback(signal => getTreasuryReceipt(receiptId, { signal }).then(
    data => { if (!signal?.aborted) { setReceipt(data); setError(''); } },
    failure => { if (!signal?.aborted) { setReceipt(null); setError(treasuryError(failure)); } },
  ), [receiptId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);

  async function open(kind, movement = null) {
    intent.current = null; setError('');
    setForm({ effectiveOn: treasuryToday(), reason: '', amount: '', reference: '', amounts: {} });
    // Keep the version snapshot for this intent even if the account change feed refreshes the detail.
    setAction({ kind, movement, receipt }); setCandidates(null);
    if (kind === 'apply') {
      try {
        const data = await getTreasuryStatement({ asOf: treasuryToday(), stationId: receipt.stationId, airlineId: receipt.airlineId });
        setCandidates(data.invoices.filter(i => i.balance > 0 && i.stationId === receipt.stationId && i.airlineId === receipt.airlineId).sort((a, b) => Number(b.id === preferredInvoiceId) - Number(a.id === preferredInvoiceId)));
      } catch (failure) { setCandidates([]); setError(treasuryError(failure)); }
    }
  }
  function close() { if (!submitting.current) setAction(null); }
  async function submit(event) {
    event.preventDefault(); if (submitting.current || !action) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const base = { expectedVersion: action.receipt.version, effectiveOn: form.effectiveOn, reason: form.reason.trim() };
      let payload = base;
      if (base.reason.length < 3) throw new Error('Escriba un motivo de al menos tres caracteres.');
      if (action.kind === 'apply') {
        const applications = (candidates ?? []).filter(i => String(form.amounts[i.id] ?? '').trim() !== '').map(i => ({
          invoiceId: i.id, expectedInvoiceVersion: i.version, receiptAmount: parseTreasuryAmount(form.amounts[i.id]),
        }));
        if (!applications.length) throw new Error('Indique el importe para al menos una factura.');
        if (applications.reduce((sum, a) => sum + Math.round(a.receiptAmount * 10000), 0) > Math.round(action.receipt.available * 10000))
          throw new Error('La aplicación supera el remanente disponible del cobro.');
        payload = { ...base, applications };
      } else if (action.kind === 'refund') {
        const amount = parseTreasuryAmount(form.amount);
        if (amount > action.receipt.available) throw new Error('La devolución supera el remanente disponible.');
        payload = { ...base, amount, reference: form.reference.trim() };
      } else payload = { ...base, applicationId: action.movement?.id ?? null };
      intent.current = treasuryIntent(intent.current, payload);
      const command = action.kind === 'apply' ? applyTreasuryReceipt : action.kind === 'refund' ? refundTreasuryReceipt : reverseTreasuryReceipt;
      await command(receiptId, intent.current.body);
      setAction(null); await load(); onChanged('Movimiento registrado.');
    } catch (failure) { setError(treasuryError(failure)); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (!receipt) return <div>{error ? <><p role="alert">{error}</p><button type="button" className={secondary} onClick={() => void load()}>Reintentar</button></> : <p role="status">Cargando cobro…</p>}</div>;
  // 4-N09: a card receipt of the portal is neither reversed nor refunded; Finance corrects it with a credit note.
  const card = receipt.method === 'Card';
  const canApply = access?.can('finance.receipts.apply') && !receipt.reversed && receipt.available > 0;
  const canReverse = access?.can('finance.receipts.reverse') && !receipt.reversed && !card;
  const canRefund = access?.can('finance.receipts.refund') && !receipt.reversed && receipt.available > 0 && !card;
  const title = action?.kind === 'apply' ? 'Aplicar cobro' : action?.kind === 'refund' ? 'Devolver remanente' : action?.movement ? 'Revertir aplicación' : 'Revertir cobro';
  const confirm = action?.kind === 'apply' ? 'Confirmar aplicación' : action?.kind === 'refund' ? 'Confirmar devolución' : 'Confirmar reverso';
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-2">
      {[['Recibido', receipt.amount], ['Aplicado', receipt.applied], ['Devuelto', receipt.refunded], ['Remanente', receipt.available]].map(([label, amount]) =>
        <div key={label} className="rounded-lg bg-black/[.03] p-3 dark:bg-white/[.04]"><dt className="text-xs">{label}</dt><dd className="font-semibold tabular-nums">{money(amount, receipt.currencyCode)}</dd></div>)}
    </dl>
    <p className="text-sm">{receipt.receivedOn} · {METHOD_LABELS[receipt.method] ?? receipt.method}{receipt.reversed && ' · Revertido'}</p>
    <p className="text-sm">{receipt.reason}</p>
    {card && <p role="note" className="rounded-lg bg-black/[.03] p-3 text-sm dark:bg-white/[.04]">Cobro con tarjeta desde el portal de la aerolínea: no se revierte ni se devuelve. Para corregirlo, emita una nota de crédito en la factura.</p>}
    <div className="flex flex-wrap gap-2">
      {canApply && <button type="button" className={primary} onClick={() => void open('apply')}>Aplicar a facturas</button>}
      {canRefund && <button type="button" className={secondary} onClick={() => void open('refund')}>Devolver remanente</button>}
      {canReverse && receipt.applied === 0 && receipt.refunded === 0 && <button type="button" className={secondary} onClick={() => void open('reverse')}>Revertir cobro</button>}
    </div>
    {error && !action && <p role="alert" className="text-sm text-status-danger">{error}</p>}
    <section aria-label="Historial del cobro" className="space-y-2"><h3 className="text-sm font-semibold">Historial del cobro</h3>
      {!receipt.movements.length && <p className="text-sm text-text-secondary-light">El cobro está disponible como anticipo o saldo sin aplicar.</p>}
      {receipt.movements.map(m => <article key={m.id} className="space-y-1 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
        <p className="font-semibold">{KINDS[m.kind] ?? m.kind} · {money(m.receiptAmount, m.receiptCurrency)}</p>
        <p>{m.effectiveOn} · {m.reason}{m.reference && ' · ' + m.reference}</p>
        {m.invoiceId && <p>{money(m.invoiceAmount, m.invoiceCurrency)} · Tasa registrada {m.exchangeRate} · {m.exchangeRateOn}</p>}
        {m.invoiceId && onOpenInvoice && <button type="button" onClick={() => onOpenInvoice(m.invoiceId)} className="min-h-[32px] text-accent-600">Ver factura vinculada</button>}
        {m.reversesId && <p className="text-xs">Vinculado al movimiento original.</p>}
        {canReverse && m.kind === 'Application' && !receipt.movements.some(r => r.reversesId === m.id) &&
          <button type="button" className="min-h-[32px] font-semibold text-accent-600" onClick={() => void open('reverse', m)}>Revertir aplicación</button>}
      </article>)}
    </section>
    <Modal open={Boolean(action)} onClose={close} title={title} widthClassName="max-w-2xl" footer={<>
      <button type="button" disabled={busy} className={secondary} onClick={close}>Cancelar</button>
      <button type="submit" form="treasury-movement-form" className={primary} disabled={busy || (action?.kind === 'apply' && candidates === null)}>{busy ? 'Guardando…' : confirm}</button>
    </>}>
      {action && <form id="treasury-movement-form" onSubmit={submit} className="space-y-3 pb-1">
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-status-danger">{error}</p>}
        <p>Remanente disponible: <strong>{money(action.receipt.available, action.receipt.currencyCode)}</strong></p>
        {action.kind === 'apply' && <><p className="text-xs">Indique importes en la moneda del cobro. ELEVANT registra la tasa de cambio de la fecha y valida cada saldo.</p>
          {candidates === null ? <p role="status">Cargando facturas…</p> : !candidates.length ? <p>No hay facturas pendientes para esta aerolínea y estación.</p> :
            <div className="max-h-72 space-y-3 overflow-y-auto">{candidates.map(i => <label key={i.id} className="block rounded-lg border border-black/10 p-3 text-xs font-semibold dark:border-white/10">
              Importe para {invoiceLabel(i)} ({action.receipt.currencyCode}) · Saldo {money(i.balance, i.currencyCode)}
              <input type="number" min="0.0001" step="0.0001" max={action.receipt.available} value={form.amounts[i.id] ?? ''} disabled={busy}
                onChange={event => setForm(current => ({ ...current, amounts: { ...current.amounts, [i.id]: event.target.value } }))} className={field} />
            </label>)}</div>}</>}
        {action.kind === 'refund' && <><label className="block text-xs font-semibold">Importe a devolver ({action.receipt.currencyCode})<input required type="number" min="0.0001" max={action.receipt.available} step="0.0001" className={field} value={form.amount} disabled={busy} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} /></label>
          <label className="block text-xs font-semibold">Referencia de devolución<input required maxLength={120} className={field} value={form.reference} disabled={busy} onChange={event => setForm(current => ({ ...current, reference: event.target.value }))} /></label></>}
        {action.kind === 'reverse' && <p>Se registrará un movimiento de reverso por {money(action.movement?.receiptAmount ?? action.receipt.amount, action.receipt.currencyCode)}.</p>}
        <label className="block text-xs font-semibold">Fecha del movimiento<input required type="date" min={action.receipt.receivedOn} max={treasuryToday()} value={form.effectiveOn} disabled={busy} onChange={event => setForm(current => ({ ...current, effectiveOn: event.target.value }))} className={field} /></label>
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={1000} rows={3} value={form.reason} disabled={busy} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={field} /></label>
      </form>}
    </Modal>
  </div>;
}

export default function TreasuryPage({ initialStationId, initialAirlineId = '', initialInvoiceId, initialReceiptId, onOpenInvoice }) {
  const { access } = useDepartmentAccess(); const canRead = Boolean(access?.can('finance.receipts.read'));
  const [filters, setFilters] = useState(() => ({ stationId: initialStationId ?? readSession()?.stationScopes?.[0]?.stationId ?? '', airlineId: initialAirlineId, page: 1 }));
  const [options, setOptions] = useState(null); const [page, setPage] = useState(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(() => initialReceiptId ? { id: initialReceiptId, reference: 'seleccionado' } : null); const [create, setCreate] = useState(false);
  const [form, setForm] = useState({}); const [busy, setBusy] = useState(false); const [revision, setRevision] = useState(0);
  const intent = useRef(null); const submitting = useRef(false);
  const load = useCallback(signal => {
    if (!canRead) return Promise.resolve();
    return Promise.all([getTreasuryOptions({ signal }), listTreasuryReceipts(filters, { signal })]).then(
      ([refs, data]) => { if (!signal?.aborted) { setOptions(refs); setPage(data); setError(''); } },
      failure => { if (!signal?.aborted) { setPage(null); setError(treasuryError(failure)); } },
    );
  }, [canRead, filters]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);
  useEffect(() => {
    if (!canRead || process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => { if (resources.includes('finance_receipts')) setRevision(value => value + 1); });
    void observer.start().catch(() => {}); return () => { void observer.stop(); };
  }, [canRead]);
  function openCreate() {
    intent.current = null; setError('');
    setForm({ airlineId: filters.airlineId, stationId: filters.stationId || options?.stations?.[0]?.id || '', currencyCode: 'USD', amount: '',
      reference: '', method: 'Transfer', receivedOn: treasuryToday(), reason: '' }); setCreate(true);
  }
  function closeCreate() { if (!submitting.current) setCreate(false); }
  async function submit(event) {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError('');
    try {
      const payload = { ...form, amount: parseTreasuryAmount(form.amount), reference: form.reference.trim(), reason: form.reason.trim() };
      if (!payload.airlineId || !payload.stationId || payload.reason.length < 3) throw new Error('Seleccione aerolínea, estación y un motivo válido.');
      intent.current = treasuryIntent(intent.current, payload);
      await recordTreasuryReceipt(intent.current.body); setCreate(false); setNotice('Cobro registrado y disponible para aplicar.'); await load();
    } catch (failure) { setError(treasuryError(failure)); }
    finally { submitting.current = false; setBusy(false); }
  }
  function changed(message) { setNotice(message); setRevision(value => value + 1); }
  if (!canRead) return <p role="alert">No tiene permiso para consultar cobros.</p>;
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <PageHeader eyebrow="Finanzas" title="Tesorería y cobros" description="Registre cobros, distribuya aplicaciones entre facturas y gestione anticipos y remanentes."
      actions={access?.can('finance.receipts.create') && options?.stations?.length > 0 && <button type="button" className={primary} onClick={openCreate}>Registrar cobro</button>} />
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-semibold">Estación<select className={field} value={filters.stationId} onChange={event => { setPage(null); setSelected(null); setFilters(current => ({ ...current, stationId: event.target.value, page: 1 })); }}>
        <option value="">Todas mis estaciones</option>{options?.stations?.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <label className="text-xs font-semibold">Aerolínea<select className={field} value={filters.airlineId} onChange={event => { setPage(null); setSelected(null); setFilters(current => ({ ...current, airlineId: event.target.value, page: 1 })); }}>
        <option value="">Todas</option>{options?.airlines?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <button type="button" className={secondary} onClick={() => setRevision(value => value + 1)}>Actualizar</button>
    </div>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && !create && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    {!page ? !error && <p role="status">Cargando cobros…</p> : !page.items.length ? <p className="rounded-xl border border-black/10 p-6 text-sm dark:border-white/10">No hay cobros para los filtros seleccionados.</p> : <>
      <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card"><table className="table-stack w-full min-w-[720px] text-left text-sm">
        <thead><tr>{['Referencia', 'Fecha', 'Aerolínea', 'Recibido', 'Aplicado', 'Remanente', 'Acción'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead>
        <tbody>{page.items.map(r => <tr key={r.id} className="border-t border-black/5 dark:border-white/5"><td className="p-3 font-semibold">{r.reference}{r.reversed && <span className="block text-xs">Revertido</span>}</td>
          <td className="p-3">{r.receivedOn}</td><td className="p-3">{options?.airlines?.find(a => a.id === r.airlineId)?.name ?? 'Aerolínea'}</td>
          <td className="p-3 tabular-nums">{money(r.amount, r.currencyCode)}</td><td className="p-3 tabular-nums">{money(r.applied, r.currencyCode)}</td><td className="p-3 font-semibold tabular-nums">{money(r.available, r.currencyCode)}</td>
          <td className="p-3"><button type="button" aria-label={'Ver ' + r.reference} className="min-h-[40px] font-semibold text-accent-600" onClick={() => setSelected(r)}>Ver cobro</button></td></tr>)}</tbody>
      </table></StackedTable>
      <div className="flex items-center justify-end gap-3 text-sm"><button type="button" className={secondary} disabled={filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}>Anterior</button>
        <span>Página {filters.page}</span><button type="button" className={secondary} disabled={!page.hasMore} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>Siguiente</button></div>
    </>}
    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? 'Cobro ' + selected.reference : 'Detalle del cobro'} widthClassName="lg:w-[640px]">
      {selected && <ReceiptDetail key={selected.id} receiptId={selected.id} revision={revision} onChanged={changed} onOpenInvoice={onOpenInvoice} preferredInvoiceId={initialInvoiceId} />}
    </Drawer>
    <Modal open={create} onClose={closeCreate} title="Registrar cobro" footer={<><button type="button" disabled={busy} className={secondary} onClick={closeCreate}>Cancelar</button>
      <button type="submit" form="treasury-receipt-form" className={primary} disabled={busy}>{busy ? 'Guardando…' : 'Confirmar cobro'}</button></>}>
      <form id="treasury-receipt-form" onSubmit={submit} className="space-y-3 pb-1">
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-status-danger">{error}</p>}
        <label className="block text-xs font-semibold">Aerolínea<select required value={form.airlineId ?? ''} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, airlineId: event.target.value }))}><option value="">Seleccione</option>{options?.airlines?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="block text-xs font-semibold">Estación<select required value={form.stationId ?? ''} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, stationId: event.target.value }))}><option value="">Seleccione</option>{options?.stations?.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Moneda<select value={form.currencyCode ?? 'USD'} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, currencyCode: event.target.value }))}><option>USD</option><option>DOP</option></select></label>
          <label className="text-xs font-semibold">Importe recibido<input required type="number" min="0.0001" step="0.0001" max="900000000000" value={form.amount ?? ''} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} /></label></div>
        <label className="block text-xs font-semibold">Referencia<input required maxLength={120} value={form.reference ?? ''} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, reference: event.target.value }))} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Método<select value={form.method ?? 'Transfer'} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, method: event.target.value }))}>{Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-semibold">Fecha de recepción<input required type="date" max={treasuryToday()} value={form.receivedOn ?? ''} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, receivedOn: event.target.value }))} /></label></div>
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={1000} rows={3} value={form.reason ?? ''} disabled={busy} className={field} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} /></label>
        <p className="text-xs">El cobro queda disponible como anticipo o remanente hasta aplicarlo a una factura.</p>
      </form>
    </Modal>
  </div>;
}
