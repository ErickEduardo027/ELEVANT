import { useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getPreinvoiceDraft, getFinancePreinvoiceDisputes } from '../../../services/approvedServicesService';
import { getFinancePreinvoices, submitFinancePreinvoice, issueFinanceInvoice,
  getFinanceInvoiceByPreinvoice, getFinancePaymentByInvoice,
  getFinanceInvoiceDocument, getFinancePaymentReceipt,
  recordNonFiscalPayment, resolveFinancePreinvoiceDispute } from '../../../services/financePreinvoiceService';

const STATUS = {
  Draft: 'Borrador', Submitted: 'Enviada', Disputed: 'En disputa',
  Accepted: 'Aceptada', Invoiced: 'Facturada', Voided: 'Anulada',
};
const EMPTY_PAYMENT_ATTEMPT = { status: 'idle', id: null, invoiceId: null,
  requestId: null, reference: '' };
const EMPTY_RESOLUTION_ATTEMPT = { status: 'idle', id: null, requestId: null,
  decision: null, reason: '' };

function money(value, currency) {
  return `${currency} ${Number(value).toFixed(4)}`;
}

export default function PreinvoicesPage({ initialStationId }) {
  const session = useMemo(() => readSession(), []);
  const scopes = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(
    scopes.some(scope => scope.stationId === initialStationId)
      ? initialStationId : scopes[0]?.stationId ?? '');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', result: null });
  const [detail, setDetail] = useState({ status: 'idle', value: null });
  const [submission, setSubmission] = useState({ status: 'idle', id: null });
  const [invoiceIssue, setInvoiceIssue] = useState({ status: 'idle', id: null,
    requestId: null, number: null });
  const [paymentAttempt, setPaymentAttempt] = useState(EMPTY_PAYMENT_ATTEMPT);
  const [resolutionAttempt, setResolutionAttempt] = useState(EMPTY_RESOLUTION_ATTEMPT);
  const [pdfAttempt, setPdfAttempt] = useState({ status: 'idle', kind: null });
  const detailGeneration = useRef(0);
  const selectionGeneration = useRef(0);
  const selectedPreinvoiceId = useRef(null);
  const listScope = useRef({ stationId, page });

  useEffect(() => () => { detailGeneration.current += 1; selectionGeneration.current += 1; }, []);

  useEffect(() => {
    if (!session?.accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_preinvoices')) setRevision(value => value + 1);
    });
    void observer.start();
    const refresh = () => setRevision(value => value + 1);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 25_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [session?.accountId]);

  useEffect(() => {
    const sameScope = listScope.current.stationId === stationId &&
      listScope.current.page === page;
    listScope.current = { stationId, page };
    const preservePending = sameScope && (submission.status === 'pending' ||
      invoiceIssue.status === 'pending' || paymentAttempt.status === 'pending' ||
      resolutionAttempt.status === 'pending');
    const reopenId = sameScope && !preservePending ? selectedPreinvoiceId.current : null;
    if (!stationId) {
      detailGeneration.current += 1;
      selectionGeneration.current += 1;
      setDetail({ status: 'idle', value: null });
      setSubmission({ status: 'idle', id: null });
      setInvoiceIssue({ status: 'idle', id: null, requestId: null, number: null });
      setPaymentAttempt(EMPTY_PAYMENT_ATTEMPT);
      setResolutionAttempt(EMPTY_RESOLUTION_ATTEMPT);
      setPdfAttempt({ status: 'idle', kind: null });
      setState({ status: 'forbidden', result: null });
      return undefined;
    }
    const controller = new AbortController();
    if (!preservePending) {
      detailGeneration.current += 1;
      setDetail({ status: 'idle', value: null });
    }
    setState({ status: 'loading', result: null });
    getFinancePreinvoices({ stationId, page, limit: 20 }, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setState({ status: 'success', result });
      }).catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error', result: null });
      });
    if (reopenId) void openDetail(reopenId, { preserveAttempts: true });
    return () => controller.abort();
  }, [stationId, page, revision]);

  async function openDetail(id, { preserveAttempts = false } = {}) {
    selectedPreinvoiceId.current = id;
    const generation = ++detailGeneration.current;
    if (!preserveAttempts) {
      selectionGeneration.current += 1;
      setSubmission({ status: 'idle', id: null });
      setInvoiceIssue({ status: 'idle', id: null, requestId: null, number: null });
      setPaymentAttempt(EMPTY_PAYMENT_ATTEMPT);
      setResolutionAttempt(EMPTY_RESOLUTION_ATTEMPT);
      setPdfAttempt({ status: 'idle', kind: null });
    }
    setDetail({ status: 'loading', value: null });
    try {
      const [preinvoice, disputeList] = await Promise.all([
        getPreinvoiceDraft(id, stationId), getFinancePreinvoiceDisputes(id)]);
      const invoice = preinvoice.status === 'Invoiced'
        ? await getFinanceInvoiceByPreinvoice(id) : null;
      const payment = invoice ? await getFinancePaymentByInvoice(invoice.id) : null;
      const value = { ...preinvoice, disputes: disputeList.disputes, invoice,
        payment: payment?.payment ?? null };
      if (generation === detailGeneration.current)
        setDetail({ status: 'success', value });
    } catch (error) {
      if (generation === detailGeneration.current)
        setDetail({ status: error?.status === 404 ? 'not-found' : 'error', value: null });
    }
  }

  function changePage(delta) {
    selectedPreinvoiceId.current = null;
    detailGeneration.current += 1;
    selectionGeneration.current += 1;
    setDetail({ status: 'idle', value: null });
    setSubmission({ status: 'idle', id: null });
    setInvoiceIssue({ status: 'idle', id: null, requestId: null, number: null });
    setPaymentAttempt(EMPTY_PAYMENT_ATTEMPT);
    setResolutionAttempt(EMPTY_RESOLUTION_ATTEMPT);
    setPdfAttempt({ status: 'idle', kind: null });
    setPage(value => value + delta);
  }

  async function confirmSubmission() {
    const id = detail.value?.id;
    if (!id || detail.value.status !== 'Draft' ||
        submission.id !== id || submission.status === 'pending') return;
    const generation = detailGeneration.current;
    setSubmission({ status: 'pending', id });
    try {
      await submitFinancePreinvoice(id);
      if (generation !== detailGeneration.current) return;
      selectedPreinvoiceId.current = null;
      setDetail({ status: 'idle', value: null });
      setSubmission({ status: 'success', id });
      setRevision(value => value + 1);
    } catch (error) {
      if (generation !== detailGeneration.current) return;
      if (error?.status === 401 || error?.status === 403) {
        detailGeneration.current += 1;
        setDetail({ status: 'idle', value: null });
        setState({ status: error.status === 401 ? 'unauthorized' : 'forbidden', result: null });
        setSubmission({ status: 'idle', id: null });
        return;
      }
      setSubmission({ status: error?.status === 409 ? 'conflict' : 'error', id });
      if (error?.status === 409) setRevision(value => value + 1);
    }
  }

  async function confirmInvoiceIssue() {
    const { id, requestId, status } = invoiceIssue;
    if (!id || !requestId || !['confirm', 'error'].includes(status) ||
        (status === 'confirm' && (detail.value?.id !== id ||
          detail.value.status !== 'Accepted'))) return;
    const generation = selectionGeneration.current;
    setInvoiceIssue(current => ({ ...current, status: 'pending' }));
    try {
      const result = await issueFinanceInvoice({ preinvoiceId: id, requestId });
      if (generation !== selectionGeneration.current) return;
      selectedPreinvoiceId.current = null;
      setDetail({ status: 'idle', value: null });
      setInvoiceIssue(current => ({ ...current, status: 'success', number: result.number }));
      setRevision(value => value + 1);
    } catch (error) {
      if (generation !== selectionGeneration.current) return;
      if (error?.status === 401 || error?.status === 403) {
        detailGeneration.current += 1;
        selectionGeneration.current += 1;
        setDetail({ status: 'idle', value: null });
        setState({ status: error.status === 401 ? 'unauthorized' : 'forbidden', result: null });
        setInvoiceIssue({ status: 'idle', id: null, requestId: null, number: null });
        return;
      }
      setInvoiceIssue(current => ({ ...current,
        status: error?.status === 409 ? 'conflict' : 'error' }));
      if (error?.status === 409) setRevision(value => value + 1);
    }
  }

  async function confirmPayment() {
    const { id, invoiceId, requestId, reference, status } = paymentAttempt;
    if (!id || !invoiceId || !requestId || !['edit', 'error'].includes(status) ||
        !/^[A-Za-z0-9-]{8,80}$/.test(reference) ||
        detail.value?.id !== id || detail.value.invoice?.id !== invoiceId ||
        detail.value.payment) return;
    const generation = detailGeneration.current;
    setPaymentAttempt(current => ({ ...current, status: 'pending' }));
    try {
      await recordNonFiscalPayment({ invoiceId, requestId, reference });
      const lookup = await getFinancePaymentByInvoice(invoiceId);
      if (generation !== detailGeneration.current) return;
      if (!lookup.payment) throw new Error('Payment read did not confirm the write.');
      setDetail(current => ({ ...current, value: { ...current.value,
        payment: lookup.payment } }));
      setPaymentAttempt(current => ({ ...current, status: 'success' }));
    } catch (error) {
      if (generation !== detailGeneration.current) return;
      if (error?.status === 401 || error?.status === 403) {
        detailGeneration.current += 1;
        setDetail({ status: 'idle', value: null });
        setState({ status: error.status === 401 ? 'unauthorized' : 'forbidden', result: null });
        setPaymentAttempt(EMPTY_PAYMENT_ATTEMPT);
        return;
      }
      setPaymentAttempt(current => ({ ...current,
        status: error?.status === 409 ? 'conflict' : 'error' }));
      if (error?.status === 409) setRevision(value => value + 1);
    }
  }

  async function confirmResolution() {
    const { id, requestId, decision, reason, status } = resolutionAttempt;
    if (!id || !requestId || !['confirm', 'error'].includes(status) ||
        !['Maintain', 'Void'].includes(decision) || reason.trim() !== reason ||
        !reason || reason.length > 1000 || detail.value?.id !== id ||
        detail.value.status !== 'Disputed') return;
    const generation = selectionGeneration.current;
    setResolutionAttempt(current => ({ ...current, status: 'pending' }));
    try {
      await resolveFinancePreinvoiceDispute(id, { requestId, decision, reason });
      if (generation !== selectionGeneration.current) return;
      selectedPreinvoiceId.current = null;
      setDetail({ status: 'idle', value: null });
      setResolutionAttempt(current => ({ ...current, status: 'success' }));
      setRevision(value => value + 1);
    } catch (error) {
      if (generation !== selectionGeneration.current) return;
      if (error?.status === 401 || error?.status === 403) {
        detailGeneration.current += 1;
        selectionGeneration.current += 1;
        selectedPreinvoiceId.current = null;
        setDetail({ status: 'idle', value: null });
        setState({ status: error.status === 401 ? 'unauthorized' : 'forbidden', result: null });
        setResolutionAttempt(EMPTY_RESOLUTION_ATTEMPT);
        return;
      }
      if (error?.status === 409) {
        selectedPreinvoiceId.current = null;
        setDetail({ status: 'idle', value: null });
        setRevision(value => value + 1);
      }
      setResolutionAttempt(current => ({ ...current,
        status: error?.status === 409 ? 'conflict' : 'error' }));
    }
  }

  async function downloadFinancialPdf(kind) {
    const current = detail.value;
    if (!current?.invoice || (kind === 'receipt' && !current.payment) ||
        pdfAttempt.status === 'pending') return;
    const generation = detailGeneration.current;
    setPdfAttempt({ status: 'pending', kind });
    try {
      const blob = kind === 'invoice'
        ? await getFinanceInvoiceDocument(current.id)
        : await getFinancePaymentReceipt(current.invoice.id);
      if (generation !== detailGeneration.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = kind === 'invoice' ? `factura-${current.invoice.number}.pdf`
        : `recibo-${current.payment.id}.pdf`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPdfAttempt({ status: 'idle', kind: null });
    } catch {
      if (generation === detailGeneration.current) setPdfAttempt({ status: 'error', kind });
    }
  }

  const rows = state.result?.preinvoices ?? [];
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold">Pre-facturación</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Prefacturas persistidas por estación. La creación a partir de evidencia OCC está en Servicios aprobados.
        </p></div>
      <button type="button" onClick={() => setRevision(value => value + 1)}
        className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">Actualizar</button>
    </header>

    <label className="block max-w-xs text-xs font-semibold">Estación
      <select aria-label="Estación de prefacturas" value={stationId} onChange={event => {
        selectedPreinvoiceId.current = null;
        detailGeneration.current += 1;
        selectionGeneration.current += 1;
        setStationId(event.target.value); setPage(1); setDetail({ status: 'idle', value: null });
        setSubmission({ status: 'idle', id: null });
        setInvoiceIssue({ status: 'idle', id: null, requestId: null, number: null });
        setPaymentAttempt(EMPTY_PAYMENT_ATTEMPT);
        setResolutionAttempt(EMPTY_RESOLUTION_ATTEMPT);
      }} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark">
        {scopes.map(scope => <option key={scope.stationId} value={scope.stationId}>{scope.stationCode}</option>)}
      </select>
    </label>

    {state.status === 'loading' && <p role="status" className="rounded-xl border p-5">Cargando prefacturas…</p>}
    {state.status === 'forbidden' && <p role="alert" className="rounded-xl border p-5">No tiene acceso vigente a esta estación.</p>}
    {state.status === 'unauthorized' && <p role="alert" className="rounded-xl border p-5">La sesión expiró. Vuelva a iniciar sesión.</p>}
    {state.status === 'error' && <div role="alert" className="rounded-xl border p-5">
      <p>No se pudieron cargar las prefacturas.</p>
      <button type="button" onClick={() => setRevision(value => value + 1)} className="mt-2 text-accent-600">Reintentar</button>
    </div>}
    {state.status === 'success' && <>
      {rows.length ? <section className="overflow-x-auto rounded-xl border border-black/5 bg-white dark:border-white/10 dark:bg-surface-dark-card">
        <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-black/[.03] text-xs uppercase dark:bg-white/[.03]"><tr>
          <th className="p-3">Prefactura</th><th className="p-3">Aerolínea</th><th className="p-3">Período</th>
          <th className="p-3">Líneas</th><th className="p-3 text-right">Total</th><th className="p-3">Estado</th><th className="p-3">Detalle</th>
        </tr></thead><tbody>{rows.map(item => <tr key={item.id} className="border-t border-black/5 dark:border-white/10">
          <td className="p-3 font-mono text-xs">{item.id}</td><td className="p-3">{item.airlineName}</td>
          <td className="p-3">{item.from} — {item.to}</td><td className="p-3">{item.lineCount}</td>
          <td className="p-3 text-right font-semibold">{money(item.total, item.currencyCode)}</td>
          <td className="p-3">{STATUS[item.status] ?? item.status}</td>
          <td className="p-3"><button type="button" onClick={() => openDetail(item.id)} className="font-semibold text-accent-600 underline">Ver detalle</button></td>
        </tr>)}</tbody></table></section> : <p className="rounded-xl border p-8 text-center">No hay prefacturas en esta página.</p>}
      <nav aria-label="Páginas de prefacturas" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => changePage(-1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.result.hasMore} onClick={() => changePage(1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}

    {state.status === 'success' && detail.status === 'loading' && <p role="status">Cargando detalle…</p>}
    {state.status === 'success' && detail.status === 'not-found' && <p role="alert">La prefactura ya no está disponible para esta estación.</p>}
    {state.status === 'success' && detail.status === 'error' && <p role="alert">No se pudo cargar el detalle de la prefactura.</p>}
    {state.status === 'success' && submission.status === 'success' &&
      <p role="status" className="rounded-xl border border-emerald-500/30 p-4">Prefactura enviada a revisión de la aerolínea.</p>}
    {state.status === 'success' && submission.status === 'conflict' &&
      <p role="alert" className="rounded-xl border p-4">La prefactura cambió antes del envío. Revise su estado actualizado.</p>}
    {state.status === 'success' && invoiceIssue.status === 'success' &&
      <p role="status" className="rounded-xl border border-emerald-500/30 p-4">Factura no fiscal {invoiceIssue.number} emitida y registrada.</p>}
    {state.status === 'success' && invoiceIssue.status === 'conflict' &&
      <p role="alert" className="rounded-xl border p-4">La prefactura cambió antes de emitir la factura. Revise el estado actualizado.</p>}
    {state.status === 'success' && invoiceIssue.status === 'error' && <div role="alert"
      className="rounded-xl border p-4">
      <p>No se pudo confirmar la emisión. Reintente con la misma clave de solicitud.</p>
      <button type="button" onClick={confirmInvoiceIssue} className="mt-2 rounded-lg border px-4 py-2 text-sm font-semibold">
        Reintentar emisión
      </button>
    </div>}
    {state.status === 'success' && paymentAttempt.status === 'conflict' &&
      <p role="alert" className="rounded-xl border p-4">El pago ya cambió. Consulte el estado actualizado de la factura.</p>}
    {state.status === 'success' && resolutionAttempt.status === 'success' &&
      <p role="status" className="rounded-xl border border-emerald-500/30 p-4">
        {resolutionAttempt.decision === 'Void'
          ? 'Prefactura anulada. Sus servicios pueden incluirse en una corrección.'
          : 'Cargos mantenidos. La aerolínea debe revisar de nuevo la prefactura.'}
      </p>}
    {state.status === 'success' && resolutionAttempt.status === 'conflict' &&
      <p role="alert" className="rounded-xl border p-4">La disputa cambió. Consulte su estado actualizado.</p>}
    {state.status === 'success' && detail.value && <section aria-label="Detalle de prefactura" className="rounded-xl border border-accent-600/20 bg-accent-600/5 p-5">
      <h2 className="font-semibold">{detail.value.airlineName} · {detail.value.id}</h2>
      <p className="mt-1 text-sm">{STATUS[detail.value.status] ?? detail.value.status} · {money(detail.value.total, detail.value.currencyCode)}</p>
      <ul className="mt-3 space-y-2 text-sm">{detail.value.lines.map(line => <li key={line.id}>
        {line.operationCode} · {line.serviceName} · {money(line.amount, detail.value.currencyCode)}
      </li>)}</ul>
      {detail.value.disputes?.length > 0 && <section className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
        aria-label="Disputas de la aerolínea">
        <h3 className="text-sm font-semibold">Disputas registradas</h3>
        {detail.value.disputes.map(dispute => <article key={dispute.id} className="mt-3 text-sm">
          <strong>{dispute.subject}</strong>
          <p className="mt-1">{dispute.description}</p>
          <p className="mt-1">Líneas cuestionadas: {dispute.lineIds.map(lineId => {
            const line = detail.value.lines.find(candidate => candidate.id === lineId);
            return line ? `${line.operationCode} · ${line.operationDate} · ${line.serviceName}` : lineId;
          }).join(', ')}</p>
          {dispute.resolution && <p className="mt-1">
            Resolución: {dispute.resolution.decision === 'Void' ? 'cargos anulados' : 'cargos mantenidos'}.
            {' '}{dispute.resolution.reason}
          </p>}
        </article>)}
      </section>}
      {detail.value.status === 'Disputed' && detail.value.disputes?.some(dispute => !dispute.resolution) &&
        resolutionAttempt.status === 'idle' && <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setResolutionAttempt({ status: 'edit',
            id: detail.value.id, requestId: crypto.randomUUID(), decision: 'Maintain', reason: '' })}
            className="rounded-lg border px-4 py-2 text-sm font-semibold">Mantener cargos</button>
          <button type="button" onClick={() => setResolutionAttempt({ status: 'edit',
            id: detail.value.id, requestId: crypto.randomUUID(), decision: 'Void', reason: '' })}
            className="rounded-lg border px-4 py-2 text-sm font-semibold">Anular prefactura</button>
        </div>}
      {resolutionAttempt.id === detail.value.id && resolutionAttempt.status === 'edit' &&
        <div className="mt-4 rounded-lg border p-4">
          <p className="text-sm">{resolutionAttempt.decision === 'Void'
            ? 'Anular conserva el historial y libera la reserva de servicios para una nueva prefactura.'
            : 'Mantener devuelve la misma prefactura a la aerolínea para una nueva aceptación.'}</p>
          <label className="mt-3 block text-sm">Motivo de resolución
            <textarea value={resolutionAttempt.reason} maxLength={1000}
              onChange={event => setResolutionAttempt(current => ({ ...current,
                reason: event.target.value }))}
              className="mt-1 block w-full rounded-lg border px-3 py-2" />
          </label>
          <div className="mt-3 flex gap-3">
            <button type="button" disabled={!resolutionAttempt.reason.trim() ||
              resolutionAttempt.reason.trim() !== resolutionAttempt.reason}
              onClick={() => setResolutionAttempt(current => ({ ...current, status: 'confirm' }))}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Continuar resolución</button>
            <button type="button" onClick={() => setResolutionAttempt(EMPTY_RESOLUTION_ATTEMPT)}
              className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          </div>
        </div>}
      {resolutionAttempt.id === detail.value.id && resolutionAttempt.status === 'confirm' &&
        <div className="mt-4 rounded-lg border p-4">
          <p className="text-sm">Confirme la decisión: {resolutionAttempt.decision === 'Void'
            ? 'anular y liberar servicios' : 'mantener cargos y solicitar nueva revisión'}.</p>
          <p className="mt-1 text-sm">Motivo: {resolutionAttempt.reason}</p>
          <button type="button" onClick={confirmResolution}
            className="mt-3 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold">
            Confirmar resolución</button>
          <button type="button" onClick={() => setResolutionAttempt(current => ({ ...current, status: 'edit' }))}
            className="ml-2 rounded-lg border px-4 py-2 text-sm">Volver</button>
        </div>}
      {resolutionAttempt.id === detail.value.id && resolutionAttempt.status === 'pending' &&
        <p role="status" className="mt-4 text-sm">Registrando resolución…</p>}
      {resolutionAttempt.id === detail.value.id && resolutionAttempt.status === 'error' &&
        <div role="alert" className="mt-4 rounded-lg border p-4">
          <p>No se pudo confirmar la resolución. Reintente con la misma clave de solicitud.</p>
          <button type="button" onClick={confirmResolution} className="mt-2 rounded-lg border px-4 py-2 text-sm font-semibold">
            Reintentar resolución</button>
        </div>}
      {detail.value.invoice && <section className="mt-4 rounded-lg border p-4" aria-label="Factura no fiscal">
        <h3 className="font-semibold">Factura no fiscal {detail.value.invoice.number}</h3>
        <p className="mt-1 text-sm">Total emitido: {money(detail.value.invoice.total, detail.value.invoice.currencyCode)}</p>
        <ul className="mt-2 space-y-1 text-sm">{detail.value.invoice.lines.map(line => <li key={line.id}>
          {line.operationCode} · {line.serviceName} · {money(line.amount, detail.value.invoice.currencyCode)}
        </li>)}</ul>
        <button type="button" disabled={pdfAttempt.status === 'pending'}
          onClick={() => void downloadFinancialPdf('invoice')}
          className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Descargar factura PDF</button>
        {detail.value.payment ? <p className="mt-3 text-sm" role="status">
          Pago manual registrado: {detail.value.payment.reference} · {money(detail.value.payment.amount,
            detail.value.payment.currencyCode)}
        </p> : <p className="mt-3 text-sm">Sin pago registrado.</p>}
        {detail.value.payment && <button type="button" disabled={pdfAttempt.status === 'pending'}
          onClick={() => void downloadFinancialPdf('receipt')}
          className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Descargar recibo PDF</button>}
        {pdfAttempt.status === 'error' && <p role="alert" className="mt-2 text-sm">
          No se pudo descargar el PDF. Reintente desde esta factura.</p>}
        {!detail.value.payment && paymentAttempt.status === 'idle' &&
          <button type="button" onClick={() => setPaymentAttempt({ status: 'edit',
            id: detail.value.id, invoiceId: detail.value.invoice.id,
            requestId: crypto.randomUUID(), reference: '' })}
            className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold">
            Registrar pago manual
          </button>}
        {!detail.value.payment && paymentAttempt.id === detail.value.id &&
          ['edit', 'error'].includes(paymentAttempt.status) && <div className="mt-3 space-y-2">
            <p className="text-sm">Registro manual no fiscal para Development. Verifique fuera del sistema la referencia y el importe completo antes de confirmar.</p>
            <label className="block text-sm">Referencia de pago
              <input type="text" value={paymentAttempt.reference} readOnly={paymentAttempt.status === 'error'}
                onChange={event => setPaymentAttempt(current => ({ ...current,
                  reference: event.target.value }))}
                className="mt-1 block w-full rounded-lg border px-3 py-2" minLength={8} maxLength={80}
                pattern="[A-Za-z0-9-]{8,80}" />
            </label>
            {paymentAttempt.status === 'error' && <p role="alert">No se pudo confirmar el registro. Reintente con la misma referencia y clave de solicitud.</p>}
            <button type="button" onClick={confirmPayment}
              disabled={!/^[A-Za-z0-9-]{8,80}$/.test(paymentAttempt.reference)}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {paymentAttempt.status === 'error' ? 'Reintentar pago manual' : 'Confirmar pago manual'}
            </button>
            {paymentAttempt.status === 'edit' && <button type="button" onClick={() => setPaymentAttempt(EMPTY_PAYMENT_ATTEMPT)}
              className="ml-2 rounded-lg border px-4 py-2 text-sm">Cancelar</button>}
          </div>}
        {paymentAttempt.id === detail.value.id && paymentAttempt.status === 'pending' &&
          <p role="status" className="mt-3 text-sm">Registrando pago manual…</p>}
      </section>}
      {detail.value.status === 'Accepted' && invoiceIssue.status === 'idle' &&
        <button type="button" onClick={() => setInvoiceIssue({ status: 'confirm', id: detail.value.id,
          requestId: crypto.randomUUID(), number: null })}
          className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">
          Emitir factura no fiscal
        </button>}
      {detail.value.status === 'Accepted' && invoiceIssue.id === detail.value.id &&
        invoiceIssue.status === 'confirm' && <div className="mt-4 rounded-lg border p-4">
          <p className="text-sm">Se congelarán las líneas aceptadas y el total en una factura no fiscal.</p>
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={confirmInvoiceIssue}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Confirmar emisión</button>
            <button type="button" onClick={() => setInvoiceIssue({ status: 'idle', id: null,
              requestId: null, number: null })} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          </div>
        </div>}
      {invoiceIssue.id === detail.value.id && invoiceIssue.status === 'pending' &&
        <p role="status" className="mt-4 text-sm">Emitiendo factura no fiscal…</p>}
      {detail.value.status === 'Draft' && submission.status === 'idle' &&
        <button type="button" onClick={() => setSubmission({ status: 'confirm', id: detail.value.id })}
          className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">
          Enviar a aerolínea
        </button>}
      {detail.value.status === 'Draft' && submission.id === detail.value.id &&
        submission.status === 'confirm' && <div className="mt-4 rounded-lg border p-4">
          <p className="text-sm">Las líneas y el total de esta prefactura quedarán publicados para la aerolínea.</p>
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={confirmSubmission}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Confirmar envío</button>
            <button type="button" onClick={() => setSubmission({ status: 'idle', id: null })}
              className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          </div>
        </div>}
      {submission.status === 'pending' && submission.id === detail.value.id &&
        <p role="status" className="mt-4 text-sm">Enviando prefactura…</p>}
      {submission.status === 'error' && submission.id === detail.value.id && <div role="alert" className="mt-4 rounded-lg border p-4">
        <p>No se pudo confirmar el envío. Consulte el estado o reintente de forma segura.</p>
        <button type="button" onClick={confirmSubmission}
          className="mt-2 rounded-lg border px-4 py-2 text-sm font-semibold">Reintentar envío</button>
      </div>}
    </section>}
  </div>;
}
