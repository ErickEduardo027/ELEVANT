import { useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getHumanResourcesShifts } from '../../../services/humanResourcesShiftsReadService';
import { addDays, getWeekStart, toDateKey } from './mappers';
import { getRosterRange, shiftRosterAnchor } from './rosterRange';
import AvailabilityRequestsPanel from './AvailabilityRequestsPanel';
import ScheduleWarningsPanel from './ScheduleWarningsPanel';
import { useAuth } from '../../auth/AuthContext';

const PAGE_LIMIT = 20;
const BLOCK_LABELS = { Morning: 'Mañana', Afternoon: 'Tarde', Night: 'Noche' };
const VIEWS = [
  { mode: 'week', label: 'Semana' },
  { mode: 'fortnight', label: '15 días' },
  { mode: 'month', label: 'Mes' },
];

export default function CurrentShiftsPage({ initialDate = new Date() }) {
  const { session } = useAuth();
  const [anchor, setAnchor] = useState(() => initialDate);
  const [mode, setMode] = useState('week');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ key: null, status: 'loading', data: null });
  const [requestsAuthorizedKey, setRequestsAuthorizedKey] = useState(null);
  const requestVersion = useRef(0);
  const { from, to, label } = getRosterRange(mode, anchor);
  const anchorWeek = getWeekStart(anchor);
  const weekFrom = toDateKey(anchorWeek);
  const weekTo = toDateKey(addDays(anchorWeek, 6));
  const grantKey = Array.isArray(session?.stationScopes)
    ? session.stationScopes.map(scope => scope.stationId).sort().join(',') : '';
  const authorizationKey = `${session?.token ?? ''}|${grantKey}`;
  const queryKey = `${authorizationKey}|${from}|${to}|${page}|${revision}`;
  const shown = state.key === queryKey ? state :
    { key: queryKey, status: 'loading', data: null };
  const requestsAuthorized = Boolean(session?.token) &&
    requestsAuthorizedKey === authorizationKey;

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setState({ key: queryKey, status: 'loading', data: null });
    getHumanResourcesShifts({ from, to, page, limit: PAGE_LIMIT }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setRequestsAuthorizedKey(authorizationKey);
          setState({ key: queryKey, status: 'success', data });
        }
      })
      .catch(error => {
        if (controller.signal.aborted || version !== requestVersion.current ||
            error?.name === 'AbortError') return;
        if (error?.status === 401 || error?.status === 403)
          setRequestsAuthorizedKey(null);
        setState({ key: queryKey, status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error', data: null });
      });
    return () => controller.abort();
  }, [from, to, page, revision, queryKey, authorizationKey]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('hr_shifts') || resources.includes('hr_absences')) refresh();
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
  }, []);

  const goToPeriod = direction => {
    setAnchor(current => shiftRosterAnchor(mode, current, direction));
    setPage(1);
  };

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana</p>
        <h1 className="mt-1 text-2xl font-bold">Turnos de rampa</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          OCC programa los turnos de rampa. Gestión Humana los consulta y gestiona solicitudes de disponibilidad.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRevision(value => value + 1)}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold dark:bg-surface-dark-card">
          Actualizar turnos
        </button>
      </div>
    </header>

    <nav aria-label="Períodos de turnos" className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 p-4 dark:bg-surface-dark-card">
      <div role="group" aria-label="Vista de turnos" className="flex flex-wrap gap-1">
        {VIEWS.map(view => <button key={view.mode} type="button" aria-pressed={mode === view.mode}
          onClick={() => { setMode(view.mode); setPage(1); }}
          className={`rounded-lg border px-3 py-2 text-sm ${mode === view.mode
            ? 'border-accent-600 bg-accent-600 text-white' : ''}`}>{view.label}</button>)}
      </div>
      <button type="button" onClick={() => goToPeriod(-1)} className="rounded-lg border px-3 py-2 text-sm">
        {mode === 'week' ? 'Semana anterior' : 'Período anterior'}</button>
      <span className="font-semibold" aria-live="polite">{label}</span>
      <button type="button" onClick={() => goToPeriod(1)} className="rounded-lg border px-3 py-2 text-sm">
        {mode === 'week' ? 'Semana siguiente' : 'Período siguiente'}</button>
      <button type="button" onClick={() => { setAnchor(new Date()); setPage(1); }}
        className="rounded-lg border px-3 py-2 text-sm">
        {mode === 'week' ? 'Semana actual' : 'Período actual'}</button>
    </nav>

    {shown.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando turnos…</p>}

    {['error', 'forbidden', 'unauthorized'].includes(shown.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{shown.status === 'forbidden'
        ? 'No tienes acceso a los turnos registrados.'
        : shown.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.'
          : 'No se pudieron cargar los turnos.'}</p>
      {shown.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {shown.status === 'success' && <>
      <p className="text-xs text-text-secondary-light">{from} – {to} · página {page} · hasta 20 registros por página</p>
      {shown.data.shifts.length ? <section className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <table className="table-stack w-full min-w-[780px] text-left text-sm">
          <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]">
            <tr><th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Agente</th>
              <th className="px-5 py-3">Estación · terminal</th><th className="px-5 py-3">Horario local</th>
              <th className="px-5 py-3">Bloque</th><th className="px-5 py-3">Posición</th></tr>
          </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
            {shown.data.shifts.map(item => <tr key={item.id} id={`turno-${item.id}`}>
              <td className="px-5 py-4">{item.workDate}</td>
              <td className="px-5 py-4 font-semibold">{item.agentName}<span className="block text-xs font-normal text-text-secondary-light">{item.employeeNumber}</span></td>
              <td className="px-5 py-4">{item.stationCode} · {item.terminalCode}</td>
              <td className="px-5 py-4">{item.startsAtLocal.slice(0, 5)}–{item.endsAtLocal.slice(0, 5)}</td>
              <td className="px-5 py-4">{BLOCK_LABELS[item.block]}</td>
              <td className="px-5 py-4">{item.positionCode ?? '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </section> : <p className="rounded-xl border p-8 text-center">No hay turnos registrados en este período y página.</p>}
      <nav aria-label="Páginas de turnos" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!shown.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}
    {requestsAuthorized && <ScheduleWarningsPanel key={`warnings-${from}-${to}`}
      from={from} to={to} revision={revision}
      visibleShiftIds={shown.status === 'success' ? shown.data.shifts.map(item => item.id) : []} />}
    {requestsAuthorized && mode !== 'week' && <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
      Ausencias y solicitudes · semana del {weekFrom} al {weekTo}. Esta sección conserva su consulta semanal.
    </p>}
    {requestsAuthorized && <AvailabilityRequestsPanel key={`${weekFrom}-${weekTo}`}
      from={weekFrom} to={weekTo} revision={revision}
      onDenied={status => {
        requestVersion.current += 1;
        setRequestsAuthorizedKey(null);
        setState({ key: queryKey, status: status === 401 ? 'unauthorized' : 'forbidden', data: null });
      }} />}
  </div>;
}
