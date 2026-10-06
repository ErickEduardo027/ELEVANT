import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../../hooks/useAppSearchParams';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { useAuth } from '../../auth/AuthContext';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { exportHumanResourcesReport, getHumanResourcesReport } from
  '../../../services/humanResourcesVerifiedReportsService';
import { addDays, toDateKey } from '../schedules/mappers';

const PAGE_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WATCHED_RESOURCES = new Set(['ramp_profiles', 'hr_qualifications', 'hr_permits',
  'hr_shifts', 'iam_accounts']);
const KINDS = {
  expirations: { label: 'Vigencias', columns: [
    ['expiresOn', 'Vence'], ['agentName', 'Agente'], ['employeeNumber', 'Empleado'],
    ['kind', 'Clase'], ['code', 'Documento'],
  ] },
  'account-movements': { label: 'Movimientos de cuenta', columns: [
    ['occurredAt', 'Fecha UTC'], ['agentName', 'Agente'],
    ['employeeNumber', 'Empleado'], ['kind', 'Movimiento'],
  ] },
  'staff-distribution': { label: 'Distribución de turnos', columns: [
    ['workDate', 'Fecha'], ['agentName', 'Agente'], ['employeeNumber', 'Empleado'],
    ['terminalCode', 'Terminal'], ['positionCode', 'Puesto'],
    ['startsAtLocal', 'Inicio'], ['endsAtLocal', 'Fin'],
  ] },
  'qualification-coverage': { label: 'Cobertura de habilitaciones', columns: [
    ['equipmentCode', 'Equipo'], ['equipmentName', 'Nombre'],
    ['eligibleAgents', 'Elegibles'], ['qualifiedAgents', 'Habilitados'],
  ] },
};
const FIELD = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-accent-600 dark:border-white/20 dark:bg-surface-dark-card dark:text-text-primary-dark';
const CARD = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-surface-dark-card';

function validRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) -
    Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return Number.isInteger(days) && days < 30;
}

function visibleValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export default function CurrentReportsPage({ initialDate = new Date() }) {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const scopes = useMemo(() => (Array.isArray(session?.stationScopes)
    ? session.stationScopes : []).filter(scope =>
    UUID.test(scope?.stationId ?? '') && typeof scope.stationCode === 'string'),
  [session?.stationScopes]);
  const requestedStation = searchParams.get('stationId');
  const stationId = requestedStation ?? scopes[0]?.stationId ?? '';
  const kindValue = searchParams.get('kind');
  const kind = Object.hasOwn(KINDS, kindValue) ? kindValue : 'expirations';
  const documentKind = kind === 'expirations' &&
    ['Qualification', 'Permit'].includes(searchParams.get('documentKind'))
    ? searchParams.get('documentKind') : '';
  const validity = kind === 'expirations' &&
    ['Current', 'Expired'].includes(searchParams.get('validity'))
    ? searchParams.get('validity') : '';
  const from = searchParams.get('from') ?? toDateKey(addDays(initialDate, -29));
  const to = searchParams.get('to') ?? toDateKey(initialDate);
  const pageValue = Number(searchParams.get('page') ?? '1');
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null, key: null });
  const [downloadState, setDownloadState] = useState({ busy: false, error: null });
  const requestVersion = useRef(0);
  const downloadVersion = useRef(0);
  const scopeAllowed = scopes.some(scope => scope.stationId === stationId);
  const rangeAllowed = validRange(from, to);
  const queryKey = `${session?.token ?? ''}|${stationId}|${kind}|${from}|${to}|${page}|${documentKind}|${validity}`;
  const currentKey = useRef(queryKey);
  currentKey.current = queryKey;
  const shown = state.key === queryKey ? state :
    { status: 'loading', data: null, key: queryKey };

  useEffect(() => {
    downloadVersion.current += 1;
    setDownloadState({ busy: false, error: null });
  }, [queryKey]);

  const setFilter = useCallback((name, value) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value);
      else next.delete(name);
      if (name === 'kind' && value !== 'expirations') {
        next.delete('documentKind');
        next.delete('validity');
      }
      if (name !== 'page') next.delete('page');
      return next;
    });
    setDownloadState({ busy: false, error: null });
  }, [setSearchParams]);
  const refresh = useCallback(() => {
    setRevision(value => value + 1);
    setDownloadState(current => ({ ...current, error: null }));
  }, []);

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!scopeAllowed || !rangeAllowed) {
      setState({ status: scopeAllowed ? 'invalid-range' : 'empty-scope',
        data: null, key: queryKey });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null, key: queryKey });
    getHumanResourcesReport(kind, { stationId, from, to, page, limit: PAGE_LIMIT,
      ...(documentKind && { documentKind }), ...(validity && { validity }) },
      { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && version === requestVersion.current)
        setState({ status: 'success', data, key: queryKey });
    }).catch(error => {
      if (controller.signal.aborted || version !== requestVersion.current ||
        isAbortError(error)) return;
      setState({ status: error?.status === 401 ? 'unauthorized' :
        error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error',
      data: null, key: queryKey });
    });
    return () => abortForEffectCleanup(controller);
  }, [session?.token, stationId, scopeAllowed, kind, from, to, page,
    documentKind, validity,
    rangeAllowed, revision, queryKey]);

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

  async function download(format) {
    if (shown.status !== 'success' || !scopeAllowed || !rangeAllowed) return;
    const version = ++downloadVersion.current;
    const key = queryKey;
    setDownloadState({ busy: true, error: null });
    try {
      const file = await exportHumanResourcesReport(kind,
        { stationId, from, to, ...(documentKind && { documentKind }),
          ...(validity && { validity }) }, format);
      if (version !== downloadVersion.current || currentKey.current !== key) return;
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `elevant-gh-${kind}-${from}-${to}.${format}`;
      document.body.appendChild(anchor);
      try {
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      } finally {
        anchor.remove();
      }
      setDownloadState({ busy: false, error: null });
    } catch (error) {
      if (version !== downloadVersion.current || currentKey.current !== key) return;
      setDownloadState({ busy: false, error: error?.status === 422
        ? 'El reporte excede 5 000 filas. Acota el intervalo antes de exportar.'
        : error?.status === 401 || error?.status === 403 || error?.status === 404
          ? 'No tienes acceso a la exportación de esta estación.'
          : 'No se pudo descargar el reporte. Reintenta.' });
      if (error?.status === 401 || error?.status === 403 || error?.status === 404)
        setState({ status: 'forbidden', data: null, key: queryKey });
    }
  }

  return <main className="mx-auto max-w-[1440px] space-y-5 text-ink-900 dark:text-text-primary-dark">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana · consulta autorizada</p>
        <h1 className="mt-1 text-2xl font-bold">Reportes de personal</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Consulta páginas actuales por estación y descarga el conjunto filtrado completo.
        </p>
      </div>
      <button type="button" onClick={refresh}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-accent-600 dark:border-white/20 dark:bg-surface-dark-card">
        Actualizar reporte
      </button>
    </header>

    <section className={CARD} aria-label="Filtros del reporte">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold">Tipo de reporte
          <select className={FIELD} value={kind} onChange={event => setFilter('kind', event.target.value)}>
            {Object.entries(KINDS).map(([value, item]) =>
              <option key={value} value={value}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold">Estación autorizada
          <select className={FIELD} value={scopeAllowed ? stationId : ''}
            onChange={event => setFilter('stationId', event.target.value)}>
            {scopes.length === 0 && <option value="">Sin estación autorizada</option>}
            {scopes.map(scope => <option key={scope.stationId} value={scope.stationId}>
              {scope.stationCode}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold">Desde
          <input className={FIELD} type="date" value={from}
            onChange={event => setFilter('from', event.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold">Hasta
          <input className={FIELD} type="date" value={to}
            onChange={event => setFilter('to', event.target.value)} />
        </label>
        {kind === 'expirations' && <>
          <label className="space-y-1 text-xs font-semibold">Clase de documento
            <select className={FIELD} value={documentKind}
              onChange={event => setFilter('documentKind', event.target.value)}>
              <option value="">Todas</option>
              <option value="Qualification">Habilitaciones</option>
              <option value="Permit">Permisos</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold">Vigencia
            <select className={FIELD} value={validity}
              onChange={event => setFilter('validity', event.target.value)}>
              <option value="">Todas</option>
              <option value="Current">Vigentes</option>
              <option value="Expired">Vencidas</option>
            </select>
          </label>
        </>}
      </div>
      <p className="mt-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Intervalo máximo: 30 fechas inclusive. Cada página muestra hasta 20 filas.
        {kind === 'qualification-coverage' &&
          ' La cobertura usa perfiles y ciclos activos actuales y comprueba vigencias al día «Hasta»; no reconstruye el pasado.'}
        {kind === 'account-movements' &&
          ' Solo se muestran movimientos cuya auditoría identifica esta estación; el historial sin vínculo verificable no se atribuye.'}
      </p>
    </section>

    {shown.status === 'loading' && <p role="status" className={CARD}>Cargando reporte…</p>}
    {shown.status === 'empty-scope' && <p role="alert" className={CARD}>No tienes una estación autorizada para este reporte.</p>}
    {shown.status === 'invalid-range' && <p role="alert" className={CARD}>Elige un intervalo válido de hasta 30 fechas.</p>}
    {['unauthorized', 'forbidden', 'error'].includes(shown.status) && <div role="alert" className={CARD}>
      <p className="font-semibold text-status-danger">{shown.status === 'unauthorized'
        ? 'La sesión expiró. Vuelve a iniciar sesión.' : shown.status === 'forbidden'
          ? 'No tienes acceso a este reporte o estación.' : 'No se pudo cargar el reporte.'}</p>
      {shown.status === 'error' && <button type="button" onClick={refresh}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {shown.status === 'success' && <section className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-white/10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-600">
            {scopes.find(scope => scope.stationId === stationId)?.stationCode} · {from} — {to}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{KINDS[kind].label}</h2>
          <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {shown.data.rows.length} {shown.data.rows.length === 1 ? 'fila' : 'filas'} en esta página ·
            consulta {new Date(shown.data.asOf).toLocaleString('es-DO')}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={downloadState.busy} onClick={() => download('pdf')}
            className="rounded-lg border border-accent-600 px-3 py-2 text-xs font-semibold text-accent-600 disabled:opacity-50">Descargar PDF</button>
          <button type="button" disabled={downloadState.busy} onClick={() => download('xlsx')}
            className="rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Descargar XLSX</button>
        </div>
      </div>
      {downloadState.error && <p role="alert" className="mt-3 text-sm text-status-danger">{downloadState.error}</p>}
      {shown.data.rows.length === 0 ?
        <p className="py-10 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          No hay filas para estos filtros. Prueba otra estación o intervalo.
        </p> :
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide dark:border-white/10">
            {KINDS[kind].columns.map(([field, label]) => <th key={field} scope="col" className="px-3 py-3">{label}</th>)}
          </tr></thead>
          <tbody>{shown.data.rows.map((row, index) => <tr key={row.id ?? row.equipmentTypeId ?? index}
            className="border-b border-slate-100 dark:border-white/5">
            {KINDS[kind].columns.map(([field]) => <td key={field} className="px-3 py-3">{visibleValue(row[field])}</td>)}
          </tr>)}</tbody>
        </table></div>}
      <nav aria-label="Páginas del reporte" className="mt-4 flex items-center justify-between gap-4">
        <button type="button" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))}
          className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Página anterior</button>
        <span className="text-xs">Página {page}</span>
        <button type="button" disabled={!shown.data.hasMore} onClick={() => setFilter('page', String(page + 1))}
          className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Página siguiente</button>
      </nav>
    </section>}
  </main>;
}
