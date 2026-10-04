import { useEffect, useState } from 'react';
import Link from '../../components/AppLink';
import { useAuth } from '../auth/AuthContext';
import { loadOperationalNotifications, setOperationalNotificationRead } from '../../services/operationalCommunicationService';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const titles = {
  operation_submitted: 'Operación entregada para revisión',
  operation_approved: 'OCC aprobó la operación',
  operation_returned: 'OCC devolvió la operación',
  agent_message: 'Nuevo mensaje del agente',
  occ_message: 'Nuevo mensaje de OCC',
};

function formatInstant(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-DO');
}

export default function CanonicalNotificationsRoute() {
  const { session } = useAuth();
  const [state, setState] = useState({ status: 'loading', items: [], hasMore: false });
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [writeError, setWriteError] = useState('');

  useEffect(() => {
    if (!UUID.test(session?.accountId ?? '')) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('notifications')) setRevision(value => value + 1);
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [session?.accountId]);

  useEffect(() => {
    const controller = new AbortController();
    let latestRequest = 0;
    const load = async () => {
      const requestId = ++latestRequest;
      try {
        const data = await loadOperationalNotifications({ signal: controller.signal });
        if (!controller.signal.aborted && requestId === latestRequest) setState({ status: 'success', items: data.notifications, hasMore: data.hasMore });
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error) && requestId === latestRequest) setState(previous => ({ ...previous, status: 'error' }));
      }
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => { abortForEffectCleanup(controller); window.clearInterval(timer); };
  }, [revision]);

  const toggleRead = async item => {
    setBusyId(item.id);
    setWriteError('');
    try {
      const saved = await setOperationalNotificationRead(item.id, !item.readAt);
      setState(previous => ({ ...previous, items: previous.items.map(current =>
        current.id === saved.id ? saved : current) }));
    } catch (error) {
      setWriteError(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const unread = state.items.filter(item => !item.readAt).length;
  return <main className="mx-auto max-w-[1100px] space-y-5 text-ink-900 dark:text-text-primary-dark">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/80 p-5 dark:border-white/10 dark:bg-surface-dark-card">
      <div><h1 className="text-xl font-semibold">Notificaciones operativas</h1><p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Avisos persistentes de entregas, decisiones y mensajes de tus operaciones autorizadas.</p></div>
      <button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-11 rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600">Actualizar</button>
    </header>
    {state.status === 'loading' && <p role="status">Cargando notificaciones…</p>}
    {state.status === 'error' && <div role="alert" className="rounded-xl border border-status-danger/30 bg-white p-4"><p>No fue posible cargar las notificaciones.</p><button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-11 text-accent-600">Reintentar</button></div>}
    {state.status === 'success' && <>
      <p role="status"><strong>{unread}</strong> sin leer de {state.items.length} visibles</p>
      {writeError && <p role="alert" className="text-status-danger">{writeError}</p>}
      {state.items.length === 0 ? <p className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">Aún no hay notificaciones para tu cuenta. Los nuevos eventos aparecerán aquí.</p> :
        <ul className="space-y-3">{state.items.map(item => <li key={item.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 dark:bg-surface-dark-card ${item.readAt ? 'border-black/10 bg-white/80 dark:border-white/10' : 'border-accent-600/40 bg-accent-600/5'}`}>
          <div><strong>{titles[item.kind] ?? 'Evento operativo'}</strong><p className="text-sm">{item.operationCode} · {item.stationCode}</p><time dateTime={item.occurredAt} className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{formatInstant(item.occurredAt)}</time></div>
          <div className="flex flex-wrap gap-2"><Link className="inline-flex min-h-11 items-center rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white" to={item.kind === 'agent_message' || item.kind === 'occ_message' ? `/admin-occ/chat?operationId=${item.operationId}` : `/admin-occ/review?operationId=${item.operationId}`}>Abrir</Link><button type="button" disabled={busyId === item.id} onClick={() => void toggleRead(item)} className="min-h-11 rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600 disabled:opacity-50">{item.readAt ? 'Marcar no leída' : 'Marcar leída'}</button></div>
        </li>)}</ul>}
      {state.hasMore && <p className="text-xs">Se muestran los 100 avisos más recientes; existe más historial.</p>}
    </>}
  </main>;
}
