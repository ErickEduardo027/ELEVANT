import { useEffect, useState } from 'react';
import { useIsTabletBreakpoint } from '../flight-monitoring/useIsTabletBreakpoint';
import { useReviewToasts } from '../review/useReviewToasts';
import ReviewToastStack from '../review/components/ReviewToast';
import { getAvailableFlightsForNewConversation } from '../../services/chatService';
import { useChatFilters } from './useChatFilters';
import ConversationSearch from './components/ConversationSearch';
import ConversationFilters from './components/ConversationFilters';
import ConversationList from './components/ConversationList';
import ChatHeader from './components/ChatHeader';
import OperationContext from './components/OperationContext';
import MessageList from './components/MessageList';
import MessageComposer from './components/MessageComposer';
import NewConversationDrawer from './components/NewConversationDrawer';
import ChatEmptyState from './components/ChatEmptyState';
import ChatSkeleton from './components/ChatSkeleton';
import { PlusIcon } from '../planning/components/icons';

const PANEL_CLASS =
  'flex flex-col rounded-2xl border border-black/5 bg-white/70 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card';

export default function ChatPage({
  status,
  data,
  error,
  connection = 'connected',
  onRetry,
  onSendMessage,
  onMarkAsRead,
  onCloseConversation,
  onCreateConversation,
  onNavigateToResource,
  forceState = 'default',
}) {
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [availableFlights, setAvailableFlights] = useState([]);
  const isTablet = useIsTabletBreakpoint();
  const { toasts, pushToast, dismissToast } = useReviewToasts();

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'chatError';
  const conversations = forceState === 'chatEmpty' ? [] : data?.conversations ?? [];
  const messagesByConversationId = data?.messagesByConversationId ?? {};
  const displayConnection = forceState === 'chatDisconnected' ? 'disconnected' : connection;

  const { search, setSearch, activeChip, setActiveChip, hasActiveFilters, filteredConversations, counts } =
    useChatFilters(conversations);

  const selectedConversation = conversations.find(conversation => conversation.id === selectedConversationId) ?? null;
  const selectedMessages = selectedConversationId ? messagesByConversationId[selectedConversationId] ?? [] : [];

  useEffect(() => {
    if (!newConversationOpen) return;
    getAvailableFlightsForNewConversation().then(setAvailableFlights);
  }, [newConversationOpen]);

  useEffect(() => {
    if (!selectedConversation || selectedConversation.unreadCount === 0) return;
    onMarkAsRead(selectedConversation.id);
    // Se re-ejecuta también cuando llega un mensaje nuevo mientras la conversación está abierta,
    // para que nunca quede marcada como no leída si el OCC ya la está viendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation?.id, selectedConversation?.unreadCount]);

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No se pudo cargar el chat interno.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  function handleSelectConversation(id) {
    setSelectedConversationId(id);
  }

  async function handleSend(content, attachments) {
    try {
      await onSendMessage(selectedConversationId, content, attachments);
    } catch {
      pushToast('No se pudo enviar el mensaje.', 'error');
    }
  }

  async function handleCreateConversation(option) {
    try {
      const conversation = await onCreateConversation({
        flightId: option.flightId,
        operationId: option.operationId,
        agentId: option.agentId,
      });
      setNewConversationOpen(false);
      setSelectedConversationId(conversation.id);
      pushToast('Conversación iniciada.', 'success');
    } catch {
      pushToast('No se pudo iniciar la conversación.', 'error');
    }
  }

  async function handleCloseConversation() {
    try {
      await onCloseConversation(selectedConversationId);
      pushToast('Conversación marcada como cerrada.', 'success');
    } catch {
      pushToast('No se pudo cerrar la conversación.', 'error');
    }
  }

  const listPanel = (
    <div className={`${PANEL_CLASS} h-full w-full gap-3 p-3 lg:w-[340px] lg:shrink-0`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">Chat interno</h1>
        <button
          type="button"
          onClick={() => setNewConversationOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Nueva conversación
        </button>
      </div>

      <ConversationSearch value={search} onChange={setSearch} />
      <ConversationFilters active={activeChip} onChange={setActiveChip} counts={counts} />

      {conversations.length === 0 ? (
        <ChatEmptyState variant="no-conversations" />
      ) : (
        <ConversationList
          conversations={filteredConversations}
          selectedId={selectedConversationId}
          onSelect={handleSelectConversation}
          emptyMessage={hasActiveFilters ? 'No se encontraron conversaciones' : 'No hay conversaciones disponibles'}
        />
      )}
    </div>
  );

  const chatPanel = (
    <div className={`${PANEL_CLASS} h-full flex-1`}>
      {selectedConversation ? (
        <>
          <ChatHeader
            conversation={selectedConversation}
            showBack={isTablet}
            onBack={() => setSelectedConversationId(null)}
            onViewFlight={flightId => onNavigateToResource('flight-monitoring', flightId)}
            onViewOperation={operationId => onNavigateToResource('approvals', operationId)}
          />
          <OperationContext conversation={selectedConversation} />

          {displayConnection === 'disconnected' && (
            <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              <span>No se pudo actualizar la conversación.</span>
              <button type="button" onClick={onRetry} className="font-semibold underline">
                Reintentar
              </button>
            </div>
          )}

          <MessageList messages={selectedMessages} nowIso={new Date().toISOString()} />

          {selectedConversation.status !== 'closed' && (
            <div className="flex justify-end border-t border-black/5 px-4 py-1.5 dark:border-white/5">
              <button
                type="button"
                onClick={handleCloseConversation}
                className="text-[11px] font-medium text-text-secondary-light hover:text-status-danger dark:text-text-secondary-dark"
              >
                Marcar como cerrada
              </button>
            </div>
          )}

          <MessageComposer onSend={handleSend} disabled={selectedConversation.status === 'closed'} />
        </>
      ) : (
        <ChatEmptyState variant="no-selection" />
      )}
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] max-w-[1440px] flex-col gap-4">
      {isLoading ? (
        <ChatSkeleton />
      ) : isTablet ? (
        selectedConversation ? chatPanel : listPanel
      ) : (
        <div className="flex h-full gap-4">
          {listPanel}
          {chatPanel}
        </div>
      )}

      <NewConversationDrawer
        open={newConversationOpen}
        options={availableFlights}
        onCreate={handleCreateConversation}
        onClose={() => setNewConversationOpen(false)}
      />

      <ReviewToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
