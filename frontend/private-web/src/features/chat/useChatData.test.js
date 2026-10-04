import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatData } from './useChatData';
import * as chatService from '../../services/chatService';
import { __resetChatStoreForTests } from '../../services/chatService';

afterEach(() => {
  vi.restoreAllMocks();
  __resetChatStoreForTests();
});

describe('useChatData', () => {
  it('starts in loading/syncing state then resolves to success/connected with conversations and preloaded messages', async () => {
    const { result } = renderHook(() => useChatData());
    expect(result.current.status).toBe('loading');
    expect(result.current.connection).toBe('syncing');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data.conversations.length).toBeGreaterThan(0);
    expect(result.current.connection).toBe('connected');
    expect(result.current.lastUpdatedAt).not.toBeNull();

    const firstId = result.current.data.conversations[0].id;
    expect(result.current.data.messagesByConversationId[firstId].length).toBeGreaterThan(0);
  });

  it('exposes an error state when the service rejects', async () => {
    vi.spyOn(chatService, 'getConversations').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useChatData());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error.message).toBe('network down');
    expect(result.current.connection).toBe('disconnected');
  });

  it('reloads when refreshToken changes', async () => {
    const spy = vi.spyOn(chatService, 'getConversations');
    const { rerender } = renderHook(({ token }) => useChatData('PUJ', token), { initialProps: { token: 0 } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('sendMessage appends the message to the thread and updates the conversation preview', async () => {
    const { result } = renderHook(() => useChatData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.sendMessage('CHAT-4002', 'Un mensaje de prueba.');
    });

    expect(result.current.data.messagesByConversationId['CHAT-4002'].at(-1).content).toBe('Un mensaje de prueba.');
    expect(result.current.data.conversations.find(c => c.id === 'CHAT-4002').lastMessage).toBe('Un mensaje de prueba.');
  });

  it('markAsRead zeroes the unread count and clears readAt gaps on agent messages', async () => {
    const { result } = renderHook(() => useChatData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data.conversations.find(c => c.id === 'CHAT-4001').unreadCount).toBeGreaterThan(0);

    await act(async () => {
      await result.current.markAsRead('CHAT-4001');
    });

    expect(result.current.data.conversations.find(c => c.id === 'CHAT-4001').unreadCount).toBe(0);
    expect(result.current.data.messagesByConversationId['CHAT-4001'].every(m => m.senderRole !== 'agent' || m.readAt)).toBe(true);
  });

  it('closeConversation flips status to closed and appends the system event to the thread', async () => {
    const { result } = renderHook(() => useChatData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.closeConversation('CHAT-4001');
    });

    expect(result.current.data.conversations.find(c => c.id === 'CHAT-4001').status).toBe('closed');
    expect(result.current.data.messagesByConversationId['CHAT-4001'].at(-1).type).toBe('system');
  });

  it('createConversation prepends the new conversation and seeds its message thread', async () => {
    const { result } = renderHook(() => useChatData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    const countBefore = result.current.data.conversations.length;

    let created;
    await act(async () => {
      created = await result.current.createConversation({ flightId: 6, operationId: 'REV-1004', agentId: 12 });
    });

    expect(result.current.data.conversations).toHaveLength(countBefore + 1);
    expect(result.current.data.conversations[0].id).toBe(created.id);
    expect(result.current.data.messagesByConversationId[created.id]).toHaveLength(1);
  });

  it('applies an incoming realtime message to the matching conversation and bumps unreadCount', async () => {
    let emitUpdate;
    vi.spyOn(chatService, 'subscribeToConversationUpdates').mockImplementation(onIncomingMessage => {
      emitUpdate = onIncomingMessage;
      return () => {};
    });

    const { result } = renderHook(() => useChatData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    const unreadBefore = result.current.data.conversations.find(c => c.id === 'CHAT-4003').unreadCount;

    act(() =>
      emitUpdate({
        conversationId: 'CHAT-4003',
        message: { id: 'MSG-SIM-1', conversationId: 'CHAT-4003', type: 'message', senderRole: 'agent', content: 'Novedad simulada.', createdAt: new Date().toISOString() },
      })
    );

    await waitFor(() => expect(result.current.data.conversations.find(c => c.id === 'CHAT-4003').unreadCount).toBe(unreadBefore + 1));
    expect(result.current.data.messagesByConversationId['CHAT-4003'].at(-1).content).toBe('Novedad simulada.');
  });

  it('does not subscribe to updates while forceDisconnected is true', async () => {
    const subscribeSpy = vi.spyOn(chatService, 'subscribeToConversationUpdates').mockReturnValue(() => {});
    const { result } = renderHook(() => useChatData('PUJ', 0, true));
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(subscribeSpy).not.toHaveBeenCalled();
  });
});