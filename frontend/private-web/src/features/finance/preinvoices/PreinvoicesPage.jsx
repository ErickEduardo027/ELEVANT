import { useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getPreinvoiceDraft } from '../../../services/approvedServicesService';
import { getFinancePreinvoices, submitFinancePreinvoice } from '../../../services/financePreinvoiceService';

const STATUS = {
  Draft: 'Borrador', Submitted: 'Enviada', Disputed: 'En disputa',
  Accepted: 'Aceptada', Invoiced: 'Facturada', Voided: 'Anulada',
};

function money(value, currency) {
  return `${currency} ${Number(value).toFixed(4)}`;
}

export default function PreinvoicesPage() {
  const session = useMemo(() => readSession(), []);
  const scopes = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(scopes[0]?.stationId ?? '');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', result: null });
  const [detail, setDetail] = useState({ status: 'idle', value: null });
  const [submission, setSubmission] = useState({ status: 'idle', id: null });
  const detailGeneration = useRef(0);

  useEffect(() => () => { detailGeneration.current += 1; }, []);

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
    if (!stationId) {
      detailGeneration.current += 1;
      setDetail({ status: 'idle', value: null });
      setSubmission({ status: 'idle', id: null });
      setState({ status: 'forbidden', result: null });
      return undefined;
    }
    const controller = new AbortController();
    detailGeneration.current += 1;
    setDetail({ status: 'idle', value: null });
    setState({ status: 'loading', result: null });
    getFinancePreinvoices({ stationId, page, limit: 20 }, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setState({ status: 'success', result });
      }).catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error', result: null });
      });
    return () => controller.abort();
  }, [stationId, page, revision]);

  async function openDetail(id) {
    const generation = ++detailGeneration.current;
    setSubmission({ status: 'idle', id: null });
    setDetail({ status: 'loading', value: null });
    try {
      const value = await getPreinvoiceDraft(id, stationId);
      if (generation === detailGeneration.current)
        setDetail({ status: 'success', value });
    } catch (error) {
      if (generation === detailGeneration.current)
        setDetail({ status: error?.status === 404 ? 'not-found' : 'error', value: null });
    }
  }

  function changePage(delta) {
    detailGeneration.current += 1;
    setDetail({ status: 'idle', value: null });
    setSubmission({ status: 'idle', id: null });
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
        detailGeneration.current += 1;
        setStationId(event.target.value); setPage(1); setDetail({ status: 'idle', value: null });
        setSubmission({ status: 'idle', id: null });
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
    {state.status === 'success' && detail.value && <section aria-label="Detalle de prefactura" className="rounded-xl border border-accent-600/20 bg-accent-600/5 p-5">
      <h2 className="font-semibold">{detail.value.airlineName} · {detail.value.id}</h2>
      <p className="mt-1 text-sm">{STATUS[detail.value.status] ?? detail.value.status} · {money(detail.value.total, detail.value.currencyCode)}</p>
      <ul className="mt-3 space-y-2 text-sm">{detail.value.lines.map(line => <li key={line.id}>
        {line.operationCode} · {line.serviceName} · {money(line.amount, detail.value.currencyCode)}
      </li>)}</ul>
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
