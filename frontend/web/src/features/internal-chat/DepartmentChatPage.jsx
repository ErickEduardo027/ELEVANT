import { useEffect, useMemo, useState } from 'react';
import { MessageCircleIcon } from '../shell/components/icons';
import { getDepartmentMessages, markDepartmentMessageRead, sendDepartmentMessage } from '../../services/departmentChatService';

const formatTime = value => new Intl.DateTimeFormat('es-DO', {
  day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

export default function DepartmentChatPage() {
  const [snapshot, setSnapshot] = useState({ currentRole: null, participants: [], messages: [] });
  const [recipientRole, setRecipientRole] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  async function load({ silent = false } = {}) {
    if (!silent) setStatus('loading');
    try {
      const next = await getDepartmentMessages();
      setSnapshot(next);
      setRecipientRole(current => current || next.participants[0]?.role || '');
      setStatus('success');
      setError('');
    } catch (loadError) {
      setStatus('error');
      setError(loadError.message);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load({ silent: true }), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const messages = useMemo(() => snapshot.messages.filter(message =>
    message.senderRole === recipientRole || message.recipientRole === recipientRole
  ), [recipientRole, snapshot.messages]);

  useEffect(() => {
    const unread = messages.filter(message => message.recipientRole === snapshot.currentRole && !message.readAt);
    if (!unread.length) return;
    void Promise.all(unread.map(message => markDepartmentMessageRead(message.id)))
      .then(() => setSnapshot(current => ({
        ...current,
        messages: current.messages.map(message => unread.some(item => item.id === message.id)
          ? { ...message, readAt: new Date().toISOString() }
          : message),
      })))
      .catch(() => undefined);
  }, [messages, snapshot.currentRole]);

  async function submit(event) {
    event.preventDefault();
    if (!recipientRole || !draft.trim() || sending) return;
    setSending(true);
    try {
      const created = await sendDepartmentMessage({ recipientRole, content: draft.trim() });
      setSnapshot(current => ({ ...current, messages: [...current.messages, created] }));
      setDraft('');
      setError('');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  if (status === 'error' && snapshot.messages.length === 0) return (
    <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
      <p className="font-semibold text-status-danger">No se pudo cargar el chat departamental.</p>
      <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{error}</p>
      <button type="button" onClick={() => load()} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
    </div>
  );

  const participant = snapshot.participants.find(item => item.role === recipientRole);
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Comunicación interna</p>
        <h1 className="mt-1 text-2xl font-bold">Chat entre departamentos</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Mensajes persistentes para coordinar el flujo operativo de ELEVANT.</p>
      </header>

      <section className="grid min-h-[620px] overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card md:grid-cols-[280px_1fr]">
        <aside className="border-b border-black/5 p-4 md:border-b-0 md:border-r dark:border-white/5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">Destinatario</p>
          <div className="space-y-2">
            {snapshot.participants.map(item => (
              <button key={item.role} type="button" onClick={() => setRecipientRole(item.role)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${recipientRole === item.role ? 'bg-accent-600 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
                <MessageCircleIcon className="h-4 w-4" />{item.label}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[500px] flex-col">
          <header className="border-b border-black/5 px-5 py-4 dark:border-white/5">
            <h2 className="font-semibold">{participant?.label ?? 'Seleccione un departamento'}</h2>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Actualización automática cada 5 segundos</p>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-black/[0.015] p-5 dark:bg-white/[0.015]">
            {status === 'loading' ? <div className="h-28 animate-pulse rounded-xl bg-black/[0.03]" /> : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-text-secondary-light dark:text-text-secondary-dark">No hay mensajes con este departamento.<br />Envía el primero para iniciar la coordinación.</div>
            ) : messages.map(message => {
              const own = message.senderRole === snapshot.currentRole;
              return <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${own ? 'rounded-br-md bg-accent-600 text-white' : 'rounded-bl-md border border-black/10 bg-white dark:border-white/10 dark:bg-surface-dark'}`}>
                  <p>{message.content}</p>
                  <p className={`mt-1 text-[10px] ${own ? 'text-white/70' : 'text-text-secondary-light'}`}>{message.senderName} · {formatTime(message.createdAt)}</p>
                </div>
              </div>;
            })}
          </div>
          <form onSubmit={submit} className="flex gap-3 border-t border-black/5 p-4 dark:border-white/5">
            <input value={draft} onChange={event => setDraft(event.target.value)} disabled={!recipientRole || sending} placeholder="Escribe un mensaje departamental…" className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-surface-dark" />
            <button type="submit" disabled={!recipientRole || !draft.trim() || sending} className="rounded-xl bg-signal-500 px-5 text-sm font-semibold text-white disabled:opacity-50">{sending ? 'Enviando…' : 'Enviar'}</button>
          </form>
          {error && <p className="px-4 pb-3 text-xs text-status-danger">{error}</p>}
        </div>
      </section>
    </div>
  );
}
