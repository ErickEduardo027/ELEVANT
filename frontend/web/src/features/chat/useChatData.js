import { useCallback, useEffect, useState } from 'react';
import {
  closeConversation,
  createConversation,
  getConversations,
  getMessages,
  markConversationAsRead,
  sendMessage,
  subscribeToConversationUpdates,
} from '../../services/chatService';

async function loadAllMessages(conversations) {
  const entries = await Promise.all(
    conversations.map(async conversation => [conversation.id, (await getMessages(conversation.id)).messages])
  );
  return Object.fromEntries(entries);
}

export function useChatData(stationCode = 'PUJ', refreshToken = 0, forceDisconnected = false) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [connection, setConnection] = useState('syncing');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const load = useCallback(() => {
    setState({ status: 'loading', data: null, error: null });
    setConnection('syncing');

    return getConversations(stationCode)
      .then(async snapshot => {
        const messagesByConversationId = await loadAllMessages(snapshot.conversations);
        setState({ status: 'success', data: { ...snapshot, messagesByConversationId }, error: null });
        setConnection('connected');
        setLastUpdatedAt(new Date().toISOString());
      })
      .catch(error => {
        setState({ status: 'error', data: null, error });
        setConnection('disconnected');
      });
  }, [stationCode]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (state.status !== 'success' || forceDisconnected) return undefined;

    const unsubscribe = subscribeToConversationUpdates(({ conversationId, message }) => {
      setState(current => {
        if (!current.data) return current;
        const currentMessages = current.data.messagesByConversationId[conversationId] ?? [];
        if (currentMessages.some(item => item.id === message.id)) return current;
        const conversations = current.data.conversations.map(conversation =>
          conversation.id === conversationId
            ? { ...conversation, lastMessage: message.content, lastMessageAt: message.createdAt, unreadCount: conversation.unreadCount + 1 }
            : conversation
        );
        const messagesByConversationId = {
          ...current.data.messagesByConversationId,
          [conversationId]: [...currentMessages, message],
        };
        return { ...current, data: { ...current.data, conversations, messagesByConversationId } };
      });
      setLastUpdatedAt(new Date().toISOString());
    });

    return unsubscribe;
  }, [state.status, forceDisconnected]);

  function patchConversation(conversationId, updates) {
    setState(current =>
      current.data
        ? {
            ...current,
            data: {
              ...current.data,
              conversations: current.data.conversations.map(conversation =>
                conversation.id === conversationId ? { ...conversation, ...updates } : conversation
              ),
            },
          }
        : current
    );
  }

  function appendMessage(conversationId, message) {
    setState(current =>
      current.data
        ? {
            ...current,
            data: {
              ...current.data,
              messagesByConversationId: {
                ...current.data.messagesByConversationId,
                [conversationId]: [...(current.data.messagesByConversationId[conversationId] ?? []), message],
              },
            },
          }
        : current
    );
  }

  const sendConversationMessage = useCallback(async (conversationId, content, attachments = []) => {
    const message = await sendMessage(conversationId, content, attachments);
    appendMessage(conversationId, message);
    patchConversation(conversationId, { lastMessage: message.content, lastMessageAt: message.createdAt });
    return message;
  }, []);

  const markAsRead = useCallback(async conversationId => {
    const updated = await markConversationAsRead(conversationId);
    setState(current =>
      current.data
        ? {
            ...current,
            data: {
              ...current.data,
              conversations: current.data.conversations.map(conversation => (conversation.id === conversationId ? updated : conversation)),
              messagesByConversationId: {
                ...current.data.messagesByConversationId,
                [conversationId]: (current.data.messagesByConversationId[conversationId] ?? []).map(message =>
                  message.senderRole === 'agent' && !message.readAt ? { ...message, readAt: new Date().toISOString() } : message
                ),
              },
            },
          }
        : current
    );
    return updated;
  }, []);

  const closeConversationById = useCallback(async conversationId => {
    const { conversation, message } = await closeConversation(conversationId);
    patchConversation(conversationId, conversation);
    appendMessage(conversationId, message);
    return conversation;
  }, []);

  const createNewConversation = useCallback(async payload => {
    const conversation = await createConversation(payload);
    const { messages } = await getMessages(conversation.id);
    setState(current =>
      current.data
        ? {
            ...current,
            data: {
              ...current.data,
              conversations: [conversation, ...current.data.conversations],
              messagesByConversationId: { ...current.data.messagesByConversationId, [conversation.id]: messages },
            },
          }
        : current
    );
    return conversation;
  }, []);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    connection,
    lastUpdatedAt,
    refresh: load,
    sendMessage: sendConversationMessage,
    markAsRead,
    closeConversation: closeConversationById,
    createConversation: createNewConversation,
  };
}
