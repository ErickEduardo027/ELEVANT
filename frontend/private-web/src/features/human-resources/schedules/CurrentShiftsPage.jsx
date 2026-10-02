import { useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getHumanResourcesShifts } from '../../../services/humanResourcesShiftsReadService';
import { addDays, formatWeekRangeLabel, getWeekStart, toDateKey } from './mappers';
import ShiftRecordForm from './ShiftRecordForm';
import AvailabilityRequestsPanel from './AvailabilityRequestsPanel';

const PAGE_LIMIT = 20;
const BLOCK_LABELS = { Morning: 'Mañana', Afternoon: 'Tarde', Night: 'Noche' };

export default function CurrentShiftsPage({ initialDate = new Date() }) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(initialDate));
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [requestsAuthorized, setRequestsAuthorized] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);
  const from = toDateKey(weekStart);
  const to = toDateKey(addDays(weekStart, 6));

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setState({ status: 'loading', data: null });
    getHumanResourcesShifts({ from, to, page, limit: PAGE_LIMIT }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setRequestsAuthorized(true);
          setState({ status: 'success', data });
        }
      })
      .catch(error => {
        if (controller.signal.aborted || version !== requestVersion.current ||
            error?.name === 'AbortError') return;
        setFormOpen(false);
        setNotice('');
        if (error?.status === 401 || error?.status === 403)
          setRequestsAuthorized(false);
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error', data: null });
      });
    return () => controller.abort();
  }, [from, to, page, revision]);

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

  const goToWeek = delta => {
    setFormOpen(false);
    setNotice('');
    setWeekStart(current => addDays(current, delta));
    setPage(1);
  };

  return <div className="mx-auto max-w-[1440px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana</p>
        <h1 className="mt-1 text-2xl font-bold">Turnos de rampa</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Turnos registrados para agentes de rampa. Cada fecha y hora corresponde a la estación indicada.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.status === 'success' && !formOpen && <button type="button"
          onClick={() => { setNotice(''); setFormOpen(true); }}
          className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">
          Nuevo turno
        </button>}
        <button type="button" onClick={() => setRevision(value => value + 1)}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold dark:bg-surface-dark-card">
          Actualizar turnos
        </button>
      </div>
    </header>

    {notice && <p role="status" className="rounded-xl bg-status-success/10 p-4 text-sm">{notice}</p>}
    {formOpen && <ShiftRecordForm initialWorkDate={from} canWrite={state.status === 'success'}
      onClose={() => setFormOpen(false)}
      onRecorded={() => {
        setFormOpen(false);
        setNotice('Turno registrado. Actualizamos la semana seleccionada.');
        setPage(1);
        setRevision(value => value + 1);
      }}
      onDenied={status => {
        requestVersion.current += 1;
        setFormOpen(false);
        setNotice('');
        setState({ status: status === 401 ? 'unauthorized' : 'forbidden', data: null });
      }} />}

    <nav aria-label="Semanas de turnos" className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 p-4 dark:bg-surface-dark-card">
      <button type="button" onClick={() => goToWeek(-7)} className="rounded-lg border px-3 py-2 text-sm">Semana anterior</button>
      <span className="font-semibold">{formatWeekRangeLabel(weekStart)}</span>
      <button type="button" onClick={() => goToWeek(7)} className="rounded-lg border px-3 py-2 text-sm">Semana siguiente</button>
      <button type="button" onClick={() => { setFormOpen(false); setNotice(''); setWeekStart(getWeekStart(new Date())); setPage(1); }}
        className="rounded-lg border px-3 py-2 text-sm">Semana actual</button>
    </nav>

    {state.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando turnos…</p>}

    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No tienes acceso a los turnos registrados.'
        : state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.'
          : 'No se pudieron cargar los turnos.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'success' && <>
      <p className="text-xs text-text-secondary-light">{from} – {to} · página {page} · hasta 20 registros por página</p>
      {state.data.shifts.length ? <section className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]">
            <tr><th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Agente</th>
              <th className="px-5 py-3">Estación · terminal</th><th className="px-5 py-3">Horario local</th>
              <th className="px-5 py-3">Bloque</th><th className="px-5 py-3">Posición</th></tr>
          </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
            {state.data.shifts.map(item => <tr key={item.id}>
              <td className="px-5 py-4">{item.workDate}</td>
              <td className="px-5 py-4 font-semibold">{item.agentName}<span className="block text-xs font-normal text-text-secondary-light">{item.employeeNumber}</span></td>
              <td className="px-5 py-4">{item.stationCode} · {item.terminalCode}</td>
              <td className="px-5 py-4">{item.startsAtLocal.slice(0, 5)}–{item.endsAtLocal.slice(0, 5)}</td>
              <td className="px-5 py-4">{BLOCK_LABELS[item.block]}</td>
              <td className="px-5 py-4">{item.positionCode ?? '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </section> : <p className="rounded-xl border p-8 text-center">No hay turnos registrados en esta semana y página.</p>}
      <nav aria-label="Páginas de turnos" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}
    {requestsAuthorized && <AvailabilityRequestsPanel key={`${from}-${to}`}
      from={from} to={to} revision={revision}
      onDenied={status => {
        requestVersion.current += 1;
        setRequestsAuthorized(false);
        setFormOpen(false);
        setNotice('');
        setState({ status: status === 401 ? 'unauthorized' : 'forbidden', data: null });
      }} />}
  </div>;
}
