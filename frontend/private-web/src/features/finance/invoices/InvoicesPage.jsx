'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer';
import EmptyState from '../../../components/EmptyState';
import FilterBar from '../../../components/FilterBar';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { ReconciliationIcon } from '../components/icons';
import AdjustmentNotesPanel from '../treasury/AdjustmentNotesPanel';
import TreasuryPage from '../treasury/TreasuryPage';
import { formatMoney, getFinanceInvoice, listFinanceInvoices } from '../../../services/financeBookService';
import { formatTreasuryMoney, getTreasuryStatement, treasuryError, treasuryToday } from '../../../services/financeTreasuryService';
import { downloadInvoiceDocument, getInvoiceCardPayments } from '../../../services/invoicingService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
export const INVOICE_STATUS = {
  Pending: { label: 'Pendiente', tone: 'info' }, PartiallyPaid: { label: 'Pago parcial', tone: 'warning' },
  Paid: { label: 'Pagada', tone: 'success' }, Overdue: { label: 'Vencida', tone: 'danger' },
};
const KIND_LABELS = { Service: 'Servicio', Charge: 'Cargo', Adjustment: 'Ajuste', Package: 'Paquete', Excess: 'Exceso', Minimum: 'Mínimo' };
const METHODS = { Transfer: 'Transferencia', Check: 'Cheque', Cash: 'Efectivo', Other: 'Otro', Card: 'Tarjeta' };
const CARD_STATUS = { Approved: { label: 'Aprobado', tone: 'success' }, Declined: { label: 'Rechazado', tone: 'warning' }, Error: { label: 'Error del procesador', tone: 'danger' } };
const DECLINES = { insufficient_funds: 'fondos insuficientes', expired_card: 'tarjeta vencida', card_not_accepted: 'tarjeta no aceptada', processing_error: 'reintentar' };

/** ADR-0036: the airline card attempts on this invoice; Finance sees the brand and last four digits only. */
function CardAttempts({ invoiceId, revision }) {
  const [state, setState] = useState({ items: null, error: false });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => getInvoiceCardPayments(invoiceId)).then(list => { if (active) setState({ items: list?.attempts ?? [], error: false }); },
      () => { if (active) setState({ items: null, error: true }); });
    return () => { active = false; };
  }, [invoiceId, revision]);
  if (state.error) return <p role="alert" className="text-xs text-status-danger">No se pudieron consultar los pagos con tarjeta.</p>;
  if (!state.items) return null;
  return <section aria-label="Pagos con tarjeta"><h3 className="text-sm font-semibold">Pagos con tarjeta</h3>
    {state.items.length === 0 ? <p className="mt-1 text-xs text-text-secondary-light">La aerolínea no ha intentado pagar con tarjeta.</p>
      : <ul className="mt-2 space-y-1 text-xs">{state.items.map(item => { const status = CARD_STATUS[item.status] ?? { label: item.status, tone: 'info' };
        return <li key={item.id} className="flex flex-wrap items-center gap-2"><StatusBadge tone={status.tone} label={status.label} />
          <span>{item.brand} •••• {item.last4} · <strong>{formatTreasuryMoney(item.amount, item.currencyCode)}</strong> · {new Date(item.attemptedAt).toLocaleString('es-DO')}
            {item.authorizationCode && ` · autorización ${item.authorizationCode}`}{item.declineCode && ` · ${DECLINES[item.declineCode] ?? item.declineCode}`}</span></li>; })}</ul>}
  </section>;
}

/** e-NCF when the invoice was issued as a simulated e-CF (ADR-0035); the internal number otherwise. */
export function invoiceLabel(invoice) {
  return invoice?.fiscalNumber ?? `${invoice?.number?.slice(0, 15) ?? ''}…`;
}

function InvoiceDetail({ invoiceId, revision, onChanged, onOpenReceipt }) {
  const [pdf, setPdf] = useState('idle');
  const { access } = useDepartmentAccess();
  const canReadReceipts = Boolean(access?.can('finance.receipts.read'));
  const [detail, setDetail] = useState(null); const [treasury, setTreasury] = useState(null);
  const [error, setError] = useState(''); const [receiptError, setReceiptError] = useState('');
  const load = useCallback(signal => getFinanceInvoice(invoiceId).then(async value => {
    if (signal?.aborted) return; setDetail(value); setError('');
    if (!canReadReceipts) return;
    try {
      const statement = await getTreasuryStatement({ asOf: treasuryToday(), stationId: value.summary.stationId, airlineId: value.summary.airlineId }, { signal });
      if (!signal?.aborted) { setTreasury(statement); setReceiptError(''); }
    } catch (failure) { if (!signal?.aborted) { setTreasury(null); setReceiptError(treasuryError(failure)); } }
  }, failure => { if (!signal?.aborted) { setDetail(null); setError(treasuryError(failure)); } }), [invoiceId, canReadReceipts]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);
  if (!detail) return error ? <p role="alert" className="text-sm text-status-danger">{error}</p> : <p role="status" className="text-sm">Cargando factura…</p>;
  const { summary } = detail; const current = treasury?.invoices?.find(i => i.id === invoiceId);
  const status = INVOICE_STATUS[summary.status] ?? { label: summary.status, tone: 'info' };
  const context = { invoiceId, airlineId: summary.airlineId, stationId: summary.stationId, currencyCode: summary.currencyCode };
  const amounts = current ? [['Total', summary.total], ['Pagos históricos', current.legacyPaid], ['Créditos históricos', current.legacyCredited], ['Aplicaciones', current.applied],
    ['Notas de crédito', current.credited], ['Notas de débito', current.debited], ['Saldo', current.balance]] :
    [['Total', summary.total], ['Pagado y aplicado', summary.paid], ['Notas netas', summary.credited], ['Saldo', summary.balance]];
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{amounts.map(([label, value]) => <div key={label} className="rounded-lg bg-black/[.03] p-3 dark:bg-white/[.04]">
      <dt className="text-[11px] font-semibold uppercase text-text-secondary-light">{label}</dt><dd className="mt-0.5 font-bold tabular-nums">{formatTreasuryMoney(value, summary.currencyCode)}</dd></div>)}</dl>
    <p className="flex flex-wrap items-center gap-2 text-xs text-text-secondary-light"><StatusBadge tone={status.tone} label={status.label} />
      Emitida {new Date(summary.issuedAt).toLocaleDateString('es-DO')}{summary.dueDate && ' · Vence ' + summary.dueDate}{summary.daysOverdue > 0 && ' · ' + summary.daysOverdue + ' días vencida'}</p>
    {summary.fiscalNumber && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
      <span className="min-w-0 flex-1"><span className="block font-semibold">e-NCF {summary.fiscalNumber}</span>
        <span className="block text-xs text-text-secondary-light">Factura de crédito fiscal con ITBIS 18 %. Simulación — sin validez fiscal.</span></span>
      <button type="button" disabled={pdf === 'loading'} onClick={async () => {
        setPdf('loading');
        try { await downloadInvoiceDocument(invoiceId, `factura-${summary.fiscalNumber}.pdf`); setPdf('idle'); } catch { setPdf('error'); }
      }} className="min-h-[40px] rounded-lg border border-accent-600 px-3 text-sm font-semibold text-accent-600 disabled:opacity-50">{pdf === 'loading' ? 'Preparando PDF…' : 'Descargar PDF'}</button>
      {pdf === 'error' && <p role="alert" className="w-full text-xs text-status-danger">No se pudo descargar el PDF.</p>}
    </div>}
    {canReadReceipts && <button type="button" onClick={() => onOpenReceipt(null, context)} className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white">Gestionar cobros y aplicaciones</button>}
    {receiptError && <p role="alert" className="text-sm text-status-danger">{receiptError} <button type="button" className="font-semibold" onClick={() => void load()}>Reintentar aplicaciones</button></p>}
    {treasury && <section className="space-y-2" aria-label="Aplicaciones de cobros"><h3 className="text-sm font-semibold">Aplicaciones de cobros</h3>
      {(treasury.receipts ?? []).flatMap(r => r.movements.filter(m => m.invoiceId === invoiceId).map(m => <article key={m.id} className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
        <p>{m.kind === 'ApplicationReversal' ? 'Reverso de aplicación' : 'Aplicación'} · {formatTreasuryMoney(m.invoiceAmount, m.invoiceCurrency)} · {m.effectiveOn}</p>
        <p className="text-xs">Cobro {formatTreasuryMoney(m.receiptAmount, m.receiptCurrency)} · Tasa registrada {m.exchangeRate}</p>
        <button type="button" aria-label={'Ver cobro ' + r.reference} onClick={() => onOpenReceipt(r.id, context)} className="min-h-[36px] font-semibold text-accent-600">Ver cobro {r.reference}</button>
      </article>))}
    </section>}
    <CardAttempts invoiceId={invoiceId} revision={revision} />
    <section><h3 className="text-sm font-semibold">Líneas</h3><ul className="mt-2 divide-y divide-black/5 text-sm dark:divide-white/5">{detail.lines.map(line => <li key={line.lineNumber} className={'flex flex-wrap justify-between gap-2 py-2 ' + (line.parentLineNumber ? 'pl-4' : '')}>
      <span className="min-w-0"><span className="text-xs text-text-secondary-light">{KIND_LABELS[line.kind] ?? line.kind} · </span>{line.serviceCode} · {line.serviceName}{line.reason && <span className="block text-xs text-text-secondary-light">{line.reason}</span>}</span>
      <span className="tabular-nums">{formatTreasuryMoney(line.amount, summary.currencyCode)}</span></li>)}</ul></section>
    {((detail.payments?.length ?? 0) > 0 || (detail.creditNotes?.length ?? 0) > 0) && <section><h3 className="text-sm font-semibold">Pagos y notas históricos</h3><ul className="mt-2 space-y-1 text-xs">
      {detail.payments.map(payment => <li key={payment.id}>Pago {METHODS[payment.method] ?? payment.method} {payment.reference} · {payment.paidOn ?? ''} · <strong>{formatTreasuryMoney(payment.amount, summary.currencyCode)}</strong> · {payment.recordedBy}</li>)}
      {detail.creditNotes.map(note => <li key={note.id}>Nota {note.number} · <strong>{formatTreasuryMoney(note.amount, summary.currencyCode)}</strong> · {note.reason}</li>)}</ul></section>}
    {access?.can('finance.adjustments.read') && <AdjustmentNotesPanel invoiceId={invoiceId} invoiceNumber={summary.number} currencyCode={summary.currencyCode}
      onChanged={() => { void load(); onChanged('Nota de ajuste registrada.'); }} />}
  </div>;
}

/** Non-fiscal invoices with balance, aging, partial payments and credit notes. */
export default function InvoicesPage({ initialStationId, onOpenReceipt }) {
  const { access } = useDepartmentAccess();
  const [treasuryScope, setTreasuryScope] = useState(null);
  const [revision, setRevision] = useState(0);
  const stations = (readSession()?.stationScopes ?? []).filter(scope => scope?.stationId);
  const [filters, setFilters] = useState({ stationId: initialStationId ?? '', status: '' });
  const [page, setPage] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const listRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setPage(null); setError('');
    try {
      const value = await listFinanceInvoices({ ...filters, limit: 50 });
      if (request === listRequest.current) { setPage(value); setError(''); }
    } catch (failure) {
      if (request === listRequest.current) { setPage({ invoices: [] }); setError(treasuryError(failure)); }
    }
  }, [filters]);
  useEffect(() => { void load(); return () => { ++listRequest.current; }; }, [load, revision]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_preinvoices') || resources.includes('finance_receipts') || resources.includes('finance_approved_services')) setRevision(value => value + 1);
    });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, []);

  function openReceipt(receiptId, context) {
    setSelected(null);
    if (onOpenReceipt) onOpenReceipt(receiptId, context);
    else setTreasuryScope({ ...context, receiptId });
  }
  if (treasuryScope) return <div className="space-y-4"><button type="button" className="min-h-[40px] text-sm font-semibold text-accent-600" onClick={() => { setTreasuryScope(null); setRevision(value => value + 1); }}>Volver a facturas</button>
    <TreasuryPage initialStationId={treasuryScope.stationId} initialAirlineId={treasuryScope.airlineId} initialInvoiceId={treasuryScope.invoiceId} initialReceiptId={treasuryScope.receiptId} />
  </div>;
  const invoices = page?.invoices ?? [];
  const current = invoices.find(invoice => invoice.id === selected);
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Facturación" title="Facturas"
        description="Facturas e-CF simuladas con su saldo, vencimiento y cobros." />
      <FilterBar>
        {stations.length > 1 && <label className="text-xs font-semibold">Estación<select value={filters.stationId} onChange={event => setFilters(currentFilters => ({ ...currentFilters, stationId: event.target.value }))} className={fieldClass}>
          <option value="">Todas</option>{stations.map(station => <option key={station.stationId} value={station.stationId}>{station.stationCode}</option>)}</select></label>}
        <label className="text-xs font-semibold">Estado<select value={filters.status} onChange={event => setFilters(currentFilters => ({ ...currentFilters, status: event.target.value }))} className={fieldClass}>
          <option value="">Todos</option>{Object.entries(INVOICE_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      </FilterBar>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      {!page ? <p role="status" className="text-sm">Cargando facturas…</p> : invoices.length === 0 ? (
        <EmptyState icon={ReconciliationIcon} title="Sin facturas" description="Las facturas emitidas desde «Por facturar» aparecerán aquí." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[760px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-3">Factura</th><th className="p-3">Aerolínea</th><th className="p-3">Total</th><th className="p-3">Saldo</th><th className="p-3">Vence</th><th className="p-3">Estado</th></tr></thead>
            <tbody>{invoices.map(invoice => {
              const status = INVOICE_STATUS[invoice.status] ?? { label: invoice.status, tone: 'info' };
              return (
                <tr key={invoice.id} className="cursor-pointer border-t border-black/5 hover:bg-black/[.02] dark:border-white/5" onClick={() => setSelected(invoice.id)}>
                  <td className="p-3"><button type="button" className="text-left font-semibold text-accent-600" onClick={() => setSelected(invoice.id)}>{invoiceLabel(invoice)}</button><span className="block text-xs text-text-secondary-light">{invoice.stationCode}</span></td>
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
        description={current?.fiscalNumber ? `${current.fiscalNumber} · ${current.number}` : current?.number} widthClassName="lg:w-[560px]">
        {current && <InvoiceDetail key={current.id} invoiceId={current.id} revision={revision} onOpenReceipt={openReceipt} onChanged={message => { setNotice(message); setRevision(value => value + 1); }} />}
      </Drawer>
    </div>
  );
}
