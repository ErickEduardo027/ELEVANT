import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { OccStationPicker } from '../admin-occ/OccQueueState';
import { loadOperationalConversations, loadOperationalMessages, sendOperationalMessage } from '../../services/operationalCommunicationService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatInstant(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-DO');
}

export default function CanonicalChatRoute() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const stationScopes = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => UUID.test(scope?.stationId ?? '')), [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const [conversations, setConversations] = useState({ status: 'loading', items: [], hasMore: false });
  const [messages, setMessages] = useState({ status: 'idle', items: [], hasMore: false });
  const [listRevision, setListRevision] = useState(0);
  const [messageRevision, setMessageRevision] = useState(0);
  const [draft, setDraft] = useState('');
  const [pendingCommand, setPendingCommand] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const requestedOperation = params.get('operationId');
  const selectedOperation = conversations.items.find(item => item.operationId === requestedOperation) ?? null;

  useEffect(() => {
    if (!stationScopes.some(scope => scope.stationId === stationId)) setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);

  useEffect(() => {
    if (!stationId || !stationScopes.some(scope => scope.stationId === stationId)) {
      setConversations({ status: 'empty-scope', items: [], hasMore: false });
      return undefined;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await loadOperationalConversations(stationId, { signal: controller.signal });
        if (!controller.signal.aborted) setConversations({ status: 'success', items: data.conversations, hasMore: data.hasMore });
      } catch {
        if (!controller.signal.aborted) setConversations(previous => ({ ...previous, status: 'error' }));
      }
    };
    setConversations({ status: 'loading', items: [], hasMore: false });
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [stationId, stationScopes, listRevision]);

  useEffect(() => {
    if (!selectedOperation) {
      setMessages({ status: 'idle', items: [], hasMore: false });
      return undefined;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await loadOperationalMessages(selectedOperation.operationId, { signal: controller.signal });
        if (!controller.signal.aborted) setMessages({ status: 'success', items: data.messages, hasMore: data.hasMore });
      } catch {
        if (!controller.signal.aborted) setMessages(previous => ({ ...previous, status: 'error' }));
      }
    };
    setMessages({ status: 'loading', items: [], hasMore: false });
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [selectedOperation?.operationId, messageRevision]);

  const selectConversation = operationId => {
    if (sending || pendingCommand) return;
    setParams({ operationId });
    setDraft('');
    setSendError('');
  };

  const submit = async event => {
    event.preventDefault();
    if (!selectedOperation || sending) return;
    const command = pendingCommand ?? { operationId: selectedOperation.operationId,
      content: draft.trim(), key: crypto.randomUUID() };
    if (!command.content || command.content.length > 2000 || command.operationId !== selectedOperation.operationId) return;
    setPendingCommand(command);
    setSending(true);
    setSendError('');
    try {
      await sendOperationalMessage(command.operationId, command.content, command.key);
      setPendingCommand(null);
      setDraft('');
      setMessageRevision(value => value + 1);
      setListRevision(value => value + 1);
    } catch (error) {
      setSendError(error.message);
    } finally {
      setSending(false);
    }
  };

  return <main className="mx-auto max-w-[1440px] space-y-5 p-1 text-ink-900 dark:text-text-primary-dark">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/80 p-5 dark:border-white/10 dark:bg-surface-dark-card">
      <div><h1 className="text-xl font-semibold">Chat operativo</h1><p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Mensajes persistentes por operación entre OCC y agentes asignados. Actualización automática cada 10 segundos.</p></div>
      {stationScopes.length > 0 && <OccStationPicker stationScopes={stationScopes} stationId={stationId} onChange={value => { if (!pendingCommand) { setStationId(value); setParams({}); } }} />}
    </header>
    {conversations.status === 'empty-scope' ? <p role="status">Tu cuenta no tiene una estación OCC autorizada.</p> :
      conversations.status === 'loading' ? <p role="status">Cargando conversaciones…</p> :
        conversations.status === 'error' ? <div role="alert"><p>No fue posible cargar las conversaciones.</p><button type="button" onClick={() => setListRevision(value => value + 1)}>Reintentar</button></div> :
          <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(15rem,22rem)_1fr]">
            <section aria-label="Conversaciones" className="rounded-2xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-surface-dark-card">
              <div className="mb-3 flex items-center justify-between gap-2 px-2"><h2 className="font-semibold">Operaciones</h2><button type="button" onClick={() => setListRevision(value => value + 1)} className="min-h-11 rounded-lg px-3 text-sm text-accent-600">Actualizar</button></div>
              {conversations.items.length === 0 ? <p className="p-3 text-sm">No tienes operaciones con conversación disponible en esta estación.</p> :
                <ul className="space-y-1">{conversations.items.map(item => <li key={item.operationId}><button type="button" disabled={Boolean(pendingCommand)} onClick={() => selectConversation(item.operationId)} aria-current={selectedOperation?.operationId === item.operationId ? 'true' : undefined} className="min-h-14 w-full rounded-lg border border-transparent p-3 text-left hover:border-accent-600/40 aria-[current=true]:bg-accent-600/10"><strong>{item.operationCode}</strong><span className="ml-2 text-xs">{item.stationCode}</span><p className="truncate text-sm">{item.lastMessage?.content ?? `${item.airlineName} · Sin mensajes`}</p></button></li>)}</ul>}
              {conversations.hasMore && <p className="p-3 text-xs">Se muestran las primeras 100 operaciones; abre la revisión para localizar otras.</p>}
            </section>
            <section aria-label="Mensajes" className="flex flex-col rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-surface-dark-card">
              {!selectedOperation ? <p className="m-auto text-sm">Selecciona una operación para ver sus mensajes.</p> : <>
                <div className="flex items-center justify-between gap-2 border-b border-black/10 pb-3"><div><h2 className="font-semibold">{selectedOperation.operationCode}</h2><p className="text-xs">{selectedOperation.airlineName}{selectedOperation.agentName ? ` · ${selectedOperation.agentName}` : ''}</p></div><Link className="text-sm text-accent-600" to={`/admin-occ/review?operationId=${selectedOperation.operationId}`}>Ver operación</Link></div>
                <div className="min-h-56 flex-1 space-y-3 overflow-y-auto py-4" aria-live="polite">{messages.status === 'loading' ? <p>Cargando mensajes…</p> : messages.status === 'error' ? <div role="alert"><p>No fue posible cargar los mensajes.</p><button type="button" onClick={() => setMessageRevision(value => value + 1)}>Reintentar</button></div> : messages.items.length === 0 ? <p>Sin mensajes todavía.</p> : messages.items.map(item => <article key={item.id} className="rounded-xl border border-black/10 p-3 dark:border-white/10"><p className="text-xs font-semibold">{item.senderName} · {item.senderRole === 'agent' ? 'Agente' : 'OCC'} · <time dateTime={item.sentAt}>{formatInstant(item.sentAt)}</time></p><p className="whitespace-pre-wrap break-words text-sm">{item.content}</p></article>)}{messages.hasMore && <p className="text-xs">Se muestran los 200 mensajes más recientes.</p>}</div>
                <form onSubmit={submit} className="space-y-2 border-t border-black/10 pt-3"><label htmlFor="occ-chat-draft" className="text-sm font-semibold">Mensaje</label><textarea id="occ-chat-draft" value={pendingCommand?.content ?? draft} maxLength={2000} disabled={Boolean(pendingCommand)} onChange={event => setDraft(event.target.value)} rows={3} className="w-full rounded-lg border border-black/20 bg-white p-3 text-ink-900 dark:border-white/20 dark:bg-surface-dark-card dark:text-white" />{sendError && <p role="alert" className="text-sm text-status-danger">{sendError} El reintento conserva el identificador del mensaje.</p>}<button type="submit" disabled={sending || (!pendingCommand && !draft.trim())} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{sending ? 'Enviando…' : pendingCommand ? 'Reintentar envío' : 'Enviar mensaje'}</button></form>
              </>}
            </section>
          </div>}
  </main>;
}
