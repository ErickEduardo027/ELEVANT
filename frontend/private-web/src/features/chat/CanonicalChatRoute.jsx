import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from '../../components/AppLink';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import { selectOccStationScopes } from '../admin-occ/useOccStation';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { BUSINESS_TIME_ZONE } from '../../services/businessDay';
import { useChatPages } from './useChatPages';
import { markConversationRead, readConversations, readMessages, sendMessage } from './chatService';
import styles from './ChatWorkspace.module.css';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { useTranslation } from '../../i18n/LanguageScope';
import OccButton, { occButtonClass } from '../occ-ui/OccButton';
import OccEmptyState from '../occ-ui/OccEmptyState';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPanel, { OccRemoteView } from '../occ-ui/OccPanel';
import OccPlate from '../occ-ui/OccPlate';
import OccToolbar from '../occ-ui/OccToolbar';
import { formatClock } from '../occ-ui/occTime';
import { ChevronLeftIcon } from '../shell/components/icons';
import { chatMessages } from './chatMessages';
import useOperationPresence from './useOperationPresence';
import PresencePeople, { PresenceLegend } from './PresencePeople';
import PresenceStatusPicker from './PresenceStatusPicker';
import ChatComposerInput from './ChatComposerInput';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Template C of the design («Mesa de trabajo»): the toolbar with the page title and the own status, then the
// conversations and the open thread side by side from 1280 px, each scrolling on its own. Below that one shows at a
// time: the thread replaces the list once an operation is chosen, and «Volver» brings the list back.
const LAYOUT = 'grid min-h-0 min-w-0 flex-1 gap-3 [grid-template-rows:minmax(0,1fr)] '
  + 'xl:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)]';
// A panel's body fills the panel and lays its parts out as a column; the part that scrolls takes the rest.
const PANEL_FILL = 'absolute inset-0 flex flex-col';
// A conversation: a control the width of the list, 4 px radius. The open one is the selection: the soft cyan slab
// with a cyan joint and a cyan code. The presence ring under each dot takes the slab's colour.
const CONVERSATION = 'flex w-full min-w-0 flex-col gap-1 rounded border px-3 py-2 text-left';
const CONVERSATION_OPEN = 'border-occ-accent bg-occ-accent-soft [--presence-surface:var(--occ-accent-soft)]';
const CONVERSATION_REST = 'border-transparent hover:bg-occ-panel-raised hover:[--presence-surface:var(--occ-panel-raised)]';
// The count of unread messages on a neutral plate, as the rail counts them.
const UNREAD_PLATE = 'ml-auto inline-flex min-w-6 shrink-0 items-center justify-center rounded-sm bg-occ-panel-raised px-1 '
  + 'font-mono text-xs font-semibold tabular-nums text-occ-text';
// A refresh that failed while the data stays on screen: the amber slab of attention with its triangle.
const STALE_NOTICE = 'flex flex-wrap items-start gap-2 rounded-md border border-occ-line bg-occ-warn-soft px-3 py-2 text-sm text-occ-text';
const STATE_SLAB = 'rounded-md border border-occ-line bg-occ-panel p-3 text-sm text-occ-text';

const days = new Map();

/**
 * «13/11 10:42» in the station's time, on the 24-hour clock: a thread can span days, so each message says its day. Day
 * and month always take two digits (es-DO would write «1/9»).
 */
function formatInstant(value, locale) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  if (!days.has(locale)) {
    days.set(locale, new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: BUSINESS_TIME_ZONE }));
  }
  const day = days.get(locale).formatToParts(ms)
    .map(part => (part.type === 'day' || part.type === 'month' ? part.value.padStart(2, '0') : part.value)).join('');
  return `${day} ${formatClock(ms, locale, BUSINESS_TIME_ZONE)}`;
}

/** «Visto» once the other side's read cursor reaches the message (ADR-0029). */
export function isSeen(message, othersReadUpTo) {
  if (!othersReadUpTo) return false;
  const sent = Date.parse(message.sentAt);
  const read = Date.parse(othersReadUpTo);
  return Number.isFinite(sent) && Number.isFinite(read) && sent <= read;
}

/** A read that failed while its last data stays on screen: what failed, and «Reintentar». */
function StaleNotice({ text, retry, busy, onRetry }) {
  return (
    <div role="alert" className={STALE_NOTICE}>
      <OccGlyph name="attention" className="mt-0.5" />
      <p className="min-w-0 flex-1">{text}</p>
      <OccButton size="sm" disabled={busy} onClick={onRetry}>{retry}</OccButton>
    </div>
  );
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
  const lastMarked = useRef({});
  const updateCommand = (id, changes) => setCommands(value => ({ ...value, [id]: { ...value[id], ...changes } }));
  const setDraft = value => updateCommand(operationId, { draft: value });
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
  const newestId = messages.status === 'success' ? messages.items.at(-1)?.id : undefined;
  useEffect(() => {
    if (!operationId || !newestId || lastMarked.current[operationId] === newestId) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!atEnd.current) return;
    lastMarked.current[operationId] = newestId;
    markConversationRead(operationId, newestId)
      .then(() => { if (alive.current) void refreshFeeds.current?.conversations(); })
      .catch(() => { delete lastMarked.current[operationId]; });
  }, [operationId, newestId, unseen]);
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

  // The list's state in the names of OccRemoteView: a station with no conversation is its empty state.
  const listStatus = conversations.status === 'success' && conversations.items.length === 0 ? 'empty' : conversations.status;
  const openId = selectedOperation?.operationId;

  const conversationList = (
    <>
      {conversations.error && conversations.status === 'success' ? (
        <div className="p-3 pb-0">
          <StaleNotice text={t('conversationsError')} retry={t('retry')} busy={conversations.busy}
            onRetry={() => void conversations.refresh()} />
        </div>
      ) : null}
      <ul className="flex flex-col gap-1 p-2">{conversations.items.map(item => {
        const open = openId === item.operationId;
        return <li key={item.operationId}>
          <button type="button" onClick={() => selectConversation(item.operationId)} aria-current={open ? 'true' : undefined}
            className={`${CONVERSATION} ${open ? CONVERSATION_OPEN : CONVERSATION_REST}`}>
            <span className="flex w-full min-w-0 items-center gap-2">
              <strong className={`truncate font-mono text-sm font-semibold ${open ? 'text-occ-accent' : 'text-occ-text'}`}>{item.operationCode}</strong>
              <span className="shrink-0 font-mono text-xs text-occ-muted">{item.stationCode}</span>
              {item.unreadCount > 0 && !open && <span data-unread-badge aria-label={t('unread', { count: item.unreadCount })}
                className={UNREAD_PLATE}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}
            </span>
            {item.agentName && <span className="block w-full truncate text-xs text-occ-muted">{t('agent', { name: item.agentName })}</span>}
            <span className="block w-full truncate text-sm text-occ-text">{item.lastMessage?.content ?? t('noMessagesPreview', { airline: item.airlineName })}</span>
            <PresencePeople participants={presence[item.operationId]} compact />
          </button>
        </li>;
      })}</ul>
      {conversations.hasMore || conversations.noProgress ? (
        <div className="flex flex-col items-start gap-2 px-3 pb-3">
          {conversations.hasMore && <OccButton size="sm" disabled={conversations.busy} onClick={() => void conversations.loadMore()}>
            {t('loadConversations')}</OccButton>}
          {conversations.noProgress && <p role="status" className="text-xs text-occ-muted">{t('noProgress')}</p>}
        </div>
      ) : null}
    </>
  );

  const canSend = access?.can('operations.chat.create');
  const thread = selectedOperation ? <>
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-occ-line px-3 py-2">
      {selectedOperation.airlineName || selectedOperation.agentName ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
          {selectedOperation.airlineName && <span className="font-semibold text-occ-text">{selectedOperation.airlineName}</span>}
          {selectedOperation.agentName && <span className="text-xs text-occ-muted">{t('agent', { name: selectedOperation.agentName })}</span>}
        </p>
      ) : null}
      <PresencePeople participants={presence[operationId]} />
    </div>
    <div data-chat-scroll ref={history} className={styles.history} role="log" aria-label={t('messages')} aria-live="polite" onScroll={event => { const el = event.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (atEnd.current) setUnseen(false); }}>
      {messages.error && messages.status === 'success' && <StaleNotice text={t('messagesError')} retry={t('retry')}
        busy={messages.busy} onRetry={() => void messages.refresh()} />}
      {messages.hasMore && <div><OccButton size="sm" disabled={messages.busy} onClick={() => void loadOlder()}>{t('loadMessages')}</OccButton></div>}
      {messages.status === 'loading' ? <p className="text-sm text-occ-muted">{t('loadingMessages')}</p>
        : messages.status === 'error' ? <div role="alert" className="flex flex-col items-start gap-2"><p className="text-sm text-occ-text">{t('messagesError')}</p>
          <OccButton size="sm" onClick={() => void messages.refresh()}>{t('retry')}</OccButton></div>
          : messages.items.length === 0 ? <OccEmptyState title={t('noMessages')} className="m-auto text-center" />
            : messages.items.map(item => <article key={item.id} data-message-id={item.id} data-own={item.senderAccountId === session?.accountId} className={styles.message}>
              <p className={styles.messageMeta}>{item.senderName} · {item.senderRole === 'agent' ? t('roles.agent') : t('roles.occ')} · <time dateTime={item.sentAt}>{formatInstant(item.sentAt, locale)}</time></p>
              <p className={styles.messageBody}>{item.content}</p>
              {item.senderAccountId === session?.accountId && <p data-receipt className={styles.receipt}>{isSeen(item, messages.othersReadUpTo) ? t('seen') : t('delivered')}</p>}
            </article>)}
      {messages.noProgress && <p role="status" className="text-xs text-occ-muted">{t('noProgress')}</p>}
    </div>
    {unseen && <div className="shrink-0 px-3 pt-2"><OccButton size="sm" onClick={() => { atEnd.current = true; setUnseen(false); if (history.current) history.current.scrollTop = history.current.scrollHeight; }}>{t('newMessages')}</OccButton></div>}
    {canSend ? <form onSubmit={submit} className="flex shrink-0 flex-col gap-1.5 border-t border-occ-line p-3">
      <label htmlFor="occ-chat-draft" className="text-xs font-medium text-occ-muted">{t('message')}</label>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <ChatComposerInput id="occ-chat-draft" scope={operationId} value={pendingCommand?.content ?? draft} maxLength={2000} disabled={Boolean(pendingCommand)} onChange={event => setDraft(event.target.value)} />
        </div>
        <OccButton type="submit" variant="primary" className="h-11" busy={sending} busyLabel={t('sending')}
          disabled={messages.status !== 'success' || (!pendingCommand && !draft.trim())}>
          {pendingCommand ? t('retrySend') : t('send')}
        </OccButton>
      </div>
      {sendError && <p role="alert" className="flex items-start gap-1.5 text-sm text-occ-text"><OccGlyph name="attention" className="mt-0.5" /><span className="min-w-0">{sendError}{t('retryKeepsId')}</span></p>}
    </form> : <p className="shrink-0 border-t border-occ-line p-3 text-sm text-occ-muted">{t('readOnly')}</p>}
  </> : <OccEmptyState title={t('selectOperation')} className="m-auto p-3 text-center" />;

  return <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 text-occ-text">
    {/* The station is in the frame's status bar: no badge here, nor a line under the title (design E.1). */}
    <OccToolbar title={t('title')} actions={<PresenceStatusPicker />} />
    {!stationId ? <p role="status" className={STATE_SLAB}>{t('emptyScope')}</p> : (
      <div className={LAYOUT}>
        <OccPanel title={t('conversations')} className={openId ? 'hidden xl:flex' : ''} bodyClassName="relative"
          actions={<OccButton size="sm" variant="ghost" onClick={() => void conversations.refresh()}>{t('refresh')}</OccButton>}>
          <div className={PANEL_FILL}>
            {/* The legend of the presence shapes, on the panel's head (contratos 2.4). */}
            <div className="shrink-0 border-b border-occ-line px-3 py-2"><PresenceLegend /></div>
            <OccRemoteView status={listStatus} onRetry={() => void conversations.refresh()} className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              labels={{ loading: t('loadingConversations'), error: t('conversationsError'), retry: t('retry'), empty: t('noConversations') }}>
              {conversationList}
            </OccRemoteView>
          </div>
        </OccPanel>
        <div className={`min-h-0 min-w-0 flex-col gap-2 ${openId ? 'flex' : 'hidden xl:flex'}`}>
          {openId ? (
            <div className="xl:hidden">
              <OccButton size="sm" variant="ghost" aria-label={t('back')} onClick={() => { setParams({}); }}>
                <ChevronLeftIcon className="h-4 w-4" />{t('conversations')}
              </OccButton>
            </div>
          ) : null}
          <OccPanel title={t('messages')} className="min-h-0 flex-1" bodyClassName="relative"
            meta={selectedOperation ? <OccPlate kind="code">{selectedOperation.operationCode}</OccPlate> : null}
            actions={selectedOperation && access?.can('operations.review.read') ? <Link className={occButtonClass({ variant: 'ghost', size: 'sm' })} to={`/admin-occ/review?operationId=${selectedOperation.operationId}`}>{t('viewOperation')}</Link> : null}>
            <div className={PANEL_FILL}>{thread}</div>
          </OccPanel>
        </div>
      </div>
    )}
  </section>;
}

export default function CanonicalChatRoute() { const { session } = useAuth(); return <ChatWorkspace key={session?.token ?? session?.accountId ?? "anonymous"} />; }
