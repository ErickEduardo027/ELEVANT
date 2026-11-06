'use client';

import { useEffect, useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { downloadInvoiceDocument, getInvoiceEmailDeliveries } from '../../../services/invoicingService';
import { reasonLabel, statusLabel } from '../../../services/emailDeliveries';
import { useToInvoiceData } from './useToInvoiceData';

const BLOCKING_LABELS = {
  approved_evidence_mismatch: 'Evidencia aprobada ausente o distinta',
  service_not_completed: 'Servicio no completado',
  no_executed_quantity: 'Sin cantidad ejecutada',
  missing_frozen_rate: 'Sin tarifa congelada',
  invalid_currency: 'Moneda inválida',
  invalid_billing_unit: 'Unidad de cobro inválida',
  invalid_amount: 'Importe fuera de rango',
  nothing_to_invoice: 'Sin servicios completados',
  requires_review: 'Requiere revisión',
};

const field = 'mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const chip = 'rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold dark:border-white/10';

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
        <button type="button" onClick={save} disabled={download === 'loading'}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {download === 'loading' ? 'Preparando PDF…' : 'Descargar PDF'}
        </button>
        <button type="button" onClick={onDismiss} className={chip}>Cerrar</button>
      </div>
      {download === 'error' && <p role="alert" className="mt-2 text-sm text-status-danger">No se pudo descargar el PDF. Reintente.</p>}
    </section>
  );
}

/** «Por facturar»: approved operations not yet invoiced, issued as one simulated e-CF invoice (ADR-0035). */
export default function ToInvoicePage({ initialStationId, emailPollMs = 5000 }) {
  const data = useToInvoiceData(initialStationId);
  const { access } = useDepartmentAccess();
  const canIssue = Boolean(access?.can('finance.invoicing.issue'));
  const { summary } = data;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Facturación</p>
        <h1 className="mt-1 text-2xl font-bold">Por facturar</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Operaciones aprobadas por OCC que aún no tienen factura. Facture una sola o agrupe varias de la misma aerolínea por semana o mes.
        </p>
      </header>

      {data.issue.status === 'issued' && <IssuedInvoice issue={data.issue} onDismiss={data.dismissIssue} emailPollMs={emailPollMs} />}
      {data.issue.status === 'error' && <p role="alert" className="rounded-xl bg-status-danger/10 p-4 text-sm">{data.issue.message}</p>}

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
              {data.airlines.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Buscar
            <input aria-label="Buscar operaciones" value={data.query} onChange={event => data.setQuery(event.target.value)}
              placeholder="Operación, vuelo o contrato" className={field} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-5">
            <span className="text-xs font-semibold">Período:</span>
            <button type="button" className={chip} onClick={() => data.setWeek(-1)}>Semana pasada</button>
            <button type="button" className={chip} onClick={() => data.setWeek(0)}>Esta semana</button>
            <button type="button" className={chip} onClick={() => data.setMonth(-1)}>Mes pasado</button>
            <button type="button" className={chip} onClick={() => data.setMonth(0)}>Este mes</button>
          </div>
        </div>
      </section>

      {data.status === 'invalid-range' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Elija un período de hasta 31 días, con «Hasta» igual o posterior a «Desde».</p>}
      {data.status === 'forbidden' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Esta sesión no tiene acceso vigente a la estación solicitada.</p>}
      {data.status === 'unauthorized' && <p role="alert" className="rounded-xl bg-status-warning/10 p-4 text-sm">
        Su sesión expiró. Inicie sesión de nuevo.</p>}
      {data.status === 'error' && <div role="alert" className="rounded-2xl bg-white p-6 dark:bg-surface-dark-card">
        <p className="font-semibold text-status-danger">No se pudieron cargar las operaciones por facturar.</p>
        <button type="button" onClick={data.retry} className="mt-3 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
      </div>}

      {summary.count > 0 && <section aria-label="Resumen de la factura" className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-600/20 bg-white p-4 shadow-md dark:bg-surface-dark-card">
        <div className="text-sm">
          <p className="font-semibold">{summary.count} {summary.count === 1 ? 'operación' : 'operaciones'} · {summary.airlineName}</p>
          <p className="text-xs text-text-secondary-light">
            Estimado: subtotal {money(summary.net, summary.currency)} · ITBIS 18 % {money(summary.tax, summary.currency)} · total {money(summary.total, summary.currency)}.
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
      </section>}

      {(data.status === 'loading' || data.status === 'success') &&
        <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
          {data.status === 'loading'
            ? <div data-testid="to-invoice-loading" className="h-64 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
            : data.operations.length
              ? <div className="overflow-x-auto"><table className="table-stack w-full text-left text-sm">
                <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]"><tr>
                  <th className="px-3 py-3">Elegir</th><th className="px-5 py-3">Operación</th><th className="px-5 py-3">Aerolínea / vuelo</th>
                  <th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Servicios</th>
                  <th className="px-5 py-3 text-right">Neto estimado</th><th className="px-5 py-3">Estado</th>
                </tr></thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {data.operations.map(item => <tr key={item.id}>
                    <td className="px-3 py-4"><input type="checkbox" aria-label={`Seleccionar ${item.operationCode}`}
                      checked={data.selectedIds.includes(item.id)} disabled={!data.canSelect(item)} onChange={() => data.toggle(item.id)} /></td>
                    <td className="px-5 py-4"><span className="block font-mono text-xs font-semibold">{item.operationCode}</span>
                      <span className="text-xs text-text-secondary-light">{item.contractCode || 'Sin contrato'}</span></td>
                    <td className="px-5 py-4">{item.airlineName}<span className="block text-xs text-text-secondary-light">{item.flightNumber || '—'}</span></td>
                    <td className="px-5 py-4">{date(item.operationDate)}</td>
                    <td className="px-5 py-4 text-xs">{item.services.filter(service => service.ready).map(service => service.serviceName).join(' · ') || '—'}</td>
                    <td className="px-5 py-4 text-right font-semibold tabular-nums">{money(item.estimate, item.currency)}</td>
                    <td className="px-5 py-4">{item.ready
                      ? <span className="rounded-full bg-status-success/10 px-2.5 py-1 text-xs font-semibold text-status-success">Lista para facturar</span>
                      : <span className="rounded-full bg-status-warning/10 px-2.5 py-1 text-xs font-semibold text-amber-700">{BLOCKING_LABELS[item.blockingReason] ?? 'Requiere revisión'}</span>}</td>
                  </tr>)}
                </tbody>
              </table></div>
              : <p className="p-6 text-sm text-text-secondary-light">{data.totalOperations
                ? 'Ninguna operación coincide con los filtros.'
                : 'No hay operaciones aprobadas pendientes de facturar en este período.'}</p>}
        </section>}
      {data.status === 'success' && data.hasMore && <p role="status" className="text-xs text-text-secondary-light">
        El período tiene más servicios de los que se muestran. Acote las fechas para ver todas las operaciones.</p>}
    </div>
  );
}
