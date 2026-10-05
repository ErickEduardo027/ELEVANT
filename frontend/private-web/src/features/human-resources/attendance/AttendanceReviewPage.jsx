import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getHumanResourcesAttendance, validateHumanResourcesAttendance } from
  '../../../services/humanResourcesAttendanceService';
import { addDays, toDateKey } from '../schedules/mappers';

const PAGE_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WATCHED_RESOURCES = new Set(['attendance_draft', 'attendance_validation']);
const FIELD_CLASS = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-accent-600 dark:border-white/20 dark:bg-surface-dark-card dark:text-text-primary-dark';
const CARD_CLASS = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-surface-dark-card';

function formatInstant(value) {
  if (!value) return 'Sin registrar';
  return `${new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(new Date(value))} UTC`;
}

function laneTime(row, source, field) {
  return (source === 'Occ' ? row?.occ : row?.rampAgent)?.[field] ?? null;
}

function sameInstant(left, right) {
  return left === right || Boolean(left && right && Date.parse(left) === Date.parse(right));
}

function requiresReason(row) {
  return !sameInstant(row?.occ?.observedStartAt, row?.rampAgent?.observedStartAt) ||
    !sameInstant(row?.occ?.observedEndAt, row?.rampAgent?.observedEndAt);
}

function canValidate(row, selected, writing) {
  if (!row?.occ || !row?.rampAgent || row.isDecisionCurrent || !selected || writing ||
      selected.needsReconfirm || selected.unknownAttempt) return false;
  const start = laneTime(row, selected.startSource, 'observedStartAt');
  const end = laneTime(row, selected.endSource, 'observedEndAt');
  return Boolean(start && end && Date.parse(end) >= Date.parse(start) &&
    (!requiresReason(row) || selected.reason.trim().length > 0) &&
    selected.reason.length <= 1_000);
}

function statusFor(row) {
  if (row.isDecisionCurrent) return 'Validación vigente';
  if (row.latestDecision) return 'Requiere revalidación';
  if (!row.occ || !row.rampAgent) return 'Pendiente de aporte';
  return 'Pendiente de validación';
}

function EvidenceLane({ title, contribution }) {
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
    <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-accent-700 dark:text-accent-300">{title}</h3>
    {contribution ? <dl className="mt-3 grid gap-2 text-sm">
      <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Inicio observado</dt>
        <dd className="font-semibold">{formatInstant(contribution.observedStartAt)}</dd></div>
      <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Fin observado</dt>
        <dd className="font-semibold">{formatInstant(contribution.observedEndAt)}</dd></div>
      <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Revisión y autor</dt>
        <dd>#{contribution.revision} · {contribution.authorAccountId}</dd></div>
      <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Registrado</dt>
        <dd>{formatInstant(contribution.recordedAt)}</dd></div>
      {contribution.incidentNote && <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Nota</dt>
        <dd>{contribution.incidentNote}</dd></div>}
    </dl> : <p className="mt-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">
      Aún no hay un aporte registrado en este carril.</p>}
  </section>;
}

export default function AttendanceReviewPage({ initialDate = new Date() }) {
  const { session } = useAuth();
  const stationScopes = useMemo(() => (Array.isArray(session?.stationScopes)
    ? session.stationScopes : []).filter(scope =>
    UUID.test(scope?.stationId ?? '') && typeof scope.stationCode === 'string'),
  [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const [range, setRange] = useState(() => ({
    from: toDateKey(addDays(initialDate, -6)), to: toDateKey(initialDate),
  }));
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null, queryKey: null,
    refreshing: false });
  const [selected, setSelected] = useState(null);
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');
  const requestVersion = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const rangeValid = range.from && range.to && range.from <= range.to &&
    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) /
      86_400_000 <= 30;

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
    setSelected(null);
    setState({ status: 'loading', data: null, queryKey: null, refreshing: false });
  }, [stationId, stationScopes]);

  useEffect(() => {
    if (!stationId || !stationScopes.some(scope => scope.stationId === stationId)) {
      setState({ status: 'empty-scope', data: null, queryKey: null, refreshing: false });
      return undefined;
    }
    if (!rangeValid) {
      setState({ status: 'invalid-range', data: null, queryKey: null, refreshing: false });
      return undefined;
    }
    const controller = new AbortController();
    const version = ++requestVersion.current;
    const queryKey = `${stationId}|${range.from}|${range.to}|${page}|${session?.token ?? ''}`;
    setState(previous => previous.queryKey === queryKey && previous.data
      ? { ...previous, refreshing: true }
      : { status: 'loading', data: null, queryKey, refreshing: false });
    getHumanResourcesAttendance({ stationId, from: range.from, to: range.to,
      page, limit: PAGE_LIMIT }, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setState({ status: 'success', data, queryKey, refreshing: false });
        setSelected(current => {
          if (!current) return current;
          const latest = data.items.find(item => item.assignmentId === current.assignmentId);
          if (!latest) return null;
          return {
            ...current, conflictRefreshPending: false,
            needsReconfirm: current.needsReconfirm ||
              current.ackOccRevision !== latest.occ?.revision ||
              current.ackRampRevision !== latest.rampAgent?.revision,
          };
        });
      })
      .catch(error => {
        if (controller.signal.aborted || version !== requestVersion.current ||
            error?.name === 'AbortError') return;
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error',
        data: null, queryKey, refreshing: false });
        if (error?.status === 401 || error?.status === 403) setSelected(null);
      });
    return () => controller.abort();
  }, [stationId, stationScopes, range.from, range.to, rangeValid,
    page, revision, session?.token]);

  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => WATCHED_RESOURCES.has(resource))) refresh();
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
  }, [refresh]);

  const activeRow = state.data?.items.find(item => item.assignmentId === selected?.assignmentId);
  const updateRange = (field, value) => {
    setRange(current => ({ ...current, [field]: value }));
    setPage(1); setSelected(null); setMessage('');
  };
  const openReview = row => {
    setSelected({ assignmentId: row.assignmentId,
      startSource: row.occ?.observedStartAt ? 'Occ' : 'RampAgent',
      endSource: row.occ?.observedEndAt ? 'Occ' : 'RampAgent',
      reason: '', ackOccRevision: row.occ?.revision ?? null,
      ackRampRevision: row.rampAgent?.revision ?? null,
      needsReconfirm: false, conflictRefreshPending: false, unknownAttempt: null });
    setMessage('');
  };
  const confirmCurrent = () => {
    if (!activeRow || !selected || selected.conflictRefreshPending) return;
    setSelected(current => ({ ...current,
      ackOccRevision: activeRow.occ?.revision ?? null,
      ackRampRevision: activeRow.rampAgent?.revision ?? null,
      needsReconfirm: false, unknownAttempt: null }));
    setMessage('');
  };
  const submit = async () => {
    if (!selected || (!selected.unknownAttempt && !canValidate(activeRow, selected, writing))) return;
    const attempt = selected.unknownAttempt ?? {
      key: crypto.randomUUID(),
      body: { expectedOccRevision: activeRow.occ.revision,
        expectedRampAgentRevision: activeRow.rampAgent.revision,
        startSource: selected.startSource, endSource: selected.endSource,
        reason: selected.reason.trim() || null },
    };
    setSelected(current => ({ ...current, unknownAttempt: attempt }));
    setWriting(true); setMessage('');
    try {
      await validateHumanResourcesAttendance(selected.assignmentId, stationId,
        attempt.body, attempt.key);
      setSelected(null);
      setMessage('Validación registrada. Actualizando el estado de la asignación.');
      refresh();
    } catch (error) {
      if (error?.code === 'stale-revision') {
        setSelected(current => current ? { ...current, unknownAttempt: null,
          needsReconfirm: true, conflictRefreshPending: true } : null);
        setMessage('Los aportes cambiaron. Revisa las versiones actuales y confirma tu elección.');
        refresh();
      } else if (error?.code === 'unknown-outcome') {
        setMessage('No se confirmó el resultado. Reintenta la misma validación sin cambiar la elección.');
      } else if (error?.code === 'unauthorized' || error?.code === 'forbidden') {
        setState({ status: error.code, data: null, queryKey: null, refreshing: false });
        setSelected(null);
      } else {
        setSelected(current => current ? { ...current, unknownAttempt: null } : null);
        setMessage('No se pudo validar la asistencia. Revisa los datos e inténtalo de nuevo.');
      }
    } finally { setWriting(false); }
  };

  return <main className="mx-auto max-w-[1440px] space-y-5 text-ink-900 dark:text-text-primary-dark">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana · evidencia operativa</p>
        <h1 className="mt-1 text-2xl font-bold">Revisión de asistencia</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Compara las horas observadas por OCC y el agente. Elige cada hito desde un aporte registrado;
          la validación conserva ambas versiones y su justificación.
        </p>
      </div>
      <button type="button" onClick={refresh}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-accent-600 dark:border-white/20 dark:bg-surface-dark-card">
        Actualizar asistencia
      </button>
    </header>

    <section aria-label="Filtros de asistencia" className={`${CARD_CLASS} grid gap-3 md:grid-cols-3`}>
      <label className="space-y-1 text-xs font-semibold">Estación
        <select aria-label="Estación" className={FIELD_CLASS} value={stationId}
          onChange={event => { setStationId(event.target.value); setSelected(null);
            setPage(1); setMessage(''); }}>
          {stationScopes.length === 0 && <option value="">Sin estación autorizada</option>}
          {stationScopes.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-xs font-semibold">Desde
        <input className={FIELD_CLASS} type="date" value={range.from}
          onChange={event => updateRange('from', event.target.value)} />
      </label>
      <label className="space-y-1 text-xs font-semibold">Hasta
        <input className={FIELD_CLASS} type="date" value={range.to}
          onChange={event => updateRange('to', event.target.value)} />
      </label>
    </section>

    {state.status === 'empty-scope' && <p role="status" className={CARD_CLASS}>
      No tienes una estación autorizada para revisar asistencia.</p>}
    {state.status === 'invalid-range' && <p role="alert" className={CARD_CLASS}>
      Elige un intervalo de hasta 30 días y con la fecha final posterior a la inicial.</p>}
    {state.status === 'loading' && <p role="status" className={CARD_CLASS}>Cargando asistencia…</p>}
    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert" className={CARD_CLASS}>
      <p>{state.status === 'forbidden' ? 'No tienes acceso a esta revisión de asistencia.' :
        state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.' :
          'No se pudo consultar la asistencia.'}</p>
      {state.status === 'error' && <button type="button" onClick={refresh}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">
        Reintentar consulta</button>}
    </div>}

    {state.status === 'success' && <>
      {state.refreshing && <p role="status" className="text-xs text-text-secondary-light">Actualizando aportes…</p>}
      {state.data.items.length === 0 && <p role="status" className={CARD_CLASS}>
        No hay asignaciones registradas en la estación y el período seleccionados.</p>}
      <div className="space-y-4">
        {state.data.items.map(row => <article key={row.assignmentId} className={CARD_CLASS}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-accent-700 dark:text-accent-300">
                {row.operationDate} · {row.operationCode}</p>
              <h2 className="mt-1 text-lg font-bold">{row.agentName}</h2>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Asignación {row.assignmentId}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-white/20">
                {statusFor(row)}</span>
              <button type="button" onClick={() => openReview(row)}
                className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2">
                Revisar {row.operationCode}</button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <EvidenceLane title="Aporte de OCC" contribution={row.occ} />
            <EvidenceLane title="Aporte del agente" contribution={row.rampAgent} />
          </div>
          {row.latestDecision && <p className="mt-3 rounded-lg border border-slate-200 p-3 text-xs dark:border-white/10">
            Última validación #{row.latestDecision.occRevision}/#{row.latestDecision.rampAgentRevision}: inicio de {row.latestDecision.startSource}, fin de {row.latestDecision.endSource}.
            {row.latestDecision.reason && ` Motivo: ${row.latestDecision.reason}`}
            {!row.isDecisionCurrent && ' Hay aportes posteriores; esta decisión ya no está vigente.'}
          </p>}
          {selected?.assignmentId === row.assignmentId && <section aria-label="Decisión de asistencia"
            className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-white/10">
            <p className="text-sm font-semibold">Selecciona el origen de cada hora validada</p>
            {(!row.occ || !row.rampAgent) && <p role="status" className="text-sm">
              Faltan aportes. OCC y el agente deben registrar su revisión antes de validar.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold">Inicio validado
                <select className={FIELD_CLASS} value={selected.startSource}
                  disabled={writing || Boolean(selected.unknownAttempt)}
                  onChange={event => setSelected(current => ({ ...current, startSource: event.target.value }))}>
                  <option value="Occ">OCC</option><option value="RampAgent">Agente</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-semibold">Fin validado
                <select className={FIELD_CLASS} value={selected.endSource}
                  disabled={writing || Boolean(selected.unknownAttempt)}
                  onChange={event => setSelected(current => ({ ...current, endSource: event.target.value }))}>
                  <option value="Occ">OCC</option><option value="RampAgent">Agente</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Inicio elegido: {formatInstant(laneTime(row, selected.startSource, 'observedStartAt'))} · Fin elegido: {formatInstant(laneTime(row, selected.endSource, 'observedEndAt'))}
            </p>
            <label className="block space-y-1 text-sm font-semibold">Justificación
              <textarea className={FIELD_CLASS} rows={3} maxLength={1000} value={selected.reason}
                disabled={writing || Boolean(selected.unknownAttempt)}
                onChange={event => setSelected(current => ({ ...current, reason: event.target.value }))} />
            </label>
            {requiresReason(row) && <p className="text-xs text-signal-600">Las horas de los dos aportes difieren: explica por qué eliges estos hitos.</p>}
            {selected.needsReconfirm && <div className="rounded-lg border border-signal-500/50 bg-signal-500/10 p-3 text-sm">
              <p>Hay versiones nuevas. Confirma los aportes actuales antes de validar.</p>
              <button type="button" onClick={confirmCurrent} disabled={selected.conflictRefreshPending}
                className="mt-2 rounded-lg border border-signal-600 px-3 py-2 font-semibold disabled:opacity-50">
                Confirmar versiones actuales</button>
            </div>}
            <button type="button" onClick={submit}
              disabled={!selected.unknownAttempt && !canValidate(row, selected, writing) || writing}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 disabled:opacity-50">
              {selected.unknownAttempt ? 'Reintentar misma validación' : 'Validar asistencia'}</button>
          </section>}
        </article>)}
      </div>
      <div className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-50">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-50">Página siguiente</button>
      </div>
    </>}
    {message && <p role="alert" className={`${CARD_CLASS} text-sm`}>{message}</p>}
  </main>;
}
