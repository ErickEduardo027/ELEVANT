'use client';
import { useEffect, useState } from 'react';
import { listPayablePayments, listPayables, recordPayablePayment, applyPayablePayment, reimburseEmployeeExpense, reversePayablePayment } from '../../../services/financePayablesService';
import { payablesError } from './usePayablesWorkspace';
import { buttonClass, Choice, DecisionForm, emptyFx, Field, fieldClass, formatMoney, FxFields, fxBody, panelClass, primaryClass, today } from './PayablesUi';

const PAYMENTS_PAGE = 25;
const paymentStatus = payment => payment.voidedAt ? 'Anulado'
  : Number(payment.remaining) > 0 ? 'Disponible ' + formatMoney(payment.remaining, payment.fx.currency) : 'Aplicado';

/**
 * 4-N04: the payments of the invoice's supplier at the station, 25 at a time, with their applications. With
 * `finance.payables.reverse` an application is reversed and a payment without active applications is voided, each
 * with its reason; both are linked rows, so the history stays on screen. 4-N15: it shows on an invoice of any status,
 * so a payment whose invoices were all voided is still voided before the supplier retires.
 */
export function SupplierPaymentsPanel({ detail, scope, canReverse, mutation, onOpenInvoice }) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false); const [revision, setRevision] = useState(0); const [reversing, setReversing] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return; setLoading(true); setError('');
      try {
        const page = await listPayablePayments({ scopeStationId: scope, supplierId: detail.supplierId, skip: 0, take: PAYMENTS_PAGE });
        if (active) { setRows(page); setHasMore(page.length === PAYMENTS_PAGE); }
      } catch (e) { if (active) setError(payablesError(e)); } finally { if (active) setLoading(false); }
    });
    return () => { active = false; };
  }, [scope, detail.supplierId, revision]);
  async function more() {
    setLoading(true); setError('');
    try {
      const page = await listPayablePayments({ scopeStationId: scope, supplierId: detail.supplierId, skip: rows.length, take: PAYMENTS_PAGE });
      setRows(current => [...current, ...page.filter(item => !current.some(row => row.id === item.id))]); setHasMore(page.length === PAYMENTS_PAGE);
    } catch (e) { setError(payablesError(e)); } finally { setLoading(false); }
  }
  async function confirm(reason) {
    const { payment, application } = reversing;
    const values = { expectedVersion: payment.version, reason, ...(application ? { applicationId: application.id } : {}) };
    if (await mutation.run('payable:reverse:' + payment.id + ':' + (application?.id ?? 'payment'), values, body => reversePayablePayment(payment.id, body))) {
      setReversing(null); setRevision(n => n + 1);
    }
  }
  return <section aria-label="Pagos del proveedor" className="space-y-3 border-t border-black/10 pt-4 dark:border-white/10">
    <h3 className="font-semibold">Pagos del proveedor</h3>
    {loading && rows.length === 0 && <p role="status">Cargando pagos…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className={buttonClass + ' mt-2'} onClick={() => { setRows([]); setRevision(n => n + 1); }}>Reintentar pagos</button></div>}
    {!loading && !error && rows.length === 0 && <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Sin pagos registrados para este proveedor en la estación.</p>}
    <ul className="space-y-3 text-sm">{rows.map(payment => {
      const active = payment.applications.filter(application => !application.reversedAt);
      return <li key={payment.id} aria-label={'Pago ' + payment.reference} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
        <p><strong>{payment.reference}</strong> · {payment.paidOn} · {formatMoney(payment.amount, payment.fx.currency)} · {paymentStatus(payment)}</p>
        {payment.voidedAt && <p className="text-xs">Anulado el {new Date(payment.voidedAt).toLocaleString('es-DO')}: {payment.voidReason}</p>}
        {payment.applications.length > 0 && <ul className="mt-2 space-y-1 text-xs">{payment.applications.map(application => <li key={application.id} className="flex flex-wrap items-center gap-2">
          {application.invoiceId === detail.id ? <strong>Esta factura</strong> : <button type="button" className="underline" onClick={() => onOpenInvoice(application.invoiceId)}>Otra factura del proveedor</button>}
          <span>· {formatMoney(application.paymentAmount, payment.fx.currency)} · {application.reversedAt ? 'Revertida: ' + application.reversalReason : 'Activa'}</span>
          {canReverse && !application.reversedAt && !payment.voidedAt && <button type="button" className={buttonClass} disabled={mutation.busy} onClick={() => setReversing({ payment, application })}>Revertir aplicación</button>}
        </li>)}</ul>}
        {canReverse && !payment.voidedAt && <div className="mt-2"><button type="button" className={buttonClass} disabled={mutation.busy || active.length > 0} onClick={() => setReversing({ payment, application: null })}>Anular pago</button>
          {active.length > 0 && <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Revierta sus aplicaciones activas antes de anular el pago.</p>}</div>}
      </li>;
    })}</ul>
    {hasMore && <button type="button" className={buttonClass} disabled={loading} onClick={() => void more()}>Ver más</button>}
    {reversing && <DecisionForm key={reversing.payment.id + (reversing.application?.id ?? '')} decision="Voided" busy={mutation.busy}
      title={reversing.application ? 'Revertir la aplicación del pago ' + reversing.payment.reference : 'Anular el pago ' + reversing.payment.reference}
      confirmLabel={reversing.application ? 'Confirmar reverso' : 'Confirmar anulación'}
      notice={reversing.application ? 'El importe vuelve a quedar disponible en el pago y pendiente en la factura.' : 'El pago queda anulado con su historial y deja de estar disponible.'}
      onCancel={() => setReversing(null)} onConfirm={confirm} />}
  </section>;
}

// Positive decimal arithmetic mirrors the backend's midpoint-away-from-zero rule.
function roundedQuotient(numerator, denominator) {
  const whole = numerator / denominator;
  return whole + (numerator % denominator * 2n >= denominator ? 1n : 0n);
}
function decimalUnits(value, places) {
  const text = String(value ?? '').trim();
  const match = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text.startsWith('.') ? '0' + text : text);
  if (!match) return null;
  const fraction = match[2] ?? '';
  const shift = places + Number(match[3] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 308) return null;
  const units = BigInt(match[1] + fraction);
  return shift >= 0 ? units * 10n ** BigInt(shift) : roundedQuotient(units, 10n ** BigInt(-shift));
}
function conversionRate(from, to) {
  if (from?.currency === to.currency) return 1;
  const source = decimalUnits(from?.rateToDop, 8); const target = decimalUnits(to.rateToDop, 8);
  return source !== null && source > 0n && target !== null && target > 0n
    ? Number(roundedQuotient(source * 100_000_000n, target)) / 1e8 : NaN;
}
function appliedUnits(amount, rate) {
  const money = decimalUnits(amount, 4); const fx = decimalUnits(rate, 8);
  return money !== null && fx !== null ? roundedQuotient(money * fx, 100_000_000n) : null;
}
function fitsDocument(amount, rate, remaining) {
  const applied = appliedUnits(amount, rate); const balance = decimalUnits(remaining, 4);
  return applied !== null && applied > 0n && balance !== null && applied <= balance;
}

export function PaymentForm({ detail, scope, expense = false, mutation, onClose }) {
  const [fx, setFx] = useState(emptyFx); const [paidOn, setPaidOn] = useState(today); const [reference, setReference] = useState(''); const [amount, setAmount] = useState('');
  const rate = conversionRate(fx, detail.fx);
  const applied = appliedUnits(amount, rate);
  const validExpenseAmount = fitsDocument(amount, rate, detail.remaining);
  return <form className={panelClass + ' space-y-4'} aria-label={expense ? 'Registrar reembolso' : 'Registrar pago a proveedor'} onSubmit={async e => {
    e.preventDefault(); if (expense && !validExpenseAmount) return;
    const body = { paidOn, reference: reference.trim(), fx: fxBody(fx), amount: Number(amount), ...(expense ? { expectedVersion: detail.version, rateToExpense: rate } : { supplierId: detail.supplierId, scopeStationId: scope }) };
    const saved = await mutation.run((expense ? 'expense:pay:' : 'payable:pay:') + detail.id, body, values => expense ? reimburseEmployeeExpense(detail.id, values) : recordPayablePayment(values)); if (saved) onClose();
  }}><h3 className="font-bold">{expense ? 'Reembolsar gasto aprobado' : 'Registrar pago al proveedor'}</h3><fieldset disabled={mutation.busy} className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Field label="Fecha del pago"><input className={fieldClass} type="date" required value={paidOn} onChange={e => setPaidOn(e.target.value)} /></Field><Field label="Referencia del pago"><input className={fieldClass} required maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></Field><Field label="Importe del pago"><input className={fieldClass} type="number" required min="0.0001" step="0.0001" value={amount} onChange={e => setAmount(e.target.value)} /></Field></div>
    <FxFields value={fx} onChange={setFx} maxDate={paidOn} />
    {expense ? <p className="text-sm">Tasa al gasto: {Number.isFinite(rate) ? rate : 'Indique la tasa'} · A reembolsar: {applied !== null ? formatMoney(Number(applied) / 1e4, detail.fx.currency) : '—'} · Saldo {formatMoney(detail.remaining, detail.fx.currency)}</p> : <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">El pago queda disponible como remanente. Aplíquelo después a una o varias facturas aprobadas.</p>}
    <div className="flex gap-2"><button className={primaryClass} type="submit" disabled={expense && !validExpenseAmount}>Confirmar pago</button><button className={buttonClass} type="button" onClick={onClose}>Cancelar pago</button></div>
  </fieldset></form>;
}
export function ApplyPaymentForm({ detail, scope, mutation, onClose, onOpenInvoice }) {
  const [payments, setPayments] = useState([]); const [invoices, setInvoices] = useState([]); const [paymentId, setPaymentId] = useState(''); const [amounts, setAmounts] = useState({}); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; Promise.all([listPayablePayments({ scopeStationId: scope, supplierId: detail.supplierId, take: 200 }), listPayables({ scopeStationId: scope, supplierId: detail.supplierId, status: 'Approved', outstandingOnly: true, take: 200 })])
    // 4-N04: a voided payment has nothing left to apply.
    .then(([p, i]) => { if (active) { setPayments(p.filter(payment => !payment.voidedAt)); setInvoices(i); } }).catch(e => { if (active) setError(payablesError(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [scope, detail.supplierId, revision]);
  const payment = payments.find(p => p.id === paymentId); const rateFor = invoice => conversionRate(payment?.fx, invoice.fx);
  const selected = invoices.filter(i => Number(amounts[i.id]) > 0);
  const usedUnits = selected.reduce((sum, i) => sum + (decimalUnits(amounts[i.id], 4) ?? 0n), 0n);
  const used = Number(usedUnits) / 1e4; const exceedsPayment = usedUnits > (decimalUnits(payment?.remaining, 4) ?? 0n);
  const invalidApplications = selected.some(i => !fitsDocument(amounts[i.id], rateFor(i), i.remaining));
  async function submit(e) { e.preventDefault(); if (!payment || selected.length === 0 || selected.length > 100 || invalidApplications || exceedsPayment) return; const values = { expectedVersion: payment.version, applications: selected.map(i => ({ invoiceId: i.id, expectedVersion: i.version, paymentAmount: Number(amounts[i.id]), rateToInvoice: rateFor(i) })) };
    if (await mutation.run('payable:apply:' + payment.id, values, body => applyPayablePayment(payment.id, body))) onClose(); }
  return <form className={panelClass + ' space-y-4'} onSubmit={submit} aria-label="Aplicaciones de pago"><h3 className="font-bold">Aplicar pago existente</h3>{loading && <p role="status">Cargando saldos…</p>}{error && <div role="alert"><p>{error}</p><button type="button" className={buttonClass} onClick={() => { setLoading(true); setError(''); setRevision(n => n + 1); }}>Reintentar saldos</button></div>}
    <fieldset disabled={loading || mutation.busy || Boolean(error)} className="space-y-4"><Choice label="Pago registrado" value={paymentId} required choices={payments.map(p => ({ id: p.id, code: p.reference, name: 'Disponible ' + formatMoney(p.remaining, p.fx.currency) }))} onChange={id => { setPaymentId(id); setAmounts({}); }} />
      {payment && <><p className="text-sm">Disponible {formatMoney(payment.remaining, payment.fx.currency)} · Por aplicar {formatMoney(used, payment.fx.currency)}</p><div className="space-y-3">{invoices.map(i => <div key={i.id} className="grid items-end gap-3 border-t border-black/10 pt-3 dark:border-white/10 sm:grid-cols-2"><div><strong className="text-sm">{i.documentReference}</strong><p className="text-xs">Saldo {formatMoney(i.remaining, i.fx.currency)} · Tasa al documento {rateFor(i)}</p></div><Field label={'Importe a aplicar de ' + i.documentReference}><input className={fieldClass} type="number" step="0.0001" min="0" max={payment.remaining} value={amounts[i.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [i.id]: e.target.value }))} />{Number(amounts[i.id]) > 0 && !fitsDocument(amounts[i.id], rateFor(i), i.remaining) && <span role="alert" className="mt-1 block text-status-danger">El importe convertido debe ser mayor que cero y no superar el saldo de la factura.</span>}</Field></div>)}</div>{payment.applications?.length > 0 && <details><summary>Aplicaciones anteriores</summary><ul className="space-y-2 text-xs">{payment.applications.map(a => <li key={a.id}><button className="underline" type="button" onClick={() => onOpenInvoice(a.invoiceId)}>Abrir factura aplicada</button> · {formatMoney(a.paymentAmount, payment.fx.currency)}{a.reversedAt && ' · Revertida'}</li>)}</ul></details>}</>}
      {invoices.length === 0 && !loading && <p className="text-sm">No hay facturas aprobadas con saldo para este proveedor.</p>}
      {payments.length === 0 && !loading && <p className="text-sm">No hay pagos registrados para este proveedor.</p>}
      {exceedsPayment && <p role="alert">La suma supera el remanente del pago.</p>}<div className="flex gap-2"><button className={primaryClass} type="submit" disabled={!payment || selected.length === 0 || selected.length > 100 || invalidApplications || exceedsPayment}>Confirmar aplicaciones</button><button className={buttonClass} type="button" onClick={onClose}>Cancelar aplicación</button></div>
    </fieldset>
  </form>;
}
