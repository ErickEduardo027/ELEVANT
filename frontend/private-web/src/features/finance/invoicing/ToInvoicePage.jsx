'use client';

import { useEffect, useId, useState } from 'react';
import Modal from '../../../components/Modal';
import ReasonField, { validReason } from '../../../components/ReasonField';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { blockingReasonMessage, downloadInvoiceDocument, getInvoiceEmailDeliveries } from '../../../services/invoicingService';
import { reasonLabel, statusLabel } from '../../../services/emailDeliveries';
import { useToInvoiceData } from './useToInvoiceData';

const field = 'mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const chip = 'rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold dark:border-white/10';
const primary = 'rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

function money(value, currency) {
  if (value === null || value === undefined || !currency) return '—';
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
}

function date(value) {
  return new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}

const MAX_EMAIL_POLLS = 12;

/**
 * 1-N08: what the invoice really queued for the airline, read from the server. A queued email is «en cola», never
 * «enviado» (ADR-0022); an invoice nobody could receive says so, so Finance delivers the PDF another way.
 */
function InvoiceEmailStatus({ invoiceId, pollMs }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let active = true;
    getInvoiceEmailDeliveries(invoiceId)
      .then(data => { if (active) setState({ status: 'ready', data }); })
      .catch(failure => { if (active) setState({ status: failure?.status === 403 ? 'forbidden' : 'error', data: null }); });
    return () => { active = false; };
  }, [invoiceId, reads]);
  const reread = () => setReads(current => current + 1);
  const deliveries = state.data?.deliveries ?? [];
  const waiting = state.data?.smtpConfigured && deliveries.some(item => item.status === 'Pending');
  // While the mail server works, re-read a few times until the queue settles.
  useEffect(() => {
    if (!waiting || reads >= MAX_EMAIL_POLLS) return undefined;
    const timer = setTimeout(() => setReads(current => current + 1), pollMs);
    return () => clearTimeout(timer);
  }, [pollMs, reads, waiting]);

  if (state.status === 'loading') return <p role="status" className="mt-2 text-xs">Consultando el correo de la factura…</p>;
  if (state.status === 'forbidden') return <p className="mt-2 text-xs">No tiene permiso para ver el estado del correo de esta factura.</p>;
  if (state.status === 'error') return <p role="alert" className="mt-2 text-xs text-status-danger">No se pudo consultar el estado del correo.{' '}
    <button type="button" onClick={reread} className="font-semibold underline">Reintentar</button></p>;
  if (deliveries.length === 0) return <p role="status" className="mt-2 text-xs text-amber-700">
    No quedó ningún correo en cola: la aerolínea no tiene cuentas activas del portal ni correo de facturación. Descargue el PDF y entréguelo por otro canal.</p>;
  const pending = deliveries.filter(item => item.status === 'Pending');
  return <div aria-label="Correo de la factura" className="mt-2 text-xs">
    <p role="status">{pending.length === 0 ? 'Estado del correo a la aerolínea:'
      : state.data.smtpConfigured ? `Correo en cola para ${pending.length} destinatario(s); se confirmará al salir.`
        : `Correo en cola para ${pending.length} destinatario(s), pero el servidor de correo no está configurado: no saldrá hasta configurarlo. Descargue el PDF si la aerolínea lo necesita ya.`}</p>
    <ul className="mt-1 space-y-0.5">{deliveries.map(item => <li key={`${item.recipient}-${item.createdAt}`} className="[overflow-wrap:anywhere]">
      <strong>{item.recipient}</strong> · {statusLabel(item.status).label}{reasonLabel(item.reason) ? ` · ${reasonLabel(item.reason)}` : ''}
    </li>)}</ul>
    {pending.length > 0 && <button type="button" onClick={reread} className="mt-1 font-semibold text-accent-600 underline">Actualizar estado del correo</button>}
  </div>;
}

function IssuedInvoice({ issue, onDismiss, emailPollMs }) {
  const [download, setDownload] = useState('idle');
  const { invoice } = issue;
  async function save() {
    setDownload('loading');
    try {
      await downloadInvoiceDocument(invoice.invoiceId, `factura-${invoice.fiscalNumber}.pdf`);
      setDownload('idle');
    } catch {
      setDownload('error');
    }
  }
  return (
    <section aria-label="Factura emitida" className="rounded-2xl border border-status-success/30 bg-status-success/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-status-success">
        {invoice.replayed ? 'Factura ya emitida' : 'Factura emitida'}
      </p>
      <h2 className="mt-1 text-lg font-bold">e-NCF {invoice.fiscalNumber}</h2>
      <p className="mt-1 text-sm">{issue.airlineName} · {money(invoice.total, invoice.currencyCode)} con ITBIS 18 %</p>
      <p className="mt-1 text-xs text-text-secondary-light">
        Interno {invoice.number}. Simulación — sin validez fiscal.
      </p>
      <InvoiceEmailStatus invoiceId={invoice.invoiceId} pollMs={emailPollMs} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={download === 'loading'} className={primary}>
          {download === 'loading' ? 'Preparando PDF…' : 'Descargar PDF'}
        </button>
        <button type="button" onClick={onDismiss} className={chip}>Cerrar</button>
      </div>
      {download === 'error' && <p role="alert" className="mt-2 text-sm text-status-danger">No se pudo descargar el PDF. Reintente.</p>}
    </section>
  );
}

/** 4-N07: the reason of a no-charge closure (5 to 500 characters) and the operations it closes. */
function NoChargeDialog({ data, open, onClose }) {
  const [reason, setReason] = useState('');
  const closing = data.closure.status === 'closing';
  const operations = data.issue.operations ?? [];
  async function confirm() {
    if (await data.closeWithoutCharge(reason)) { setReason(''); onClose(); }
  }
  return <Modal open={open} onClose={closing ? () => {} : onClose} title="Cerrar sin cargo" busy={closing}
    footer={<>
      <button type="button" className={chip} onClick={onClose} disabled={closing}>Cancelar</button>
      <button type="button" className={primary} onClick={confirm} disabled={closing || !validReason(reason)}>
        {closing ? 'Cerrando…' : 'Confirmar cierre'}
      </button>
    </>}>
    <p>Estas operaciones salen de «Por facturar» sin factura ni e-NCF. El cierre no se revierte.</p>
    <p className="mt-2 font-mono text-xs">{operations.map(item => item.operationCode).join(' · ')}</p>
    <div className="mt-3">
      <ReasonField label="Motivo del cierre sin cargo" value={reason} onChange={setReason}
        hint="Queda en la auditoría de Finanzas." />
    </div>
    {data.closure.status === 'error' && <p role="alert" className="mt-2 text-sm text-status-danger">{data.closure.message}</p>}
  </Modal>;
}

/**
 * «Por facturar» (ADR-0035, phase 4, block A): approved operations not yet invoiced, from the oldest, issued as one
 * simulated e-CF invoice within the limits of one invoice, or closed without charge when their valuation is zero.
 */
export default function ToInvoicePage({ initialStationId, emailPollMs = 5000 }) {
  const data = useToInvoiceData(initialStationId);
  const { access } = useDepartmentAccess();
  const canIssue = Boolean(access?.can('finance.invoicing.issue'));
  const [closing, setClosing] = useState(false);
  const base = useId();
  const { summary, limits } = data;
  const shown = data.status === 'loading' || data.status === 'success';

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Facturación</p>
        <h1 className="mt-1 text-2xl font-bold">Por facturar</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Operaciones aprobadas por OCC que aún no tienen factura, de la más antigua a la más reciente. Facture una sola o agrupe varias de la misma aerolínea por semana o mes.
        </p>
      </header>

      {data.issue.status === 'issued' && <IssuedInvoice issue={data.issue} onDismiss={data.dismissIssue} emailPollMs={emailPollMs} />}
      {data.issue.status === 'error' && <p role="alert" className="rounded-xl bg-status-danger/10 p-4 text-sm">{data.issue.message}</p>}
      {data.issue.status === 'zero' && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-status-warning/10 p-4 text-sm">
        <span>{data.issue.message}</span>
        {canIssue && <button type="button" className={primary} onClick={() => { data.resetClosure(); setClosing(true); }}>Cerrar sin cargo</button>}
      </div>}
      {data.issue.status === 'closed' && <p role="status" className="rounded-xl bg-status-success/10 p-4 text-sm">
        {data.issue.count === 1 ? '1 operación cerrada sin cargo.' : `${data.issue.count} operaciones cerradas sin cargo.`}</p>}

      <section className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold">Estación
            <select aria-label="Estación" value={data.stationId} onChange={event => data.setStationId(event.target.value)} className={field}>
              {data.scopes.map(scope => <option key={scope.stationId} value={scope.stationId}>{scope.stationCode}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Desde
            <input aria-label="Operaciones desde" type="date" value={data.from} onChange={event => data.setFrom(event.target.value)} className={field} />
          </label>
          <label className="text-xs font-semibold">Hasta
            <input aria-label="Operaciones hasta" type="date" value={data.to} onChange={event => data.setTo(event.target.value)} className={field} />
          </label>
          <label className="text-xs font-semibold">Aerolínea
            <select aria-label="Filtrar por aerolínea" value={data.airline} onChange={event => data.setAirline(event.target.value)} className={field}>
              <option value="all">Todas</option>
              {data.airlines.map(item => <option key={item.airlineId} value={item.airlineId}>{item.airlineName} ({item.pendingCount})</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Buscar
            <input aria-label="Buscar operaciones" value={data.query} onChange={event => data.setQuery(event.target.value)}
              placeholder="Operación, vuelo o contrato" className={field} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-5">
            <span className="text-xs font-semibold">Período:</span>
            <button type="button" className={chip} onClick={data.clearPeriod}>Todo lo pendiente</button>
            <button type="button" className={chip} onClick={() => data.setWeek(-1)}>Semana pasada</button>
            <button type="button" className={chip} onClick={() => data.setWeek(0)}>Esta semana</button>
            <button type="button" className={chip} onClick={() => data.setMonth(-1)}>Mes pasado</button>
            <button type="button" className={chip} onClick={() => data.setMonth(0)}>Este mes</button>
          </div>
        </div>
      </section>

      <section aria-label="Límites de una factura" className="rounded-xl border border-black/5 bg-black/[0.02] p-3 text-xs dark:border-white/5 dark:bg-white/[0.03]">
        Una factura admite hasta {limits.maxOperations} operaciones, {limits.maxLines} líneas y operaciones de un máximo de {limits.maxDays} días.
        Cada servicio es una línea, más sus cargos y su mínimo contractual.
      </section>

      {data.status === 'invalid-range' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Elija «Hasta» igual o posterior a «Desde», o deje las fechas vacías para ver todo lo pendiente.</p>}
      {data.status === 'forbidden' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Esta sesión no tiene acceso vigente a la estación solicitada.</p>}
      {data.status === 'unauthorized' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Su sesión expiró. Inicie sesión de nuevo.</p>}
      {data.status === 'error' && <div role="alert" className="rounded-2xl bg-white p-6 dark:bg-surface-dark-card">
        <p className="font-semibold text-status-danger">No se pudieron cargar las operaciones por facturar.</p>
        <button type="button" onClick={data.retry} className={`mt-3 ${primary}`}>Reintentar</button>
      </div>}
      {data.stale && data.status === 'success' && <p role="alert" className="rounded-xl bg-status-warning/10 p-3 text-xs">
        No se pudo actualizar la lista; se muestran los datos anteriores.{' '}
        <button type="button" onClick={data.retry} className="font-semibold underline">Reintentar</button></p>}

      {summary.count > 0 && <section aria-label="Resumen de la factura" className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-600/20 bg-white p-4 shadow-md dark:bg-surface-dark-card">
        <div className="text-sm">
          <p className="font-semibold">{summary.count} {summary.count === 1 ? 'operación' : 'operaciones'} · {summary.airlineName}</p>
          <p className="text-xs text-text-secondary-light">
            {summary.lines} de {limits.maxLines} líneas · Estimado: subtotal {money(summary.net, summary.currency)} · ITBIS 18 % {money(summary.tax, summary.currency)} · total {money(summary.total, summary.currency)}.
            La factura aplica paquetes, mínimos y cargos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip} onClick={data.selectAirline}>Toda la aerolínea del período</button>
          <button type="button" className={chip} onClick={data.clearSelection}>Quitar selección</button>
          {canIssue && <button type="button" onClick={data.issueInvoice} disabled={data.issue.status === 'issuing'}
            className="rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">
            {data.issue.status === 'issuing' ? 'Emitiendo factura…' : 'Emitir factura'}
          </button>}
        </div>
        {data.notice && <p role="status" className="basis-full text-xs text-amber-700">{data.notice}</p>}
      </section>}

      {shown &&
        <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
          {data.status === 'loading'
            ? <div data-testid="to-invoice-loading" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
            : data.operations.length
              ? <div className="overflow-x-auto"><table className="table-stack w-full text-left text-sm">
                <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]"><tr>
                  <th className="px-3 py-3">Elegir</th><th className="px-5 py-3">Operación</th><th className="px-5 py-3">Aerolínea / vuelo</th>
                  <th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Servicios</th><th className="px-5 py-3 text-right">Líneas</th>
                  <th className="px-5 py-3 text-right">Neto estimado</th><th className="px-5 py-3">Estado</th>
                </tr></thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {data.operations.map(item => {
                    const problem = data.selectedIds.includes(item.id) ? null : data.whyNot(item);
                    const describedBy = `${base}-${item.id}-why`;
                    return <tr key={item.id}>
                      <td className="px-3 py-4"><input type="checkbox" aria-label={`Seleccionar ${item.operationCode}`}
                        aria-describedby={problem ? describedBy : undefined}
                        checked={data.selectedIds.includes(item.id)} disabled={!data.canSelect(item)} onChange={() => data.toggle(item.id)} /></td>
                      <td className="px-5 py-4"><span className="block font-mono text-xs font-semibold">{item.operationCode}</span>
                        <span className="text-xs text-text-secondary-light">{item.contractCode || 'Sin contrato'}</span></td>
                      <td className="px-5 py-4">{item.airlineName}<span className="block text-xs text-text-secondary-light">{item.flightNumber || '—'}</span></td>
                      <td className="px-5 py-4">{date(item.operationDate)}</td>
                      <td className="px-5 py-4 text-xs">{item.services.map(service => service.serviceName).join(' · ') || '—'}</td>
                      <td className="px-5 py-4 text-right tabular-nums">{item.lineEstimate}</td>
                      <td className="px-5 py-4 text-right font-semibold tabular-nums">{money(item.estimate, item.currency)}</td>
                      <td className="px-5 py-4">{item.ready
                        ? <span className="rounded-full bg-status-success/10 px-2.5 py-1 text-xs font-semibold text-status-success">Lista para facturar</span>
                        : <ul aria-label={`Motivos de ${item.operationCode}`} className="space-y-1 text-xs text-amber-700">
                          {item.blockingReasons.map(code => <li key={code}>{blockingReasonMessage(code)}</li>)}</ul>}
                        {item.ready && item.estimate === 0 && <span className="mt-1 block text-xs text-text-secondary-light">
                          Sin importe estimado: si la factura da 0, ciérrela sin cargo.</span>}
                        {problem && <span id={describedBy} className="mt-1 block text-xs text-text-secondary-light">{item.ready ? problem : 'No se puede elegir: vea los motivos.'}</span>}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table></div>
              : <p className="p-6 text-sm text-text-secondary-light">{data.totalLoaded
                ? 'Ninguna operación coincide con la búsqueda.'
                : 'No hay operaciones aprobadas pendientes de facturar.'}</p>}
        </section>}
      {data.status === 'success' && data.totalPending > 0 && <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary-light">
        <p role="status">Mostrando {data.totalLoaded} de {data.totalPending} pendientes.</p>
        {data.hasMore && <button type="button" className={chip} onClick={data.loadMore} disabled={data.more === 'loading'}>
          {data.more === 'loading' ? 'Cargando…' : 'Cargar más'}</button>}
        {data.more === 'error' && <span role="alert" className="text-status-danger">No se pudieron cargar más operaciones.{' '}
          <button type="button" onClick={data.loadMore} className="font-semibold underline">Reintentar</button></span>}
      </div>}

      <NoChargeDialog data={data} open={closing && data.issue.status === 'zero'} onClose={() => setClosing(false)} />
    </div>
  );
}
