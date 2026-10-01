import { useEffect, useRef, useState } from 'react';
import { getHumanResourcesAvailabilityRequests,
  resolveHumanResourcesAvailabilityRequest } from
  '../../../services/humanResourcesAvailabilityService';
import AvailabilityRequestForm from './AvailabilityRequestForm';

const PAGE_LIMIT = 20;
const TYPE_LABELS = { DayOff: 'Día libre', Restriction: 'Restricción',
  ShiftChange: 'Cambio de turno' };
const STATUS_LABELS = { Pending: 'Pendiente', Approved: 'Aprobada',
  Rejected: 'Rechazada', Cancelled: 'Cancelada' };

export default function AvailabilityRequestsPanel({ from, to, revision = 0,
  onDenied = () => {} }) {
  const [page, setPage] = useState(1);
  const [localRevision, setLocalRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [pendingResolution, setPendingResolution] = useState(null);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const onDeniedRef = useRef(onDenied);
  onDeniedRef.current = onDenied;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setPage(1);
    setFormOpen(false);
    setNotice('');
    setActionError('');
    setPendingResolution(null);
  }, [from, to]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setState({ status: 'loading', data: null });
    getHumanResourcesAvailabilityRequests({ from, to, page, limit: PAGE_LIMIT },
      { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && version === requestVersion.current) {
        setPendingResolution(current => {
          if (!current) return null;
          const refreshed = data.requests.find(item => item.id === current.id);
          return refreshed && refreshed.status !== 'Pending' ? null : current;
        });
        setState({ status: 'success', data });
      }
    }).catch(error => {
      if (controller.signal.aborted || version !== requestVersion.current ||
          error?.name === 'AbortError') return;
      setFormOpen(false);
      setPendingResolution(null);
      setNotice('');
      setState({ status: error?.status === 401 ? 'unauthorized' :
        error?.status === 403 ? 'forbidden' : 'error', data: null });
      if (error?.status === 401 || error?.status === 403)
        onDeniedRef.current(error.status);
    });
    return () => controller.abort();
  }, [from, to, page, revision, localRevision]);

  function refresh() {
    setLocalRevision(value => value + 1);
  }

  async function decide(id, decision) {
    if (busyId || state.status !== 'success') return;
    const intent = pendingResolution?.id === id &&
      pendingResolution.decision === decision
      ? pendingResolution : { id, decision, note: null };
    setPendingResolution(intent);
    setBusyId(id);
    setActionError('');
    try {
      await resolveHumanResourcesAvailabilityRequest(id,
        { decision: intent.decision, note: intent.note });
      if (!mounted.current) return;
      setPendingResolution(null);
      setNotice(decision === 'Approve' ? 'Solicitud aprobada.' : 'Solicitud rechazada.');
      refresh();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure?.status === 401 || failure?.status === 403) {
        requestVersion.current += 1;
        setState({ status: failure.status === 401 ? 'unauthorized' : 'forbidden', data: null });
        setPendingResolution(null);
        setFormOpen(false);
        onDeniedRef.current(failure.status);
      } else if (failure?.status === 409) {
        setPendingResolution(null);
        setActionError('La solicitud cambió o conserva una asignación activa. Consultamos su estado actual.');
        refresh();
      } else if (failure?.status === 400 || failure?.status === 404) {
        setPendingResolution(null);
        setActionError('No se pudo decidir la solicitud. Revisa la lista actualizada.');
        refresh();
      } else {
        setActionError('No pudimos confirmar la decisión. Reintenta la misma acción.');
      }
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  function deny(status) {
    requestVersion.current += 1;
    setFormOpen(false);
    setState({ status: status === 401 ? 'unauthorized' : 'forbidden', data: null });
    onDeniedRef.current(status);
  }

  return <section className="space-y-4 border-t border-black/10 pt-6 dark:border-white/10"
    aria-label="Ausencias y solicitudes">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">Ausencias y solicitudes</h2>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Solicitudes laborales registradas que se solapan con la semana seleccionada. Un cambio de turno aprobado no modifica el turno por sí solo.
        </p>
      </div>
      <div className="flex gap-2">
        {state.status === 'success' && !formOpen && <button type="button"
          onClick={() => { setFormOpen(true); setNotice(''); }}
          className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">
          Nueva solicitud</button>}
        <button type="button" onClick={refresh}
          className="rounded-lg border px-3 py-2 text-sm font-semibold">Actualizar solicitudes</button>
      </div>
    </header>
    {notice && <p role="status" className="rounded-xl bg-status-success/10 p-4 text-sm">{notice}</p>}
    {formOpen && !['error', 'forbidden', 'unauthorized'].includes(state.status) &&
      <AvailabilityRequestForm initialDate={from} canWrite={state.status === 'success'}
      onClose={() => setFormOpen(false)}
      onRecorded={() => {
        setFormOpen(false);
        setNotice('Solicitud registrada. Actualizamos la lista.');
        setPage(1);
        refresh();
      }}
      onConflict={refresh} onDenied={deny} />}
    {state.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">
      Cargando solicitudes…</p>}
    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No tienes acceso a las solicitudes.'
        : state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.'
          : 'No se pudieron cargar las solicitudes.'}</p>
      {state.status === 'error' && <button type="button" onClick={refresh}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">
        Reintentar</button>}
    </div>}
    {state.status === 'success' && <>
      <p className="text-xs text-text-secondary-light">{from} – {to} · página {page} · hasta 20 registros por página</p>
      {actionError && <p role="alert" className="rounded-xl border border-status-danger/30 p-3 text-sm text-status-danger">
        {actionError}</p>}
      {state.data.requests.length ? <div className="space-y-3">
        {state.data.requests.map(item => <article key={item.id}
          className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{item.agentName}</h3>
              <p className="text-xs text-text-secondary-light">{item.employeeNumber} · {TYPE_LABELS[item.type]} · {item.startsOn}–{item.endsOn}</p>
            </div>
            <span className="rounded-full border px-3 py-1 text-xs font-semibold">
              {STATUS_LABELS[item.status]}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm">{item.reason}</p>
          {item.resolutionNote && <p className="mt-2 text-xs text-text-secondary-light">
            Resolución: {item.resolutionNote}</p>}
          {item.status === 'Pending' && <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={!!busyId || !!pendingResolution}
              onClick={() => void decide(item.id, 'Approve')}
              className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Aprobar</button>
            <button type="button" disabled={!!busyId || !!pendingResolution}
              onClick={() => void decide(item.id, 'Reject')}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Rechazar</button>
            {pendingResolution?.id === item.id && <button type="button"
              disabled={!!busyId} onClick={() => void decide(item.id, pendingResolution.decision)}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Reintentar misma decisión</button>}
          </div>}
        </article>)}
      </div> : <p className="rounded-xl border p-8 text-center">
        No hay solicitudes en esta semana y página.</p>}
      <nav aria-label="Páginas de solicitudes" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior de solicitudes</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore}
          onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página de solicitudes</button>
      </nav>
    </>}
  </section>;
}
