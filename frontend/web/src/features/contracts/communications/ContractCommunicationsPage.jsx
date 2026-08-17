import { useEffect, useState } from 'react';
import { MessageCircleIcon } from '../../shell/components/icons';
import { useContractCommunicationsData } from './useContractCommunicationsData';

const time = value => new Intl.DateTimeFormat('es-DO', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export default function ContractCommunicationsPage() {
  const data = useContractCommunicationsData();
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState('');
  const selected = data.data.find(conversation => conversation.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && data.data.length) setSelectedId(data.data[0].id);
  }, [data.data, selectedId]);

  async function selectConversation(conversation) {
    setSelectedId(conversation.id);
    if (conversation.unreadCount) await data.markRead(conversation.id);
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    await data.sendMessage(selected.id, draft);
    setDraft('');
  }

  if (data.status === 'error') return <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card"><p className="font-semibold text-status-danger">No se pudieron cargar las comunicaciones.</p><button type="button" onClick={data.retry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button></div>;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión contractual</p><h1 className="mt-1 text-2xl font-bold">Comunicaciones</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Mensajes vinculados con contratos, servicios y solicitudes.</p></header>
      <section className="grid min-h-[620px] overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm dark:border-white/5 dark:bg-surface-dark-card lg:grid-cols-[340px_1fr]">
        <aside className="border-b border-black/5 lg:border-b-0 lg:border-r dark:border-white/5"><div className="p-4"><label><span className="sr-only">Buscar conversación</span><input type="search" value={data.query} onChange={event => data.setQuery(event.target.value)} placeholder="Buscar persona o contexto…" className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm dark:border-white/10 dark:bg-surface-dark" /></label></div><div className="max-h-[300px] overflow-y-auto lg:max-h-[550px]">{data.status === 'loading' ? <div className="m-4 h-40 animate-pulse rounded-xl bg-black/[0.03]" /> : data.conversations.map(conversation => <button type="button" key={conversation.id} onClick={() => selectConversation(conversation)} className={`flex w-full items-start gap-3 border-t border-black/5 px-4 py-4 text-left dark:border-white/5 ${selectedId === conversation.id ? 'bg-accent-600/10' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-600/10 text-accent-600"><MessageCircleIcon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{conversation.participant}</span>{conversation.unreadCount > 0 && <span className="rounded-full bg-signal-500 px-1.5 text-[10px] font-bold text-white">{conversation.unreadCount}</span>}</span><span className="mt-1 block truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{conversation.contextType}: {conversation.contextLabel}</span></span></button>)}</div></aside>
        <div className="flex min-h-[480px] flex-col">{selected ? <><header className="border-b border-black/5 px-5 py-4 dark:border-white/5"><h2 className="font-semibold">{selected.participant}</h2><p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{selected.contextType}: <span className="font-semibold text-accent-600">{selected.contextLabel}</span></p></header><div className="flex-1 space-y-3 overflow-y-auto bg-black/[0.015] p-5 dark:bg-white/[0.015]">{selected.messages.map(message => { const own = message.sender === 'Departamento de Contratos'; return <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm ${own ? 'rounded-br-md bg-accent-600 text-white' : 'rounded-bl-md border border-black/10 bg-white dark:border-white/10 dark:bg-surface-dark'}`}><p>{message.text}</p><p className={`mt-1 text-[10px] ${own ? 'text-white/70' : 'text-text-secondary-light'}`}>{time(message.sentAt)}</p></div></div>; })}</div><form onSubmit={submit} className="flex gap-3 border-t border-black/5 p-4 dark:border-white/5"><label className="flex-1"><span className="sr-only">Mensaje</span><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Escribe un mensaje…" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-surface-dark" /></label><button type="submit" disabled={!draft.trim()} className="rounded-xl bg-signal-500 px-5 text-sm font-semibold text-white disabled:opacity-50">Enviar</button></form></> : <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><MessageCircleIcon className="h-10 w-10 text-text-secondary-light/50" /><h2 className="mt-3 font-semibold">Selecciona una conversación</h2></div>}</div>
      </section>
    </div>
  );
}
