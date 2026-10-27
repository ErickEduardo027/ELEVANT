import { useCallback, useEffect, useRef, useState } from 'react';
import StatusBadge from '../../../components/StatusBadge';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import {
  getHumanResourcesQualificationEquipmentTypes,
  getHumanResourcesQualificationHistory,
  getHumanResourcesQualifications,
  getHumanResourcesQualificationSummary,
} from '../../../services/humanResourcesQualificationsReadService';
import DocumentFilters from '../documents/DocumentFilters';
import DocumentHistoryDrawer from '../documents/DocumentHistoryDrawer';
import DocumentValiditySummary from '../documents/DocumentValiditySummary';
import { localToday, validityLabel, validityTone } from '../documents/documentValidity';
import QualificationRecordForm from './QualificationRecordForm';

const PAGE_LIMIT = 20;
const EMPTY_FILTERS = { search: '', equipmentTypeId: '', validity: '' };

function withoutEmpty(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

export default function CurrentQualificationsPage() {
  const access = useOptionalDepartmentAccess();
  const canCreate = Boolean(access?.can('human_resources.qualifications.create'));
  const canManage = Boolean(access?.can('human_resources.qualifications.update'));
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [form, setForm] = useState({ open: false, initialQualification: null });
  const [history, setHistory] = useState(null);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);
  const asOf = localToday();
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setState({ status: 'loading', data: null });
    getHumanResourcesQualifications({ page, limit: PAGE_LIMIT, asOf, ...withoutEmpty(JSON.parse(filterKey)) },
      { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && version === requestVersion.current)
          setState({ status: 'success', data });
      })
      .catch(error => {
        if (controller.signal.aborted || version !== requestVersion.current ||
            error?.name === 'AbortError') return;
        setForm({ open: false, initialQualification: null });
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error', data: null });
      });
    return () => controller.abort();
  }, [page, revision, asOf, filterKey]);

  useEffect(() => {
    const controller = new AbortController();
    getHumanResourcesQualificationEquipmentTypes({ signal: controller.signal })
      .then(types => { if (!controller.signal.aborted) setEquipmentTypes(types); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('ramp_profiles') || resources.includes('hr_qualifications')) refresh();
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

  const changeFilters = useCallback(next => { setFilters(next); setPage(1); }, []);
  const summaryQuery = { asOf, ...withoutEmpty({ search: filters.search, equipmentTypeId: filters.equipmentTypeId }) };

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana</p>
        <h1 className="mt-1 text-2xl font-bold">Habilitaciones y certificaciones</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Ciclos actuales por agente y equipo. Cada renovación agrega un ciclo y conserva el historial.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.status === 'success' && canCreate && <button type="button"
          onClick={() => { setNotice(''); setForm({ open: true, initialQualification: null }); }}
          className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">
          Registrar habilitación
        </button>}
        <button type="button" onClick={() => setRevision(value => value + 1)}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold dark:bg-surface-dark-card">
          Actualizar habilitaciones
        </button>
      </div>
    </header>

    {notice && <p role="status" className="rounded-xl bg-status-success/10 p-4 text-sm">{notice}</p>}
    {form.open && <QualificationRecordForm key={form.initialQualification?.id ?? 'new'}
      initialQualification={form.initialQualification}
      onClose={() => setForm({ open: false, initialQualification: null })}
      onRecorded={receipt => {
        setForm({ open: false, initialQualification: null });
        setNotice(`Habilitación guardada como ciclo ${receipt.cycleNumber}.`);
        setPage(1);
        setRevision(value => value + 1);
      }}
      onDenied={status => {
        requestVersion.current += 1;
        setForm({ open: false, initialQualification: null });
        setState({ status: status === 401 ? 'unauthorized' : 'forbidden', data: null });
      }} />}

    {!['forbidden', 'unauthorized'].includes(state.status) && <>
      <DocumentValiditySummary load={getHumanResourcesQualificationSummary} query={summaryQuery}
        revision={revision} selected={filters.validity} gender="feminine" noun="habilitaciones"
        onSelect={validity => changeFilters({ ...filters, validity })} />
      <DocumentFilters filters={filters} onChange={changeFilters} gender="feminine"
        searchLabel="Agente o número de empleado"
        type={{ key: 'equipmentTypeId', label: 'Equipo',
          options: equipmentTypes.map(type => ({ value: type.id, label: `${type.code} · ${type.name}` })) }} />
    </>}

    {state.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando habilitaciones…</p>}

    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No tienes acceso a las habilitaciones registradas.'
        : state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.'
          : 'No se pudieron cargar las habilitaciones.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'success' && <>
      <p className="text-xs text-text-secondary-light">Página {page} · hasta 20 registros por página · vigencia al {asOf}</p>
      {state.data.qualifications.length ? <section className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <table className="table-stack w-full min-w-[780px] text-left text-sm">
          <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]">
            <tr><th className="px-5 py-3">Agente</th><th className="px-5 py-3">Equipo</th>
              <th className="px-5 py-3">Obtenida</th><th className="px-5 py-3">Vence</th>
              <th className="px-5 py-3">Estado</th><th className="px-5 py-3">Emisor</th>
              <th className="px-5 py-3">Acciones</th></tr>
          </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
            {state.data.qualifications.map(item => <tr key={item.id}>
              <td className="px-5 py-4 font-semibold">{item.agentName}<span className="block text-xs font-normal text-text-secondary-light">{item.employeeNumber}</span></td>
              <td className="px-5 py-4">{item.equipmentName}<span className="block text-xs text-text-secondary-light">{item.equipmentCode} · ciclo {item.cycleNumber}</span></td>
              <td className="px-5 py-4">{item.obtainedOn}</td><td className="px-5 py-4">{item.expiresOn}</td>
              <td className="px-5 py-4"><StatusBadge tone={validityTone(item.validity)} label={validityLabel(item.validity)} /></td>
              <td className="px-5 py-4">{item.certifyingEntity}<span className="block text-xs text-text-secondary-light">{item.instructorName}</span></td>
              <td className="px-5 py-4"><div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => setHistory(item)}
                  aria-label={`Historial de ${item.agentName} · ${item.equipmentCode}`}
                  className="text-sm font-semibold text-accent-600">Historial</button>
                {canManage && <button type="button"
                  onClick={() => { setNotice(''); setForm({ open: true, initialQualification: item }); }}
                  className="text-sm font-semibold text-accent-600">Renovar</button>}
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </section> : <p className="rounded-xl border p-8 text-center">No hay habilitaciones con estos filtros.</p>}
      <nav aria-label="Páginas de habilitaciones" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}

    <DocumentHistoryDrawer target={history} load={getHumanResourcesQualificationHistory}
      onClose={() => setHistory(null)}
      title={history ? `Historial · ${history.equipmentCode}` : 'Historial'}
      subtitle={history ? `${history.agentName} · ${history.employeeNumber} · ${history.equipmentName}` : undefined}
      renderCycle={cycle => <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-text-secondary-light">Entrenamiento</dt><dd>{cycle.trainingDate}</dd></div>
        <div><dt className="text-text-secondary-light">Obtenida</dt><dd>{cycle.obtainedOn}</dd></div>
        <div><dt className="text-text-secondary-light">Vence</dt><dd>{cycle.expiresOn}</dd></div>
        <div><dt className="text-text-secondary-light">Emisor</dt><dd>{cycle.certifyingEntity}</dd></div>
        <div className="col-span-2"><dt className="text-text-secondary-light">Instructor</dt><dd>{cycle.instructorName}</dd></div>
        {cycle.notes && <div className="col-span-2"><dt className="text-text-secondary-light">Notas</dt><dd className="whitespace-pre-line">{cycle.notes}</dd></div>}
      </dl>} />
  </div>;
}
