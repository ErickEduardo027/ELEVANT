import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getHumanResourcesScheduleWarnings } from '../../../services/humanResourcesScheduleWarningsService';

const PAGE_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 dark:border-white/20 dark:bg-surface-dark-card dark:text-text-primary-dark';
const KIND_LABELS = {
  Overlap: 'Turnos superpuestos', ShortRest: 'Descanso corto',
  SevenDayLoad: 'Carga programada en siete días', Unevaluable: 'No evaluable',
  // 2-N24: a shift on an approved absence, or outside a current airport document of the agent.
  ApprovedAbsence: 'Turno sobre una ausencia aprobada', DocumentExpired: 'Turno sin documento vigente',
};
const DOCUMENT_LABELS = { AirportId: 'carnet aeroportuario', RampDriverLicense: 'licencia de conducir en rampa' };
const documentsOf = reason => String(reason ?? '').split(',').filter(Boolean)
  .map(code => DOCUMENT_LABELS[code] ?? 'documento').join(' y ');
const REASONS = {
  AmbiguousLocalTime: 'Hora local ambigua por cambio de horario',
  InvalidLocalTime: 'Hora local inexistente por cambio de horario',
  ContextShiftUnevaluable: 'Un turno relacionado no puede evaluarse con seguridad',
};

function dateRangeValid(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return false;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) ||
    start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to)
    return false;
  const days = (end - start) / 86_400_000;
  return Number.isInteger(days) && days >= 0 && days < 30;
}

function initialTo(from, to) {
  if (dateRangeValid(from, to)) return to;
  const start = new Date(`${from}T00:00:00Z`);
  if (!Number.isFinite(start.valueOf())) return to;
  start.setUTCDate(start.getUTCDate() + 29);
  const last = start.toISOString().slice(0, 10);
  return to > last ? last : to;
}

export default function ScheduleWarningsPanel({ from: rosterFrom, to: rosterTo,
  revision, visibleShiftIds = [] }) {
  const { session } = useAuth();
  const scopes = useMemo(() => (Array.isArray(session?.stationScopes)
    ? session.stationScopes : []).filter(scope =>
    UUID.test(scope?.stationId ?? '') && typeof scope.stationCode === 'string'),
  [session?.stationScopes]);
  const [stationChoice, setStationChoice] = useState(() => scopes[0]?.stationId ?? '');
  const [from, setFrom] = useState(rosterFrom);
  const [to, setTo] = useState(() => initialTo(rosterFrom, rosterTo));
  const [page, setPage] = useState(1);
  const [localRevision, setLocalRevision] = useState(0);
  const [state, setState] = useState({ key: null, status: 'loading', data: null });
  const requestVersion = useRef(0);
  const stationId = scopes.some(scope => scope.stationId === stationChoice)
    ? stationChoice : scopes[0]?.stationId ?? '';
  const rangeAllowed = dateRangeValid(from, to);
  const queryKey = `${session?.token ?? ''}|${stationId}|${from}|${to}|${page}|${revision}|${localRevision}`;
  const shown = state.key === queryKey ? state : { status: 'loading', data: null };

  useEffect(() => {
    const refresh = () => setLocalRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    if (!session?.token || !stationId || !rangeAllowed) return () => controller.abort();
    setState({ key: queryKey, status: 'loading', data: null });
    getHumanResourcesScheduleWarnings({ stationId, from, to, page, limit: PAGE_LIMIT, includeReadiness: true },
      { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && version === requestVersion.current)
          setState({ key: queryKey, status: 'success', data });
      })
      .catch(error => {
        if (controller.signal.aborted || version !== requestVersion.current ||
          error?.name === 'AbortError') return;
        setState({ key: queryKey, status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : error?.status === 404 ? 'not-found' : 'error',
        data: null });
      });
    return () => controller.abort();
  }, [session?.token, stationId, from, to, page, revision, localRevision,
    rangeAllowed, queryKey]);

  const visible = new Set(visibleShiftIds);
  const setDate = (setter, value) => { setter(value); setPage(1); };
  const noGrant = !stationId;
  const status = !session?.token ? 'unauthorized' : noGrant ? 'no-grant' :
    !rangeAllowed ? 'invalid-range' : shown.status;

  return <section aria-labelledby="schedule-warnings-heading"
    className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-surface-dark-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal-500">Planificación de rampa</p>
        <h2 id="schedule-warnings-heading" className="mt-1 text-lg font-bold">Alertas de programación</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Orientación preliminar basada en turnos confirmados. No determina cumplimiento laboral ni tiempo trabajado.
        </p>
      </div>
      <button type="button" onClick={() => setLocalRevision(value => value + 1)}
        className={`${FIELD} font-semibold`}>Actualizar alertas</button>
    </div>

    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs font-semibold">Estación de alertas
        <select className={FIELD} value={stationId}
          onChange={event => { setStationChoice(event.target.value); setPage(1); }}>
          {scopes.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold">Desde
        <input className={FIELD} type="date" value={from}
          onChange={event => setDate(setFrom, event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-semibold">Hasta
        <input className={FIELD} type="date" value={to}
          onChange={event => setDate(setTo, event.target.value)} />
      </label>
    </div>
    {rosterTo !== initialTo(rosterFrom, rosterTo) &&
      <p className="text-xs text-text-secondary-light">La consulta inicial cubre 30 días. Cambia las fechas para revisar el día restante del mes.</p>}

    {status === 'loading' && <p role="status" className="text-sm">Cargando alertas…</p>}
    {status === 'no-grant' && <p role="status" className="text-sm">No hay estaciones autorizadas para consultar alertas.</p>}
    {status === 'invalid-range' && <p role="alert" className="text-sm text-status-danger">
      Elige un intervalo válido de hasta 30 días inclusivos.</p>}
    {['unauthorized', 'forbidden', 'not-found', 'error'].includes(status) &&
      <p role="alert" className="text-sm text-status-danger">{status === 'unauthorized'
        ? 'La sesión expiró. Vuelve a iniciar sesión.' : status === 'forbidden'
          ? 'No tienes acceso a estas alertas.' : status === 'not-found'
            ? 'Estación no disponible para esta cuenta.' : 'No se pudieron cargar las alertas.'}</p>}
    {status === 'success' && <>
      <p className="text-xs text-text-secondary-light">Regla {shown.data.ruleVersion} · vigente desde {shown.data.ruleEffectiveOn} · consultado {shown.data.asOf}</p>
      {shown.data.warnings.length === 0
        ? <p role="status" className="rounded-xl border border-dashed p-5 text-sm">
          No hay alertas de programación en este intervalo y página. Esto no certifica el cumplimiento.</p>
        : <ul aria-label="Resultados de alertas" className="space-y-3">{shown.data.warnings.map((item, index) =>
          <li key={`${item.anchorShiftId}-${item.kind}-${index}`}
            className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <div className="flex flex-wrap justify-between gap-2">
              <div><p className="font-semibold"><span>{item.agentName}</span> · {item.employeeNumber}</p>
                <p className="text-sm">{KIND_LABELS[item.kind] ?? 'Alerta de programación'} · {item.workDate}</p></div>
              <span className="text-xs text-text-secondary-light">{item.ruleVersion}</span>
            </div>
            {item.kind === 'Unevaluable' &&
              <p className="mt-2 text-sm">{REASONS[item.reason] ?? 'Datos de horario no evaluables con seguridad'}</p>}
            {item.kind === 'ApprovedAbsence' &&
              <p className="mt-2 text-sm">El agente tiene un día libre o una restricción aprobada ese día: quite el turno o revise la ausencia.</p>}
            {item.kind === 'DocumentExpired' &&
              <p className="mt-2 text-sm">Sin vigencia en la fecha del turno: {documentsOf(item.reason)}. OCC no podrá asignarle vuelos ese día.</p>}
            {!item.hasRestrictedEvidence && item.measuredMinutes != null &&
              <p className="mt-2 text-sm">{item.measuredMinutes} minutos
                {item.thresholdMinutes != null && ` · umbral preliminar ${item.thresholdMinutes} minutos`}</p>}
            {item.hasRestrictedEvidence && <p className="mt-2 text-sm">Evidencia restringida</p>}
            {item.evidence.length > 0 && <ul className="mt-2 flex flex-wrap gap-3 text-xs">
              {item.evidence.map(evidence => <li key={evidence.shiftId}>
                {visible.has(evidence.shiftId)
                  ? <a className="font-semibold text-accent-600 underline" href={`#turno-${evidence.shiftId}`}>
                    Ver turno</a>
                  : <span>Turno visible · {evidence.stationCode}</span>}
              </li>)}
            </ul>}
          </li>)}</ul>}
      <nav aria-label="Páginas de alertas" className="flex items-center justify-between gap-2 text-sm">
        <button type="button" className={`${FIELD} disabled:opacity-40`}
          disabled={page === 1} onClick={() => setPage(value => value - 1)}>Página anterior</button>
        <span>Página {page}</span>
        <button type="button" className={`${FIELD} disabled:opacity-40`}
          disabled={!shown.data.hasMore} onClick={() => setPage(value => value + 1)}>Siguiente página</button>
      </nav>
    </>}
  </section>;
}
