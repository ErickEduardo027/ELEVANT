import { useEffect, useRef, useState } from 'react';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { amendHumanResourcesAvailabilityRequest, getHumanResourcesAvailabilityRequests,
  resolveHumanResourcesAvailabilityRequest } from
  '../../../services/humanResourcesAvailabilityService';
import { addDays, businessToday } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { HUMAN_RESOURCES_PROBLEMS } from '../../../services/humanResourcesProblems';
import { problemMessage } from '../../../services/problemMessages';
import AvailabilityRequestForm from './AvailabilityRequestForm';

const PAGE_LIMIT = 20;
const TYPE_LABELS = { DayOff: 'Día libre', Restriction: 'Restricción',
  ShiftChange: 'Cambio de turno' };
const STATUS_LABELS = { Pending: 'Pendiente', Approved: 'Aprobada',
  Rejected: 'Rechazada', Cancelled: 'Cancelada' };
const DECISION_NOTICES = { Approve: 'Solicitud aprobada.', Reject: 'Solicitud rechazada.',
  Cancel: 'Solicitud cancelada.' };
// A day off or a restriction takes the agent's work of those days (2-N08); a shift change does not.
const ABSENCE_TYPES = new Set(['DayOff', 'Restriction']);
// The answer does not say what was released, and OCC is only notified of each released operation (2-N06).
const RELEASE_NOTICE = ' Si el agente tenía coberturas, operaciones sin iniciar o turnos en esos días, se liberaron; OCC recibe un aviso por cada operación liberada.';
const AMENDMENT_NOTICES = {
  Cancel: 'Ausencia cancelada. Lo que su aprobación liberó no vuelve: programe de nuevo lo que haga falta.',
  Shorten: 'Ausencia acortada. Lo que su aprobación liberó no vuelve: programe de nuevo lo que haga falta.',
};
const UNCERTAIN = 'No pudimos confirmar el resultado. Reintente la misma acción.';

/** The days a shortening admits: from the first day (never before yesterday) to the day before the current end. */
function shorteningRange(item, today) {
  const yesterday = addDays(today, -1);
  const min = item.startsOn > yesterday ? item.startsOn : yesterday;
  const max = addDays(item.endsOn, -1);
  return min <= max ? { min, max } : null;
}

const failureMessage = failure => problemMessage(failure, HUMAN_RESOURCES_PROBLEMS, { fallback: UNCERTAIN });

export default function AvailabilityRequestsPanel({ from, to, revision = 0,
  onDenied = () => {}, onChanged = () => {} }) {
  const access = useOptionalDepartmentAccess();
  const canDecide = Boolean(access?.can('human_resources.availability.decide'));
  const today = businessToday();
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState({ id: null, note: '' });
  const [amending, setAmending] = useState(null);
  const [localRevision, setLocalRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [pendingResolution, setPendingResolution] = useState(null);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const decisions = useRef(createCommandKeyHolder());
  const amendments = useRef(createCommandKeyHolder());
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
    setCancelling({ id: null, note: '' });
    setAmending(null);
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

  async function decide(item, decision, note = null) {
    const { id } = item;
    if (busyId || state.status !== 'success') return;
    // One intent per decision: an uncertain answer repeats the same body, version and key.
    const intent = pendingResolution?.id === id &&
      pendingResolution.decision === decision
      ? pendingResolution : { id, decision, note, version: item.version };
    setPendingResolution(intent);
    setBusyId(id);
    setActionError('');
    try {
      const body = { decision: intent.decision, note: intent.note, expectedVersion: intent.version };
      await decisions.current.run('resolve', [id, body], key =>
        resolveHumanResourcesAvailabilityRequest(id, body, key));
      if (!mounted.current) return;
      setPendingResolution(null);
      setCancelling({ id: null, note: '' });
      const releases = decision === 'Approve' && ABSENCE_TYPES.has(item.type);
      setNotice(DECISION_NOTICES[decision] + (releases ? RELEASE_NOTICE : ''));
      refresh();
      if (releases) onChanged();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure?.status === 401 || failure?.status === 403) {
        requestVersion.current += 1;
        setState({ status: failure.status === 401 ? 'unauthorized' : 'forbidden', data: null });
        setPendingResolution(null);
        setFormOpen(false);
        onDeniedRef.current(failure.status);
      } else if (failure?.status === 409 || failure?.status === 400 || failure?.status === 404) {
        // Settled by the server: the message explains the rule and the list is read again.
        setPendingResolution(null);
        setActionError(failureMessage(failure));
        refresh();
      } else {
        setActionError('No pudimos confirmar la decisión. Reintenta la misma acción.');
      }
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  async function amend(event, item) {
    event.preventDefault();
    if (busyId || !amending || amending.id !== item.id) return;
    const command = { action: amending.action, endsOn: amending.action === 'Shorten' ? amending.endsOn : null,
      reason: amending.reason.trim(), expectedVersion: item.version };
    setBusyId(item.id);
    setActionError('');
    try {
      await amendments.current.run('amend', [item.id, command], key =>
        amendHumanResourcesAvailabilityRequest(item.id, command, key));
      if (!mounted.current) return;
      setAmending(null);
      setNotice(AMENDMENT_NOTICES[command.action]);
      refresh();
      onChanged();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure?.status === 401 || failure?.status === 403) {
        setAmending(null);
        deny(failure.status);
      } else if (failure instanceof TypeError) {
        setActionError('Revise el motivo (al menos 5 caracteres) y el nuevo último día.');
      } else if (failure?.status >= 400 && failure?.status < 500) {
        setActionError(failureMessage(failure));
        if (failure.status === 409 || failure.status === 404) { setAmending(null); refresh(); }
      } else {
        setActionError(UNCERTAIN);
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
        {state.status === 'success' && canDecide && !formOpen && <button type="button"
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
          {item.status === 'Pending' && canDecide && <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={!!busyId || !!pendingResolution}
              onClick={() => void decide(item, 'Approve')}
              className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Aprobar</button>
            <button type="button" disabled={!!busyId || !!pendingResolution}
              onClick={() => void decide(item, 'Reject')}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Rechazar</button>
            <button type="button" disabled={!!busyId || !!pendingResolution}
              onClick={() => setCancelling({ id: item.id, note: '' })}
              className="rounded-lg border border-status-danger/40 px-3 py-2 text-sm font-semibold text-status-danger disabled:opacity-40">
              Cancelar solicitud</button>
            {pendingResolution?.id === item.id && <button type="button"
              disabled={!!busyId} onClick={() => void decide(item, pendingResolution.decision)}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Reintentar misma decisión</button>}
          </div>}
          {item.status === 'Pending' && canDecide && cancelling.id === item.id && !pendingResolution &&
            <form className="mt-3 space-y-2 rounded-xl border border-status-danger/30 p-3"
              aria-label={`Cancelar solicitud de ${item.agentName}`}
              onSubmit={event => { event.preventDefault(); void decide(item, 'Cancel', cancelling.note.trim()); }}>
              <label className="block text-xs font-semibold">Motivo de la cancelación
                <textarea required minLength={3} maxLength={1000} rows={2} value={cancelling.note}
                  onChange={event => setCancelling({ id: item.id, note: event.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={!!busyId}
                  className="rounded-lg bg-status-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  Confirmar cancelación</button>
                <button type="button" onClick={() => setCancelling({ id: null, note: '' })}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold">Volver</button>
              </div>
            </form>}
          {item.status === 'Approved' && canDecide && ABSENCE_TYPES.has(item.type) && item.endsOn >= today &&
            amending?.id !== item.id && <div className="mt-4 flex flex-wrap gap-2">
            {item.startsOn > today && <button type="button" disabled={!!busyId}
              onClick={() => { setActionError(''); setAmending({ id: item.id, action: 'Cancel', endsOn: '', reason: '' }); }}
              className="rounded-lg border border-status-danger/40 px-3 py-2 text-sm font-semibold text-status-danger disabled:opacity-40">
              Cancelar ausencia</button>}
            {shorteningRange(item, today) && <button type="button" disabled={!!busyId}
              onClick={() => { setActionError(''); setAmending({ id: item.id, action: 'Shorten',
                endsOn: shorteningRange(item, today).max, reason: '' }); }}
              className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Acortar ausencia</button>}
          </div>}
          {item.status === 'Approved' && canDecide && amending?.id === item.id &&
            <form className="mt-3 space-y-2 rounded-xl border border-status-warning/40 p-3"
              aria-label={`${amending.action === 'Cancel' ? 'Cancelar' : 'Acortar'} la ausencia de ${item.agentName}`}
              onSubmit={event => void amend(event, item)}>
              {amending.action === 'Shorten' && <label className="block text-xs font-semibold">Nuevo último día
                <input type="date" required value={amending.endsOn}
                  min={shorteningRange(item, today)?.min} max={shorteningRange(item, today)?.max}
                  onChange={event => setAmending(current => ({ ...current, endsOn: event.target.value }))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
              </label>}
              <label className="block text-xs font-semibold">Motivo del cambio
                <textarea required minLength={5} maxLength={1000} rows={2} value={amending.reason}
                  onChange={event => setAmending(current => ({ ...current, reason: event.target.value }))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" />
              </label>
              <p className="text-xs text-text-secondary-light">
                Lo que la aprobación liberó (coberturas, operaciones y turnos) no vuelve: deberá programarse de nuevo.</p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={!!busyId}
                  className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  {amending.action === 'Cancel' ? 'Confirmar cancelación de la ausencia' : 'Confirmar nuevo último día'}</button>
                <button type="button" disabled={!!busyId} onClick={() => setAmending(null)}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold">Volver</button>
              </div>
            </form>}
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
