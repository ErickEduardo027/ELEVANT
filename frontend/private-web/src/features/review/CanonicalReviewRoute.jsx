import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import {
  decideOccReview, loadOccReviewDetail, loadOccReviewQueue,
  loadOccReviewSubmissionDetail, loadOccReviewSubmissionHistory,
} from '../../services/occReviewService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_LABELS = {
  PendingReview: 'Pendiente', InReview: 'En revisión',
  Approved: 'Aprobada', Returned: 'Devuelta',
};

function dateTime(value, timeZone) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'medium', timeStyle: 'short', timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function Notice({ title, children, onRetry }) {
  return (
    <div role="alert" className="rounded-2xl border border-status-warning/30 bg-white/80 p-5 text-ink-900 dark:bg-surface-dark-card dark:text-text-primary-dark">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{children}</p>}
      {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>
  );
}

function ReviewEvidence({ detail }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section aria-label="Servicios ejecutados" className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <h3 className="font-semibold">Servicios ({detail.services.length})</h3>
        {detail.services.length === 0 ? <p className="mt-2 text-sm">Sin servicios registrados.</p> : (
          <ul className="mt-2 divide-y divide-black/10 text-sm dark:divide-white/10">
            {detail.services.map(service => (
              <li key={service.id} className="flex justify-between gap-3 py-2">
                <span>{service.name} <span className="text-text-secondary-light">({service.code})</span></span>
                <span className="text-right">{service.executedQuantity} / {service.contractedQuantity} {service.unit}<br />{service.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Checklist enviado" className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <h3 className="font-semibold">Checklist · {detail.checklistStatus}</h3>
        {detail.checklistAnswers.length === 0 ? <p className="mt-2 text-sm">Sin respuestas registradas.</p> : (
          <dl className="mt-2 divide-y divide-black/10 text-sm dark:divide-white/10">
            {detail.checklistAnswers.map(answer => (
              <div key={`${answer.section}:${answer.code}`} className="py-2">
                <dt className="font-medium">{answer.section} · {answer.label}</dt>
                <dd>{answer.value}{answer.note ? ` — ${answer.note}` : ''}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section aria-label="Incidencias" className="rounded-xl border border-black/10 p-4 dark:border-white/10 lg:col-span-2">
        <h3 className="font-semibold">Incidencias ({detail.incidents.length})</h3>
        {detail.incidents.length === 0 ? <p className="mt-2 text-sm">No hay incidencias reportadas.</p> : (
          <ul className="mt-2 divide-y divide-black/10 text-sm dark:divide-white/10">
            {detail.incidents.map(incident => (
              <li key={incident.id} className="py-2">
                <strong>{incident.type} · {incident.severity}</strong> · {incident.status}
                <span className="ml-2 text-text-secondary-light">{dateTime(incident.occurredAt, detail.ianaTimeZone)}</span>
                <p>{incident.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HistoricalSubmissions({ operationId, currentSubmissionId, timeZone }) {
  const [history, setHistory] = useState({ status: 'loading', data: null, error: null });
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState({ status: 'idle', data: null, error: null });
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setHistory({ status: 'loading', data: null, error: null });
    loadOccReviewSubmissionHistory(operationId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setHistory({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setHistory({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [operationId, retryVersion]);

  useEffect(() => {
    if (!selectedId) {
      setSelected({ status: 'idle', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setSelected({ status: 'loading', data: null, error: null });
    loadOccReviewSubmissionDetail(operationId, selectedId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setSelected({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setSelected({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [operationId, selectedId]);

  return <section aria-label="Historial de entregas" className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
    <h3 className="font-semibold">Historial de entregas</h3>
    {history.status === 'loading' && <p role="status" className="text-sm">Cargando revisiones…</p>}
    {history.status === 'error' && <Notice title="No se pudo cargar el historial." onRetry={() => setRetryVersion(value => value + 1)}>{history.error?.message}</Notice>}
    {history.status === 'success' && <>
      {history.data.hasMore && <p role="status" className="text-sm">Se muestran las 100 revisiones más recientes; las anteriores permanecen conservadas.</p>}
      <div className="flex flex-wrap gap-2">{history.data.submissions.map(item =>
        <button key={item.submissionId} type="button" disabled={item.submissionId === currentSubmissionId}
          onClick={() => setSelectedId(item.submissionId === selectedId ? null : item.submissionId)}
          aria-pressed={selectedId === item.submissionId}
          className="min-h-11 rounded-lg border border-accent-600/40 px-3 py-2 text-sm disabled:cursor-default disabled:opacity-60">
          Revisión {item.revisionNumber} · {STATUS_LABELS[item.status] ?? item.status}
          {item.submissionId === currentSubmissionId ? ' (actual)' : ''}
        </button>)}</div>
    </>}
    {selected.status === 'loading' && <p role="status">Cargando entrega histórica…</p>}
    {selected.status === 'error' && <Notice title="No se pudo cargar la revisión histórica.">{selected.error?.message}</Notice>}
    {selected.status === 'success' && <div className="space-y-3 rounded-xl bg-accent-600/5 p-4">
      <p className="font-semibold">Revisión {selected.data.revisionNumber} · {dateTime(selected.data.submittedAt, timeZone)}</p>
      {selected.data.decision && <p className="text-sm">Decisión: {STATUS_LABELS[selected.data.decision.outcome] ?? selected.data.decision.outcome}{selected.data.decision.reason ? ` — ${selected.data.decision.reason}` : ''}</p>}
      <ReviewEvidence detail={selected.data} />
    </div>}
  </section>;
}

function ReviewStation({ stationId, selectedId, onSelectOperation }) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [queue, setQueue] = useState({ status: 'loading', data: null, error: null });
  const [detail, setDetail] = useState({ status: 'idle', data: null, error: null });
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const decisionInFlight = useRef(false);
  const decisionAbort = useRef(null);
  const detailRef = useRef(null);

  useEffect(() => () => decisionAbort.current?.abort(), []);

  // El detalle se muestra debajo de la cola; al elegir una operación se lleva a
  // la vista para que en teléfono y tablet no quede fuera de pantalla.
  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    setQueue({ status: 'loading', data: null, error: null });
    loadOccReviewQueue(stationId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setQueue({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setQueue({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [stationId, refreshVersion]);

  useEffect(() => {
    if (!selectedId) {
      setDetail({ status: 'idle', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setDetail({ status: 'loading', data: null, error: null });
    setDecision(null);
    setReason('');
    loadOccReviewDetail(selectedId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setDetail({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setDetail({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [selectedId, refreshVersion]);

  async function confirmDecision() {
    const current = detail.data;
    if (decisionInFlight.current || !current || current.stationId !== stationId ||
        current.status !== 'PendingReview' || !decision) return;
    const correction = reason.trim();
    if (decision === 'Returned' && (correction.length < 8 || correction.length > 2000)) return;
    decisionInFlight.current = true;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    decisionAbort.current = controller;
    try {
      await decideOccReview(current.operationId, {
        submissionId: current.submissionId,
        outcome: decision,
        ...(decision === 'Returned' ? { reason: correction } : {}),
      }, current.reviewVersion, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setMessage({ kind: 'success', text: decision === 'Approved'
        ? 'Entrega aprobada y registrada.' : 'Entrega devuelta con correcciones.' });
      onSelectOperation(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage({ kind: 'error', text: error.message });
    } finally {
      if (!controller.signal.aborted) {
        setDecision(null);
        setReason('');
        setRefreshVersion(value => value + 1);
        setBusy(false);
      }
      decisionInFlight.current = false;
      decisionAbort.current = null;
    }
  }

  const rows = queue.data?.operations ?? [];
  const pendingCount = rows.filter(row => row.status === 'PendingReview').length;
  const timeZone = queue.data?.ianaTimeZone ?? 'UTC';

  return (
    <div className="space-y-5">
      {message && <div role={message.kind === 'error' ? 'alert' : 'status'} className="rounded-xl border border-accent-600/25 bg-accent-600/10 px-4 py-3 text-sm">{message.text}</div>}
      {queue.status === 'loading' && <div role="status" className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">Cargando entregas de la estación…</div>}
      {queue.status === 'error' && <Notice title="No se pudo cargar la cola de revisión." onRetry={() => setRefreshVersion(value => value + 1)}>{queue.error?.message}</Notice>}
      {queue.status === 'success' && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white/80 p-4 dark:bg-surface-dark-card"><p className="text-xs uppercase tracking-wide">Pendientes visibles</p><strong className="text-2xl">{pendingCount}</strong></div>
          <div className="rounded-xl bg-white/80 p-4 dark:bg-surface-dark-card"><p className="text-xs uppercase tracking-wide">Entregas visibles</p><strong className="text-2xl">{rows.length}</strong></div>
          <div className="rounded-xl bg-white/80 p-4 dark:bg-surface-dark-card"><p className="text-xs uppercase tracking-wide">Estación</p><strong className="text-2xl">{queue.data.stationCode}</strong></div>
        </div>
        {queue.data.hasMore && <Notice title="Hay más entregas fuera de esta vista.">La API limita la cola a 100 entregas; esta pantalla no representa el historial completo.</Notice>}
        {rows.length === 0 ? <Notice title="No hay entregas para revisar en esta estación." /> : (
          <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-surface-dark-card">
            <table className="table-stack w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-black/10 text-xs uppercase dark:border-white/10"><tr><th className="p-3">Operación</th><th className="p-3">Agente</th><th className="p-3">Enviada</th><th className="p-3">Estado</th><th className="p-3">Revisión</th></tr></thead>
              <tbody>{rows.map(row => (
                <tr key={row.operationId} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3"><strong>{row.operationCode}</strong><br />{row.airlineName} · {row.operationDate}</td>
                  <td className="p-3">{row.agentName}</td>
                  <td className="p-3">{dateTime(row.submittedAt, timeZone)}</td>
                  <td className="p-3">{STATUS_LABELS[row.status] ?? row.status}<br /><span className="text-xs">{row.serviceCount} servicios · {row.incidentCount} incidencias</span></td>
                  <td className="p-3"><button type="button" onClick={() => onSelectOperation(row.operationId)} className="min-h-11 rounded-lg border border-accent-600 px-4 py-2 font-semibold text-accent-600 hover:bg-accent-600/10">Ver detalle</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>}
      {selectedId && <section ref={detailRef} aria-label="Detalle de entrega" className="scroll-mt-4 space-y-4 rounded-2xl border border-accent-600/20 bg-white/90 p-4 dark:bg-surface-dark-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Detalle de entrega</h2><button type="button" onClick={() => onSelectOperation(null)} className="min-h-11 rounded-lg border px-4 py-2">Cerrar detalle</button></div>
        {detail.status === 'loading' && <p role="status">Cargando ejecución y evidencias…</p>}
        {detail.status === 'error' && <Notice title="No se pudo cargar el detalle." onRetry={() => setRefreshVersion(value => value + 1)}>{detail.error?.message}</Notice>}
        {detail.status === 'success' && detail.data.stationId !== stationId && (
          <Notice title="La entrega pertenece a otra estación.">Selecciona su estación antes de tomar una decisión.</Notice>
        )}
        {detail.status === 'success' && detail.data.stationId === stationId && <>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><strong>{detail.data.operationCode}</strong><br />{detail.data.airlineName}</p><p>Agente<br /><strong>{detail.data.agentName}</strong></p><p>Enviada<br /><strong>{dateTime(detail.data.submittedAt, detail.data.ianaTimeZone)}</strong></p><p>Estado<br /><strong>{STATUS_LABELS[detail.data.status] ?? detail.data.status}</strong></p></div>
          <div className="grid gap-2 text-sm sm:grid-cols-2"><p>Inicio previsto: {dateTime(detail.data.plannedStartAt, detail.data.ianaTimeZone)}<br />Inicio real: {dateTime(detail.data.actualStartAt, detail.data.ianaTimeZone)}</p><p>Fin previsto: {dateTime(detail.data.plannedEndAt, detail.data.ianaTimeZone)}<br />Fin real: {dateTime(detail.data.actualEndAt, detail.data.ianaTimeZone)}</p></div>
          {detail.data.agentNote && <p className="rounded-xl bg-accent-600/10 p-3 text-sm"><strong>Nota del agente:</strong> {detail.data.agentNote}</p>}
          <ReviewEvidence detail={detail.data} />
          <HistoricalSubmissions operationId={detail.data.operationId} currentSubmissionId={detail.data.submissionId} timeZone={detail.data.ianaTimeZone} />
          {detail.data.decision && <p className="rounded-xl bg-accent-600/10 p-3 text-sm">Decisión: <strong>{STATUS_LABELS[detail.data.decision.outcome] ?? detail.data.decision.outcome}</strong> · {dateTime(detail.data.decision.decidedAt, detail.data.ianaTimeZone)}{detail.data.decision.reason ? ` — ${detail.data.decision.reason}` : ''}</p>}
          {detail.data.status === 'PendingReview' && <div className="space-y-3 border-t border-black/10 pt-4 dark:border-white/10">
            <p className="text-sm">Revisa los datos antes de aprobar o devolver esta entrega. Cada decisión afecta una sola operación.</p>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setDecision('Approved')} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Aprobar</button><button type="button" disabled={busy} onClick={() => setDecision('Returned')} className="min-h-11 rounded-lg border border-status-warning px-4 py-2 font-semibold disabled:opacity-50">Devolver con correcciones</button></div>
            {decision && <div className="space-y-3 rounded-xl border border-status-warning/40 p-4" aria-label="Confirmar decisión">
              <p className="font-semibold">{decision === 'Approved' ? '¿Confirmas la aprobación de esta entrega?' : '¿Confirmas la devolución de esta entrega?'}</p>
              {decision === 'Returned' && <label className="block text-sm">Correcciones necesarias (8–2000 caracteres)<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={8} maxLength={2000} required rows={4} className="mt-1 block w-full rounded-lg border border-black/20 bg-white p-3 text-ink-900" /></label>}
              <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || (decision === 'Returned' && (reason.trim().length < 8 || reason.trim().length > 2000))} onClick={confirmDecision} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Confirmando…' : 'Confirmar decisión'}</button><button type="button" disabled={busy} onClick={() => { setDecision(null); setReason(''); }} className="min-h-11 rounded-lg border px-4 py-2">Cancelar</button></div>
            </div>}
          </div>}
        </>}
      </section>}
    </div>
  );
}

export default function CanonicalReviewRoute() {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const stationScopes = useMemo(() => (Array.isArray(session?.stationScopes) ? session.stationScopes : [])
    .filter(scope => UUID.test(scope?.stationId ?? '') && scope?.stationCode), [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const selectedId = searchParams.get('operationId');

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);

  function selectOperation(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('operationId', id);
    else next.delete('operationId');
    setSearchParams(next);
  }

  return (
    <section className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5 text-ink-900 dark:text-text-primary-dark">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent-600">Control operativo</p><h1 className="text-2xl font-bold">Revisión OCC</h1><p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Entregas reales enviadas por agentes de rampa a la API.</p></div>
        {stationScopes.length > 0 && <label className="text-sm font-medium">Estación<select aria-label="Estación de revisión" value={stationId} onChange={event => { setStationId(event.target.value); selectOperation(null); }} className="ml-2 min-h-11 rounded-lg border border-black/20 bg-white px-3 text-ink-900">{stationScopes.map(scope => <option key={scope.stationId} value={scope.stationId}>{scope.stationCode}</option>)}</select></label>}
      </header>
      {stationScopes.length === 0 ? <Notice title="Sin estaciones habilitadas.">Solicita que tu cuenta OCC tenga un alcance de estación activo.</Notice> : (
        <ReviewStation key={stationId} stationId={stationId} selectedId={UUID.test(selectedId ?? '') ? selectedId : null} onSelectOperation={selectOperation} />
      )}
    </section>
  );
}
