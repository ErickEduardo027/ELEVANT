import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getHumanResourcesQualifications } from '../../../services/humanResourcesQualificationsReadService';
import { getHumanResourcesPermits } from '../../../services/humanResourcesPermitsReadService';
import { getHumanResourcesShifts } from '../../../services/humanResourcesShiftsReadService';
import { addDays, formatWeekRangeLabel, getWeekStart, toDateKey } from '../schedules/mappers';

const SOURCE_LIMIT = 100;
const WATCHED_RESOURCES = new Set(['ramp_profiles', 'hr_qualifications', 'hr_permits', 'hr_shifts']);
const PERMIT_LABELS = { AirportId: 'Carnet aeroportuario', RampDriverLicense: 'Licencia de rampa' };

function expiryRows(data) {
  return [
    ...data.qualifications.qualifications.map(item => ({
      id: `qualification-${item.id}`, name: item.agentName,
      kind: 'Habilitación', label: item.equipmentName,
      startsOn: item.obtainedOn,
      expiresOn: item.expiresOn, path: '/gestion-humana/certifications',
    })),
    ...data.permits.permits.map(item => ({
      id: `permit-${item.id}`, name: item.agentName,
      kind: 'Permiso', label: PERMIT_LABELS[item.documentType] ?? 'Permiso aeroportuario',
      startsOn: item.issuedOn,
      expiresOn: item.expiresOn, path: '/gestion-humana/permits',
    })),
  ].sort((left, right) => left.expiresOn.localeCompare(right.expiresOn) ||
    left.name.localeCompare(right.name));
}

function SourceLimit({ data }) {
  return <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
    Se consultan los primeros 100 registros por fuente. Las cifras corresponden solo a estas páginas;
    abre cada módulo para consultar más páginas de registros autorizados.
    {data.qualifications.hasMore && <span className="block font-semibold text-signal-600">Hay más habilitaciones fuera de esta muestra.</span>}
    {data.permits.hasMore && <span className="block font-semibold text-signal-600">Hay más permisos fuera de esta muestra.</span>}
    {data.shifts.hasMore && <span className="block font-semibold text-signal-600">Hay más turnos fuera de esta muestra.</span>}
  </p>;
}

export default function CurrentReportsPage({ initialDate = new Date() }) {
  const [weekSelection, setWeekSelection] = useState(() => ({
    start: getWeekStart(initialDate), followsCurrentWeek: true,
  }));
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const weekStart = weekSelection.start;
  const from = toDateKey(weekStart);
  const to = toDateKey(addDays(weekStart, 6));
  const today = toDateKey(initialDate);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', data: null });
    Promise.all([
      getHumanResourcesQualifications({ page: 1, limit: SOURCE_LIMIT }, { signal: controller.signal }),
      getHumanResourcesPermits({ page: 1, limit: SOURCE_LIMIT }, { signal: controller.signal }),
      getHumanResourcesShifts({ from, to, page: 1, limit: SOURCE_LIMIT }, { signal: controller.signal }),
    ]).then(([qualifications, permits, shifts]) => {
      if (!controller.signal.aborted) setState({ status: 'success',
        data: { qualifications, permits, shifts } });
    }).catch(error => {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setState({ status: error?.status === 401 ? 'unauthorized' :
        error?.status === 403 ? 'forbidden' : 'error', data: null });
    });
    return () => controller.abort();
  }, [from, to, revision]);

  useEffect(() => {
    const refresh = () => {
      setWeekSelection(current => {
        if (!current.followsCurrentWeek) return current;
        const next = getWeekStart(new Date());
        return toDateKey(next) === toDateKey(current.start) ? current : { ...current, start: next };
      });
      setRevision(value => value + 1);
    };
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
  }, []);

  const changeWeek = delta => setWeekSelection(current => ({
    start: addDays(current.start, delta), followsCurrentWeek: false,
  }));
  const rows = state.status === 'success' ? expiryRows(state.data) : [];

  return <main className="mx-auto max-w-[1440px] space-y-5 text-ink-900 dark:text-text-primary-dark">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana · consulta autorizada</p>
        <h1 className="mt-1 text-2xl font-bold">Reportes de personal</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Vigencias registradas y turnos de la semana, consultados directamente en ELEVANT.
        </p>
      </div>
      <button type="button" onClick={() => setRevision(value => value + 1)}
        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold dark:bg-surface-dark-card">
        Actualizar reporte
      </button>
    </header>

    <nav aria-label="Semana del reporte" className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 p-4 dark:bg-surface-dark-card">
      <button type="button" onClick={() => changeWeek(-7)} className="rounded-lg border px-3 py-2 text-sm">Semana anterior</button>
      <span className="font-semibold">{formatWeekRangeLabel(weekStart)}</span>
      <button type="button" onClick={() => changeWeek(7)} className="rounded-lg border px-3 py-2 text-sm">Semana siguiente</button>
      <button type="button" onClick={() => setWeekSelection({
        start: getWeekStart(new Date()), followsCurrentWeek: true,
      })}
        className="rounded-lg border px-3 py-2 text-sm">Semana actual</button>
    </nav>

    {state.status === 'loading' && <p role="status" className="rounded-xl bg-white/70 p-5 dark:bg-surface-dark-card">Cargando reporte…</p>}
    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No tienes acceso a este reporte.' : state.status === 'unauthorized'
          ? 'La sesión expiró. Vuelve a iniciar sesión.' : 'No se pudo cargar el reporte.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'success' && <>
      <SourceLimit data={state.data} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
        <section className="rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-lg font-semibold">Vigencias de la muestra</h2>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Ordenadas por fecha de vencimiento; no son un total global.</p></div>
            <span className="rounded-full bg-accent-600/10 px-3 py-1 text-sm font-semibold text-accent-600">{rows.length} registros</span>
          </div>
          {rows.length === 0 ? <p>No hay vigencias registradas en las páginas consultadas.</p>
            : <ol className="divide-y divide-black/5 dark:divide-white/5">{rows.slice(0, 20).map(item =>
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><time dateTime={item.expiresOn} className="text-xs font-semibold text-accent-600">{item.expiresOn}</time>
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{item.kind} · {item.label} · {item.expiresOn < today ? 'Vencida' : item.startsOn > today ? 'Aún no inicia' : 'Vigente'}</p></div>
                <Link to={item.path} className="rounded-lg border border-accent-600 px-3 py-2 text-xs font-semibold text-accent-600">Ver módulo</Link>
              </li>)}</ol>}
          {rows.length > 20 && <p className="mt-3 text-xs text-text-secondary-light">Se muestran 20 vigencias de la muestra; abre los módulos para consultar más.</p>}
        </section>
        <section className="rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-lg font-semibold">Turnos registrados</h2>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{from} – {to}</p></div>
            <span className="rounded-full bg-accent-600/10 px-3 py-1 text-sm font-semibold text-accent-600">{state.data.shifts.shifts.length} consultados</span>
          </div>
          {state.data.shifts.shifts.length === 0 ? <p>No hay turnos registrados en la semana seleccionada.</p>
            : <ul className="divide-y divide-black/5 dark:divide-white/5">{state.data.shifts.shifts.slice(0, 10).map(item =>
              <li key={item.id} className="py-3"><p className="font-semibold">{item.agentName}</p>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{item.workDate} · {item.stationCode} / {item.terminalCode} · {item.startsAtLocal.slice(0, 5)}–{item.endsAtLocal.slice(0, 5)}</p></li>)}</ul>}
          <Link to="/gestion-humana/schedules" className="mt-4 inline-flex rounded-lg border border-accent-600 px-3 py-2 text-xs font-semibold text-accent-600">Abrir horarios</Link>
        </section>
      </div>
    </>}
  </main>;
}
