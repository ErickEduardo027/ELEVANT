import { useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getHumanResourcesPermits } from '../../../services/humanResourcesPermitsReadService';
import PermitRecordForm from './PermitRecordForm';

const PAGE_LIMIT = 20;
const TYPE_LABELS = {
  AirportId: 'Carnet aeroportuario',
  RampDriverLicense: 'Licencia de conducir en rampa',
};

function permitStatus(item, today) {
  if (item.issuedOn > today) return 'Aún no inicia';
  return item.expiresOn < today ? 'Vencido' : 'Vigente';
}

export default function CurrentPermitsPage() {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [form, setForm] = useState({ open: false, initialPermit: null });
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setState({ status: 'loading', data: null });
    getHumanResourcesPermits({ page, limit: PAGE_LIMIT }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && version === requestVersion.current)
          setState({ status: 'success', data });
      })
      .catch(error => {
        if (controller.signal.aborted || version !== requestVersion.current ||
            error?.name === 'AbortError') return;
        setForm({ open: false, initialPermit: null });
        setNotice('');
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 ? 'forbidden' : 'error', data: null });
      });
    return () => controller.abort();
  }, [page, revision]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('ramp_profiles') || resources.includes('hr_permits')) refresh();
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

  return <div className="mx-auto max-w-[1440px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana</p>
        <h1 className="mt-1 text-2xl font-bold">Carnets y permisos aeroportuarios</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          Documentos actuales registrados para cada agente. La vigencia se calcula con las fechas guardadas.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.status === 'success' && <button type="button"
          onClick={() => { setNotice(''); setForm({ open: true, initialPermit: null }); }}
          className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">
          Registrar permiso
        </button>}
        <button type="button" onClick={() => setRevision(value => value + 1)}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold dark:bg-surface-dark-card">
          Actualizar permisos
        </button>
      </div>
    </header>

    {notice && <p role="status" className="rounded-xl bg-status-success/10 p-4 text-sm">{notice}</p>}
    {form.open && <PermitRecordForm key={form.initialPermit?.id ?? 'new'}
      initialPermit={form.initialPermit}
      onClose={() => setForm({ open: false, initialPermit: null })}
      onRecorded={receipt => {
        setForm({ open: false, initialPermit: null });
        setNotice(`Permiso guardado como ciclo ${receipt.cycleNumber}.`);
        setPage(1);
        setRevision(value => value + 1);
      }}
      onDenied={status => {
        requestVersion.current += 1;
        setForm({ open: false, initialPermit: null });
        setNotice('');
        setState({ status: status === 401 ? 'unauthorized' : 'forbidden', data: null });
      }} />}

    {state.status === 'loading' && <p role="status"
      className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando permisos…</p>}

    {['error', 'forbidden', 'unauthorized'].includes(state.status) && <div role="alert"
      className="rounded-2xl border border-status-danger/30 bg-white/70 p-5 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">{state.status === 'forbidden'
        ? 'No tienes acceso a los permisos registrados.'
        : state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.'
          : 'No se pudieron cargar los permisos.'}</p>
      {state.status === 'error' && <button type="button" onClick={() => setRevision(value => value + 1)}
        className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
    </div>}

    {state.status === 'success' && <>
      <p className="text-xs text-text-secondary-light">Página {page} · hasta 20 registros por página</p>
      {state.data.permits.length ? <section className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-black/[0.025] text-xs uppercase text-text-secondary-light dark:bg-white/[0.025]">
            <tr><th className="px-5 py-3">Agente</th><th className="px-5 py-3">Documento</th>
              <th className="px-5 py-3">Número</th><th className="px-5 py-3">Emitido</th>
              <th className="px-5 py-3">Vence</th><th className="px-5 py-3">Estado</th>
              <th className="px-5 py-3">Acción</th></tr>
          </thead><tbody className="divide-y divide-black/5 dark:divide-white/5">
            {state.data.permits.map(item => <tr key={item.id}>
              <td className="px-5 py-4 font-semibold">{item.agentName}<span className="block text-xs font-normal text-text-secondary-light">{item.employeeNumber}</span></td>
              <td className="px-5 py-4">{TYPE_LABELS[item.documentType]}<span className="block text-xs text-text-secondary-light">Ciclo {item.cycleNumber}</span></td>
              <td className="px-5 py-4">{item.documentNumber}</td>
              <td className="px-5 py-4">{item.issuedOn}</td><td className="px-5 py-4">{item.expiresOn}</td>
              <td className="px-5 py-4">{permitStatus(item, today)}</td>
              <td className="px-5 py-4"><button type="button"
                onClick={() => { setNotice(''); setForm({ open: true, initialPermit: item }); }}
                className="text-sm font-semibold text-accent-600">Renovar</button></td>
            </tr>)}
          </tbody>
        </table>
      </section> : <p className="rounded-xl border p-8 text-center">No hay permisos registrados en esta página.</p>}
      <nav aria-label="Páginas de permisos" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(value => value + 1)}
          className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}
  </div>;
}
