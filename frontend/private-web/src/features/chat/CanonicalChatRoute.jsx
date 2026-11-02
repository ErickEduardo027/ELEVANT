import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from '../../components/AppLink';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import { OccStationBadge } from '../admin-occ/OccQueueState';
import { selectOccStationScopes } from '../admin-occ/useOccStation';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { useChatPages } from './useChatPages';
import { readConversations, readMessages, sendMessage } from './chatService';
import styles from './ChatWorkspace.module.css';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { useTranslation } from '../../i18n/LanguageScope';
import { chatMessages } from './chatMessages';
import useOperationPresence from './useOperationPresence';
import PresencePeople from './PresencePeople';
import PresenceStatusPicker from './PresenceStatusPicker';
import ChatComposerInput from './ChatComposerInput';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatInstant(value, locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale);
}

function ChatWorkspace() {
  const access = useOptionalDepartmentAccess();
  const { t, locale } = useTranslation(chatMessages);
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const stationScopes = useMemo(() => selectOccStationScopes(session?.stationScopes)
    .filter(scope => UUID.test(scope.stationId)), [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const conversations = useChatPages(stationId, readConversations);
  const requestedOperation = params.get('operationId');
  const operationId = UUID.test(requestedOperation ?? '') ? requestedOperation.toLowerCase() : '';
  const selectedOperation = conversations.items.find(item => item.operationId === operationId) ?? (operationId ? { operationId, operationCode: operationId } : null);
  const presence = useOperationPresence([...conversations.items.map(item => item.operationId), operationId]);
  const messages = useChatPages(stationId ? operationId : '', readMessages, { messages: true, interval: 10_000 });
  const [commands, setCommands] = useState({});
  const commandState = commands[operationId] ?? {};
  const draft = commandState.draft ?? '';
  const pendingCommand = commandState.command;
  const sending = commandState.sending ?? false;
  const sendError = commandState.error ? t('sendError') : '';
  const pending = useRef(new Set());
  const alive = useRef(true);
  const history = useRef(null);
  const anchor = useRef(null);
  const atEnd = useRef(true);
  const lastTail = useRef(null);
  const [unseen, setUnseen] = useState(false);
  const refreshFeeds = useRef(null);
  const updateCommand = (id, changes) => setCommands(value => ({ ...value, [id]: { ...value[id], ...changes } }));
  const setDraft = value => updateCommand(operationId, { draft: value });
  const setListRevision = () => { void conversations.refresh(); };
  const setMessageRevision = () => { void messages.refresh(); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { refreshFeeds.current = { conversations: conversations.refresh, messages: messages.refresh }; }, [conversations.refresh, messages.refresh]);
  useEffect(() => {
    if (!stationScopes.some(scope => scope.stationId === stationId)) setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);
  useEffect(() => {
    if (!UUID.test(session?.accountId ?? '')) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('operation_messages')) { void refreshFeeds.current?.conversations(); void refreshFeeds.current?.messages(); }
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [session?.accountId]);
  useLayoutEffect(() => {
    const element = history.current;
    if (!element) return;
    if (anchor.current?.operationId === operationId) {
      element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (atEnd.current) element.scrollTop = element.scrollHeight;
    else if (lastTail.current !== messages.items.at(-1)?.id) setUnseen(true);
    lastTail.current = messages.items.at(-1)?.id;
  }, [messages.items, operationId]);
  const loadOlder = async () => {
    const element = history.current;
    if (element) anchor.current = { operationId, height: element.scrollHeight, top: element.scrollTop };
    if (!await messages.loadMore()) anchor.current = null;
  };
  const selectConversation = id => { atEnd.current = true; anchor.current = null; setUnseen(false); setParams({ operationId: id }); };
  const submit = async event => {
    event.preventDefault();
    if (!operationId || pending.current.has(operationId) || messages.status !== 'success') return;
    const command = pendingCommand ?? { operationId, content: draft.trim(), key: crypto.randomUUID() };
    if (!command.content || command.content.length > 2000) return;
    const id = operationId;
    pending.current.add(id);
    updateCommand(id, { command, sending: true, error: false });
    try {
      const result = await sendMessage(id, command.content, command.key);
      if (!alive.current) return;
      updateCommand(id, { command: null, draft: '', sending: false, error: false });
      if (result?.id) messages.append(result);
      void messages.refresh(); void conversations.refresh();
    } catch { if (alive.current) updateCommand(id, { sending: false, error: true }); }
    finally { pending.current.delete(id); }
  };

  return <section className={styles.workspace}>
    <header data-occ-header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/80 p-5 dark:border-white/10 dark:bg-surface-dark-card">
      <div><h1 className="text-xl font-semibold">{t('title')}</h1><p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('subtitle')}</p></div>
      <div className="flex flex-wrap items-center gap-2"><PresenceStatusPicker /><OccStationBadge /></div>
    </header>
    {!stationId ? <p role="status">{t('emptyScope')}</p> :
      conversations.status === 'loading' ? <p role="status">{t('loadingConversations')}</p> :
        conversations.status === 'error' ? <div role="alert"><p>{t('conversationsError')}</p><button type="button" onClick={() => setListRevision(value => value + 1)}>{t('retry')}</button></div> :
          <div data-occ-chat-layout className={styles.layout}>
            <section data-occ-surface aria-label={t('conversations')} className={`min-w-0 rounded-2xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-surface-dark-card ${selectedOperation ? 'hidden lg:block' : ''}`}>
              <div className="mb-3 flex items-center justify-between gap-2 px-2"><h2 className="font-semibold">{t('operations')}</h2><button type="button" onClick={() => setListRevision(value => value + 1)} className="min-h-11 rounded-lg px-3 text-sm text-accent-600">{t('refresh')}</button></div>
              {conversations.error && <div role="alert"><p>{t('conversationsError')}</p><button type="button" disabled={conversations.busy} onClick={() => void conversations.refresh()}>{t('retry')}</button></div>}{conversations.items.length === 0 ? <p className="p-3 text-sm">{t('noConversations')}</p> :
                <ul className="space-y-1">{conversations.items.map(item => <li key={item.operationId}><button type="button" onClick={() => selectConversation(item.operationId)} aria-current={selectedOperation?.operationId === item.operationId ? 'true' : undefined} className="min-h-14 w-full rounded-lg border border-transparent p-3 text-left hover:border-accent-600/40 aria-[current=true]:bg-accent-600/10"><strong>{item.operationCode}</strong><span className="ml-2 text-xs">{item.stationCode}</span><p className="truncate text-sm">{item.lastMessage?.content ?? t('noMessagesPreview', { airline: item.airlineName })}</p><PresencePeople participants={presence[item.operationId]} compact /></button></li>)}</ul>}
              {conversations.hasMore && <button type="button" disabled={conversations.busy} onClick={() => void conversations.loadMore()}>{t('loadConversations')}</button>}{conversations.noProgress && <p role="status">{t('noProgress')}</p>}
            </section>
            <section data-occ-surface aria-label={t('messages')} className={`min-w-0 flex-col rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-surface-dark-card ${selectedOperation ? 'flex' : 'hidden lg:flex'}`}>
              {!selectedOperation ? <p className="m-auto text-sm">{t('selectOperation')}</p> : <>
                <div className="flex items-center justify-between gap-2 border-b border-black/10 pb-3"><div className="flex min-w-0 items-center gap-2"><button type="button" onClick={() => { setParams({}); }} aria-label={t('back')} className="-ml-1 rounded-lg px-2 py-1 text-lg leading-none text-accent-600 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5 lg:hidden">←</button><div className="min-w-0"><h2 className="truncate font-semibold">{selectedOperation.operationCode}</h2><p className="truncate text-xs">{selectedOperation.airlineName}{selectedOperation.agentName ? ` · ${selectedOperation.agentName}` : ''}</p></div></div>{access?.can('operations.review.read') && <Link className="shrink-0 text-sm text-accent-600" to={`/admin-occ/review?operationId=${selectedOperation.operationId}`}>{t('viewOperation')}</Link>}</div>
                <PresencePeople participants={presence[operationId]} />
                <div data-chat-scroll ref={history} className={styles.history} role="log" aria-label={t('messages')} aria-live="polite" onScroll={event => { const el = event.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (atEnd.current) setUnseen(false); }}>{messages.error && messages.status === 'success' && <div role="alert"><p>{t('messagesError')}</p><button type="button" disabled={messages.busy} onClick={() => void messages.refresh()}>{t('retry')}</button></div>}{messages.hasMore && <button type="button" disabled={messages.busy} onClick={() => void loadOlder()}>{t('loadMessages')}</button>}{messages.status === 'loading' ? <p>{t('loadingMessages')}</p> : messages.status === 'error' ? <div role="alert"><p>{t('messagesError')}</p><button type="button" onClick={() => setMessageRevision(value => value + 1)}>{t('retry')}</button></div> : messages.items.length === 0 ? <p>{t('noMessages')}</p> : messages.items.map(item => <article key={item.id} data-message-id={item.id} data-own={item.senderAccountId === session?.accountId} className="rounded-xl border border-black/10 p-3 dark:border-white/10"><p className="text-xs font-semibold">{item.senderName} · {item.senderRole === 'agent' ? t('roles.agent') : t('roles.occ')} · <time dateTime={item.sentAt}>{formatInstant(item.sentAt, locale)}</time></p><p className="whitespace-pre-wrap break-words text-sm">{item.content}</p></article>)}{messages.noProgress && <p role="status">{t('noProgress')}</p>}</div>
                {unseen && <button type="button" onClick={() => { atEnd.current = true; setUnseen(false); if (history.current) history.current.scrollTop = history.current.scrollHeight; }}>{t('newMessages')}</button>}{access?.can('operations.chat.create') ? <form onSubmit={submit} className="space-y-2 border-t border-black/10 pt-3"><label htmlFor="occ-chat-draft" className="text-sm font-semibold">{t('message')}</label><ChatComposerInput id="occ-chat-draft" scope={operationId} value={pendingCommand?.content ?? draft} maxLength={2000} disabled={Boolean(pendingCommand)} onChange={event => setDraft(event.target.value)} />{sendError && <p role="alert" className="text-sm text-status-danger">{sendError}{t('retryKeepsId')}</p>}<button type="submit" disabled={messages.status !== 'success' || sending || (!pendingCommand && !draft.trim())} className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{sending ? t('sending') : pendingCommand ? t('retrySend') : t('send')}</button></form> : <p>{t('readOnly')}</p>}
              </>}
            </section>
          </div>}
  </section>;
}

export default function CanonicalChatRoute() { const { session } = useAuth(); return <ChatWorkspace key={session?.token ?? session?.accountId ?? "anonymous"} />; }
