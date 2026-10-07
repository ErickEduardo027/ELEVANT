import { useEffect, useMemo, useState } from 'react';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getFinanceReconciliation } from '../../../services/reconciliationService';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';

const filters = [
  ['all', 'Todas'],
  ['awaiting-invoice', 'Pendientes de factura'],
  ['awaiting-payment', 'Pendientes de pago'],
  ['payment-recorded', 'Pago registrado'],
];

function lifecycle(row) {
  if (row.paymentId) return { id: 'payment-recorded', label: 'Pago manual registrado' };
  if (row.invoiceId) return { id: 'awaiting-payment', label: 'Factura emitida · pago pendiente' };
  return { id: 'awaiting-invoice', label: 'Prefactura aceptada · factura pendiente' };
}

function money(value, currency) {
  return value == null ? '—' : `${currency} ${Number(value).toFixed(4)}`;
}

export default function ReconciliationPage({ initialStationId }) {
  const session = useMemo(() => readSession(), []);
  const stations = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(
    stations.some(scope => scope.stationId === initialStationId)
      ? initialStationId : stations[0]?.stationId ?? '');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: stationId ? 'loading' : 'forbidden', data: null });

  useEffect(() => {
    if (!stationId) {
      setState({ status: 'forbidden', data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null });
    getFinanceReconciliation({ stationId, page, limit: 20 }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error', data: null });
      });
    return () => abortForEffectCleanup(controller);
  }, [stationId, page, revision]);

  useEffect(() => {
    if (!session?.accountId || !stationId) return undefined;
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_preinvoices')) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 25_000);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [session?.accountId, stationId]);

  const visible = state.status === 'success' ? state.data.rows
    .filter(row => filter === 'all' || lifecycle(row).id === filter) : [];

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold">Seguimiento financiero</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Prefacturas aceptadas, facturas no fiscales y pagos manuales de la estación autorizada. Solo lectura.
        </p>
      </div>
      {stations.length > 0 && <label className="text-xs font-semibold">Estación
        <select aria-label="Estación de seguimiento financiero" value={stationId}
          onChange={event => { setStationId(event.target.value); setPage(1); }}
          className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
          {stations.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>}
    </header>

    <p className="rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm">
      Un pago registrado manualmente no confirma un movimiento bancario ni una conciliación externa.
    </p>

    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No hay una estación financiera autorizada para consultar este seguimiento.'
        : state.status === 'unauthorized' ? 'La sesión expiró. Vuelva a iniciar sesión.'
          : 'No se pudo cargar el seguimiento financiero.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando seguimiento financiero…</p>}

    {state.status === 'success' && <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold">Estado
          <select aria-label="Filtrar seguimiento financiero" value={filter}
            onChange={event => setFilter(event.target.value)}
            className="ml-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
            {filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span className="text-xs text-text-secondary-light">Página {page} · hasta 20 registros por página</span>
      </div>
      {visible.length ? <section aria-label="Seguimiento financiero" className="grid gap-4">
        {visible.map(row => <article key={row.preinvoiceId}
          className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-text-secondary-light">{row.preinvoiceId}</p>
              <h2 className="text-lg font-bold">{row.airlineName}</h2>
              <p className="text-sm text-text-secondary-light">{row.from} — {row.to}</p>
            </div>
            <span className="rounded-full bg-accent-600/10 px-3 py-1 text-xs font-semibold text-accent-600">
              {lifecycle(row).label}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-text-secondary-light">Prefactura aceptada</dt>
              <dd className="font-semibold">{money(row.preinvoiceTotal, row.currencyCode)}</dd></div>
            <div><dt className="text-xs text-text-secondary-light">Factura no fiscal</dt>
              <dd className="font-semibold">{row.invoiceNumber ?? 'Pendiente'}</dd>
              {row.invoiceId && <dd className="text-xs">{money(row.invoiceTotal, row.currencyCode)}</dd>}</div>
            <div><dt className="text-xs text-text-secondary-light">Pago manual</dt>
              <dd className="font-semibold">{row.paymentReference ?? 'Pendiente'}</dd>
              {row.paymentId && <dd className="text-xs">{money(row.paymentAmount, row.currencyCode)}</dd>}</div>
          </dl>
        </article>)}
      </section> : <p className="rounded-xl border p-8 text-center">
        {state.data.rows.length ? 'No hay registros con este estado en esta página.'
          : 'No hay prefacturas aceptadas o facturadas en esta página.'}
      </p>}
      <nav aria-label="Páginas de seguimiento financiero" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}
  </div>;
}
