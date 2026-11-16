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
import { invoiceLabel } from '../financeLabels';
import AdjustmentNotesPanel from '../treasury/AdjustmentNotesPanel';
import StatementPage from '../treasury/StatementPage';
import TreasuryPage from '../treasury/TreasuryPage';
import { formatMoney, getFinanceInvoice, INVOICE_PAGE_SIZE, listFinanceInvoices } from '../../../services/financeBookService';
import { invoiceListMessage } from '../../../services/financeErrors';
import { formatTreasuryMoney, getTreasuryStatement, treasuryError, treasuryToday } from '../../../services/financeTreasuryService';
import { downloadInvoiceDocument, getInvoiceCardPayments } from '../../../services/invoicingService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const secondaryClass = 'min-h-[40px] rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-white/10';
/** Longest search the server accepts (4-N21): an e-NCF or number prefix, or part of the airline name. */
export const INVOICE_SEARCH_MAX_LENGTH = 40;
/** Typing pauses this long before «Facturas» searches, so each keystroke does not reach the API. */
export const INVOICE_SEARCH_DEBOUNCE_MS = 350;
/** 4-N24: an invoice credited to zero without any payment is «Anulada», never «Pagada». */
export const INVOICE_STATUS = {
  Pending: { label: 'Pendiente', tone: 'info' }, PartiallyPaid: { label: 'Pago parcial', tone: 'warning' },
  Paid: { label: 'Pagada', tone: 'success' }, Overdue: { label: 'Vencida', tone: 'danger' },
  Voided: { label: 'Anulada', tone: 'neutral' },
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
    {access?.can('finance.adjustments.read') && <AdjustmentNotesPanel invoiceId={invoiceId} invoiceNumber={summary.fiscalNumber ?? summary.number} currencyCode={summary.currencyCode}
      onChanged={() => { void load(); onChanged('Nota de ajuste registrada.'); }} />}
  </div>;
}

/**
 * The tabs of «Facturas» (4-A): with the simplified menu, «Cobros» and «Estados de cuenta» are reached from here.
 * Each one shows only with the permission its screen reads with.
 */
const INVOICE_TABS = [
  { id: 'invoices', label: 'Facturas', permissions: null },
  { id: 'receipts', label: 'Cobros', permissions: ['finance.receipts.read'] },
  { id: 'statements', label: 'Estados de cuenta', permissions: ['finance.receipts.read', 'finance.statements.read'] },
];

const queryKey = query => JSON.stringify([query.stationId, query.status, query.search, query.page]);

/**
 * 4-N11: the feed resources after which «Facturas» reads again: an invoice issued, paid by card, applied, reversed or
 * adjusted (finance_invoices), a receipt, or an operation invoiced.
 */
export const INVOICE_RESOURCES = Object.freeze(['finance_invoices', 'finance_receipts', 'finance_approved_services']);

/**
 * The invoices of the actor's stations, newest first (4-N21): pages of 25 with «Anterior» and «Siguiente», and one
 * search by e-NCF, number or airline that waits for a pause in typing and starts again on the first page. A reload
 * keeps the visible page; an error is explained by its Problem Details code.
 */
function InvoiceList({ initialStationId, onOpenReceipt }) {
  const [treasuryScope, setTreasuryScope] = useState(null);
  const [revision, setRevision] = useState(0);
  const stations = (readSession()?.stationScopes ?? []).filter(scope => scope?.stationId);
  const [query, setQuery] = useState(() => ({ stationId: initialStationId ?? '', status: '', search: '', page: 1 }));
  const [searchText, setSearchText] = useState('');
  const [state, setState] = useState({ page: null, shownKey: '', error: null, loading: true });
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const text = searchText.trim();
    if (text === query.search) return undefined;
    const timer = window.setTimeout(() => setQuery(current => ({ ...current, search: text, page: 1 })),
      INVOICE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, query.search]);

  const listRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++listRequest.current;
    const key = queryKey(query);
    setState(current => ({ ...current, error: null, loading: true }));
    try {
      const value = await listFinanceInvoices({ stationId: query.stationId, status: query.status,
        search: query.search, page: query.page, limit: INVOICE_PAGE_SIZE });
      if (request === listRequest.current) setState({ page: value, shownKey: key, error: null, loading: false });
    } catch (failure) {
      // A failed reload keeps the page on screen; a page of another query or a refusal is not shown as current.
      if (request === listRequest.current) setState(current => (current.shownKey === key && failure?.status !== 403
        ? { ...current, error: failure, loading: false }
        : { page: null, shownKey: '', error: failure, loading: false }));
    }
  }, [query]);
  useEffect(() => {
    // The cleanup retires the request in flight: a response of an older query or revision is never shown.
    const requests = listRequest;
    void load();
    return () => { requests.current += 1; };
  }, [load, revision]);
  useEffect(() => {
    // 4-N11: the list reads again when the window regains focus, like «Por facturar».
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    if (process.env.NODE_ENV === 'test') return () => window.removeEventListener('focus', refresh);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (INVOICE_RESOURCES.some(resource => resources.includes(resource))) refresh();
    });
    void observer.start().catch(() => {});
    return () => { window.removeEventListener('focus', refresh); void observer.stop(); };
  }, []);

  function openReceipt(receiptId, context) {
    setSelected(null);
    if (onOpenReceipt) onOpenReceipt(receiptId, context);
    else setTreasuryScope({ ...context, receiptId });
  }
  const filter = (field, value) => setQuery(current => ({ ...current, [field]: value, page: 1 }));
  const goTo = page => setQuery(current => ({ ...current, page }));
  if (treasuryScope) return <div className="space-y-4"><button type="button" className="min-h-[40px] text-sm font-semibold text-accent-600" onClick={() => { setTreasuryScope(null); setRevision(value => value + 1); }}>Volver a facturas</button>
    <TreasuryPage initialStationId={treasuryScope.stationId} initialAirlineId={treasuryScope.airlineId} initialInvoiceId={treasuryScope.invoiceId} initialReceiptId={treasuryScope.receiptId} />
  </div>;
  const invoices = state.page?.invoices ?? [];
  const shownPage = state.page?.page ?? query.page;
  const current = invoices.find(invoice => invoice.id === selected);
  const forbidden = state.error?.status === 403;
  const message = state.error ? invoiceListMessage(state.error) : '';
  const statusLabel = INVOICE_STATUS[query.status]?.label;
  const empty = shownPage > 1
    ? { title: 'No hay más facturas', description: 'Esta página quedó vacía.', action: { label: 'Ir a la primera página', onClick: () => goTo(1) } }
    : query.search
      ? { title: 'Ninguna factura coincide con la búsqueda', description: `Revise el e-NCF, el número o el nombre de la aerolínea («${query.search}»).`,
        action: { label: 'Limpiar búsqueda', onClick: () => { setSearchText(''); filter('search', ''); } } }
      : statusLabel
        ? { title: 'Sin facturas en este estado', description: `No hay facturas «${statusLabel}» en las estaciones elegidas.` }
        : { title: 'Sin facturas', description: 'Las facturas emitidas desde «Por facturar» aparecerán aquí.' };
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Facturación" title="Facturas"
        description="Facturas e-CF simuladas con su saldo, vencimiento y cobros." />
      <FilterBar>
        <label className="text-xs font-semibold">Buscar (e-NCF, número o aerolínea)<input type="search" value={searchText}
          maxLength={INVOICE_SEARCH_MAX_LENGTH} placeholder="E31…, NF-… o aerolínea" onChange={event => setSearchText(event.target.value)}
          className={fieldClass} /></label>
        {stations.length > 1 && <label className="text-xs font-semibold">Estación<select value={query.stationId} onChange={event => filter('stationId', event.target.value)} className={fieldClass}>
          <option value="">Todas</option>{stations.map(station => <option key={station.stationId} value={station.stationId}>{station.stationCode}</option>)}</select></label>}
        <label className="text-xs font-semibold">Estado<select value={query.status} onChange={event => filter('status', event.target.value)} className={fieldClass}>
          <option value="">Todos</option>{Object.entries(INVOICE_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      </FilterBar>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {forbidden ? <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{message}</p>
        : state.error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
          <span className="min-w-0 flex-1">{message}</span>
          <button type="button" className="font-semibold underline" onClick={() => setRevision(value => value + 1)}>Reintentar</button>
        </div>}
      {state.page && state.loading && <p role="status" className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Actualizando…</p>}
      {!forbidden && (!state.page ? !state.error && <p role="status" className="text-sm">Cargando facturas…</p> : invoices.length === 0 ? (
        <EmptyState icon={ReconciliationIcon} title={empty.title} description={empty.description} action={empty.action} />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table aria-busy={state.loading} className="table-stack w-full min-w-[760px] text-left text-sm">
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
      ))}
      {!forbidden && state.page && (invoices.length > 0 || shownPage > 1) && <nav aria-label="Páginas de facturas" className="flex items-center justify-end gap-3 text-sm">
        <button type="button" className={secondaryClass} disabled={shownPage <= 1 || state.loading} onClick={() => goTo(shownPage - 1)}>Anterior</button>
        <span>Página {shownPage}</span>
        <button type="button" className={secondaryClass} disabled={!state.page.hasMore || state.loading} onClick={() => goTo(shownPage + 1)}>Siguiente</button>
      </nav>}
      <Drawer open={Boolean(current)} onClose={() => setSelected(null)} title={current ? `Factura ${current.airline}` : ''}
        description={current?.fiscalNumber ? `${current.fiscalNumber} · ${current.number}` : current?.number} widthClassName="lg:w-[560px]">
        {current && <InvoiceDetail key={current.id} invoiceId={current.id} revision={revision} onOpenReceipt={openReceipt} onChanged={message => { setNotice(message); setRevision(value => value + 1); }} />}
      </Drawer>
    </div>
  );
}

/**
 * «Facturas» of Finance (4-A, 4-N19, 4-N21): the e-CF invoices with their balance, and, as tabs, «Cobros» (receipts
 * and applications) and «Estados de cuenta» when the account may read them.
 */
export default function InvoicesPage({ initialStationId, onOpenReceipt }) {
  const { access } = useDepartmentAccess();
  const tabs = INVOICE_TABS.filter(tab => !tab.permissions || tab.permissions.some(code => access?.can(code)));
  const [tabId, setTabId] = useState('invoices');
  const active = tabs.some(tab => tab.id === tabId) ? tabId : 'invoices';
  const panel = id => ({ role: tabs.length > 1 ? 'tabpanel' : undefined, id: `finance-invoices-panel-${id}`,
    'aria-labelledby': tabs.length > 1 ? `finance-invoices-tab-${id}` : undefined });
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      {tabs.length > 1 && <div role="tablist" aria-label="Facturas, cobros y estados de cuenta" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`finance-invoices-tab-${tab.id}`}
          aria-selected={active === tab.id} aria-controls={`finance-invoices-panel-${tab.id}`} onClick={() => setTabId(tab.id)}
          className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${active === tab.id ? 'bg-accent-600 text-white' : 'text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5'}`}>
          {tab.label}
        </button>)}
      </div>}
      {/* The list stays mounted while another tab is open, so its page and search are kept. */}
      <div {...panel('invoices')} hidden={active !== 'invoices'}>
        <InvoiceList initialStationId={initialStationId} onOpenReceipt={onOpenReceipt} />
      </div>
      {active === 'receipts' && <div {...panel('receipts')}><TreasuryPage initialStationId={initialStationId} /></div>}
      {active === 'statements' && <div {...panel('statements')}><StatementPage initialStationId={initialStationId} /></div>}
    </div>
  );
}
