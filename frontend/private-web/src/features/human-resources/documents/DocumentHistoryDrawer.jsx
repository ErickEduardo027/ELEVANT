import { useEffect, useState } from 'react';
import Drawer from '../../../components/Drawer';

function formatRecordedAt(value) {
  return new Date(value).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Historial de ciclos de un documento (habilitación o carnet). Los ciclos
 * anteriores nunca se editan: cada renovación agrega uno nuevo.
 */
export default function DocumentHistoryDrawer({ target, load, title, subtitle, renderCycle, onClose }) {
  const [state, setState] = useState({ status: 'idle', data: null });
  const targetId = target?.id ?? null;

  useEffect(() => {
    if (!targetId) return undefined;
    const controller = new AbortController();
    setState({ status: 'loading', data: null });
    load(targetId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', data }); })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 403 ? 'forbidden' : error?.status === 404 ? 'missing'
          : error?.status === 401 ? 'unauthorized' : 'error', data: null });
      });
    return () => controller.abort();
  }, [load, targetId]);

  return <Drawer open={Boolean(target)} onClose={onClose} title={title}
    description={subtitle} widthClassName="lg:w-[560px]">
    <div className="space-y-4">
      {state.status === 'loading' && <p role="status" className="text-sm">Cargando historial…</p>}
      {['error', 'forbidden', 'missing', 'unauthorized'].includes(state.status) && <p role="alert" className="text-sm text-status-danger">
        {state.status === 'forbidden' ? 'No tienes acceso a este historial.'
          : state.status === 'missing' ? 'El registro ya no existe.'
            : state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.'
              : 'No se pudo cargar el historial.'}
      </p>}
      {state.status === 'success' && <ol aria-label="Ciclos registrados" className="space-y-3">
        {state.data.cycles.map(cycle => <li key={cycle.id}
          className={`rounded-xl border p-4 text-sm ${cycle.isCurrent ? 'border-accent-600/40 bg-accent-600/5' : 'border-black/5 dark:border-white/10'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Ciclo {cycle.cycleNumber}{cycle.isCurrent ? ' · actual' : ''}</p>
            <p className="text-xs text-text-secondary-light">
              {cycle.recordedByName ? `Registrado por ${cycle.recordedByName}` : 'Carga inicial'} · {formatRecordedAt(cycle.recordedAt)}
            </p>
          </div>
          <div className="mt-2">{renderCycle(cycle)}</div>
        </li>)}
      </ol>}
    </div>
  </Drawer>;
}
