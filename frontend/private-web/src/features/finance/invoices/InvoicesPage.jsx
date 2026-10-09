import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer';
import EmptyState from '../../../components/EmptyState';
import FilterBar from '../../../components/FilterBar';
import Modal from '../../../components/Modal';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { ReconciliationIcon } from '../components/icons';
import {
  formatMoney, getFinanceInvoice, issueCreditNote, listFinanceInvoices, newRequestId, recordPartialPayment,
} from '../../../services/financeBookService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
export const INVOICE_STATUS = {
  Pending: { label: 'Pendiente', tone: 'info' },
  PartiallyPaid: { label: 'Pago parcial', tone: 'warning' },
  Paid: { label: 'Pagada', tone: 'success' },
  Overdue: { label: 'Vencida', tone: 'danger' },
};
const KIND_LABELS = { Service: 'Servicio', Charge: 'Cargo', Adjustment: 'Ajuste' };
const METHODS = { Transfer: 'Transferencia', Check: 'Cheque', Cash: 'Efectivo', Other: 'Otro' };

function InvoiceDetail({ invoiceId, canRecord, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const intent = useRef(null);

  const load = useCallback(async () => {
    try { setDetail(await getFinanceInvoice(invoiceId)); setError(''); } catch (failure) { setError(failure.message); }
  }, [invoiceId]);
  useEffect(() => { void load(); }, [load]);

  function open(kind) {
    intent.current = newRequestId();
    setForm(kind === 'payment'
      ? { amount: detail.summary.balance, method: 'Transfer', paidOn: new Date().toISOString().slice(0, 10), reference: '' }
      : { amount: '', reason: '' });
    setAction(kind);
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (action === 'payment') {
        await recordPartialPayment({ invoiceId, requestId: intent.current, reference: form.reference.trim(),
          amount: Number(form.amount), method: form.method, paidOn: form.paidOn });
      } else {
        await issueCreditNote(invoiceId, { requestId: intent.current, amount: Number(form.amount), reason: form.reason.trim() });
      }
      setAction(null);
      await load();
      onChanged(action === 'payment' ? 'Pago registrado.' : 'Nota de crédito emitida.');
    } catch (failure) {
      setError(failure.status === 409 ? 'El importe supera el saldo, la referencia ya existe o la factura cambió.' : failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : <p role="status" className="text-sm">Cargando factura…</p>;
  const { summary } = detail;
  const status = INVOICE_STATUS[summary.status] ?? { label: summary.status, tone: 'info' };
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Total', summary.total], ['Pagado', summary.paid], ['Notas de crédito', summary.credited], ['Saldo', summary.balance]].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-black/[.03] p-3 dark:bg-white/[.04]"><dt className="text-[11px] font-semibold uppercase text-text-secondary-light">{label}</dt>
            <dd className="mt-0.5 font-bold tabular-nums">{formatMoney(value, summary.currencyCode)}</dd></div>
        ))}
      </dl>
      <p className="flex flex-wrap items-center gap-2 text-xs text-text-secondary-light">
        <StatusBadge tone={status.tone} label={status.label} /> Emitida {new Date(summary.issuedAt).toLocaleDateString('es-DO')}
        {summary.dueDate && ` · Vence ${summary.dueDate}`}{summary.daysOverdue > 0 && ` · ${summary.daysOverdue} días vencida`}
      </p>
      {canRecord && summary.balance > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => open('payment')} className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white">Registrar pago</button>
          <button type="button" onClick={() => open('credit')} className="min-h-[40px] rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600">Emitir nota de crédito</button>
        </div>
      )}
      <section>
        <h3 className="text-sm font-semibold">Líneas</h3>
        <ul className="mt-2 divide-y divide-black/5 text-sm dark:divide-white/5">
          {detail.lines.map(line => (
            <li key={line.lineNumber} className={`flex flex-wrap justify-between gap-2 py-2 ${line.parentLineNumber ? 'pl-4' : ''}`}>
              <span className="min-w-0"><span className="text-xs text-text-secondary-light">{KIND_LABELS[line.kind]} · </span>{line.serviceCode} · {line.serviceName}
                {line.reason && <span className="block text-xs text-text-secondary-light">{line.reason}</span>}</span>
              <span className="tabular-nums">{formatMoney(line.amount, summary.currencyCode)}</span>
            </li>
          ))}
        </ul>
      </section>
      {(detail.payments.length > 0 || detail.creditNotes.length > 0) && (
        <section>
          <h3 className="text-sm font-semibold">Pagos y notas de crédito</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {detail.payments.map(payment => <li key={payment.id}>Pago {METHODS[payment.method] ?? payment.method} {payment.reference} · {payment.paidOn ?? ''} · <strong>{formatMoney(payment.amount, summary.currencyCode)}</strong> · {payment.recordedBy}</li>)}
            {detail.creditNotes.map(note => <li key={note.id}>Nota {note.number} · <strong>{formatMoney(note.amount, summary.currencyCode)}</strong> · {note.reason}</li>)}
          </ul>
        </section>
      )}
      <Modal open={Boolean(action)} onClose={() => setAction(null)} title={action === 'payment' ? 'Registrar pago' : 'Emitir nota de crédito'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setAction(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="invoice-action-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Confirmar'}</button></div>}>
        <form id="invoice-action-form" onSubmit={submit} className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          <label className="block text-xs font-semibold">Importe ({summary.currencyCode}) · saldo {formatMoney(summary.balance, summary.currencyCode)}
            <input required type="number" min="0.01" max={summary.balance} step="0.01" value={form.amount ?? ''} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} className={fieldClass} /></label>
          {action === 'payment' ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold">Método<select value={form.method} onChange={event => setForm(current => ({ ...current, method: event.target.value }))} className={fieldClass}>
                  {Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-xs font-semibold">Fecha de pago<input required type="date" value={form.paidOn} onChange={event => setForm(current => ({ ...current, paidOn: event.target.value }))} className={fieldClass} /></label>
              </div>
              <label className="block text-xs font-semibold">Referencia<input required minLength={8} maxLength={80} pattern="[A-Za-z0-9\-]+" title="8 a 80 letras, números o guiones" value={form.reference} onChange={event => setForm(current => ({ ...current, reference: event.target.value }))} className={fieldClass} /></label>
              <p className="text-xs text-text-secondary-light">Registro manual; no es una confirmación bancaria.</p>
            </>
          ) : (
            <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={1000} rows={3} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
          )}
        </form>
      </Modal>
    </div>
  );
}

/** Non-fiscal invoices with balance, aging, partial payments and credit notes. */
export default function InvoicesPage({ initialStationId }) {
  const { access } = useDepartmentAccess();
  const canRecord = Boolean(access?.can('finance.reconciliation.record'));
  const stations = (readSession()?.stationScopes ?? []).filter(scope => scope?.stationId);
  const [filters, setFilters] = useState({ stationId: initialStationId ?? '', status: '' });
  const [page, setPage] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setPage(await listFinanceInvoices({ ...filters, limit: 50 })); setError(''); }
    catch (failure) { setPage({ invoices: [] }); setError(failure.message); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_preinvoices')) void load();
    });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, [load]);

  const invoices = page?.invoices ?? [];
  const current = invoices.find(invoice => invoice.id === selected);
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Facturas y cobros"
        description="Facturas no fiscales con su saldo, vencimiento, pagos parciales y notas de crédito." />
      <FilterBar>
        {stations.length > 1 && <label className="text-xs font-semibold">Estación<select value={filters.stationId} onChange={event => setFilters(currentFilters => ({ ...currentFilters, stationId: event.target.value }))} className={fieldClass}>
          <option value="">Todas</option>{stations.map(station => <option key={station.stationId} value={station.stationId}>{station.stationCode}</option>)}</select></label>}
        <label className="text-xs font-semibold">Estado<select value={filters.status} onChange={event => setFilters(currentFilters => ({ ...currentFilters, status: event.target.value }))} className={fieldClass}>
          <option value="">Todos</option>{Object.entries(INVOICE_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      </FilterBar>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      {!page ? <p role="status" className="text-sm">Cargando facturas…</p> : invoices.length === 0 ? (
        <EmptyState icon={ReconciliationIcon} title="Sin facturas" description="Las facturas emitidas desde prefacturas aceptadas aparecerán aquí." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[760px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-3">Factura</th><th className="p-3">Aerolínea</th><th className="p-3">Total</th><th className="p-3">Saldo</th><th className="p-3">Vence</th><th className="p-3">Estado</th></tr></thead>
            <tbody>{invoices.map(invoice => {
              const status = INVOICE_STATUS[invoice.status] ?? { label: invoice.status, tone: 'info' };
              return (
                <tr key={invoice.id} className="cursor-pointer border-t border-black/5 hover:bg-black/[.02] dark:border-white/5" onClick={() => setSelected(invoice.id)}>
                  <td className="p-3"><button type="button" className="text-left font-semibold text-accent-600" onClick={() => setSelected(invoice.id)}>{invoice.number.slice(0, 15)}…</button><span className="block text-xs text-text-secondary-light">{invoice.stationCode}</span></td>
                  <td className="p-3">{invoice.airline}</td>
                  <td className="p-3 tabular-nums">{formatMoney(invoice.total, invoice.currencyCode)}</td>
                  <td className="p-3 font-semibold tabular-nums">{formatMoney(invoice.balance, invoice.currencyCode)}</td>
                  <td className="p-3 text-xs">{invoice.dueDate ?? '—'}{invoice.daysOverdue > 0 && <span className="block text-status-danger">{invoice.daysOverdue} días</span>}</td>
                  <td className="p-3"><StatusBadge tone={status.tone} label={status.label} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </StackedTable>
      )}
      <Drawer open={Boolean(current)} onClose={() => setSelected(null)} title={current ? `Factura ${current.airline}` : ''}
        description={current?.number} widthClassName="lg:w-[560px]">
        {current && <InvoiceDetail invoiceId={current.id} canRecord={canRecord} onChanged={message => { setNotice(message); void load(); }} />}
      </Drawer>
    </div>
  );
}
