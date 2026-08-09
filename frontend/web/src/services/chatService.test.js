import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetChatStoreForTests,
  closeConversation,
  createConversation,
  getAvailableFlightsForNewConversation,
  getConversations,
  getMessages,
  markConversationAsRead,
  sendMessage,
  subscribeToConversationUpdates,
} from './chatService';

afterEach(() => {
  __resetChatStoreForTests();
  vi.useRealTimers();
});

describe('getConversations', () => {
  it('resolves with a station and conversations shaped like the documented contract', async () => {
    const snapshot = await getConversations();
    expect(snapshot).toEqual(
      expect.objectContaining({ station: expect.objectContaining({ code: 'PUJ' }), conversations: expect.any(Array) })
    );
    expect(snapshot.conversations.length).toBeGreaterThanOrEqual(6);
    for (const conversation of snapshot.conversations) {
      expect(conversation).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          flightNumber: expect.any(String),
          airline: expect.any(String),
          agentName: expect.any(String),
          status: expect.stringMatching(/^(active|pending|closed)$/),
          unreadCount: expect.any(Number),
        })
      );
    }
  });

  it('covers active, pending and closed conversations, with and without unread messages', async () => {
    const { conversations } = await getConversations();
    expect(new Set(conversations.map(c => c.status))).toEqual(new Set(['active', 'pending', 'closed']));
    expect(conversations.some(c => c.unreadCount > 0)).toBe(true);
    expect(conversations.some(c => c.unreadCount === 0)).toBe(true);
  });

  it('derives lastMessage/lastMessageAt from the most recent message in the thread', async () => {
    const { conversations } = await getConversations();
    const conversation = conversations.find(c => c.id === 'CHAT-4001');
    expect(conversation.lastMessage).toBe('¿Podemos usar la banda 5 en su lugar?');
    expect(conversation.unreadCount).toBe(2);
  });
});

describe('getMessages', () => {
  it('resolves the message thread for a conversation, oldest first', async () => {
    const { messages } = await getMessages('CHAT-4001');
    expect(messages.length).toBeGreaterThan(0);
    const timestamps = messages.map(m => new Date(m.createdAt).getTime());
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it('includes both system events and agent/occ messages', async () => {
    const { messages } = await getMessages('CHAT-4001');
    expect(messages.some(m => m.type === 'system')).toBe(true);
    expect(messages.some(m => m.senderRole === 'agent')).toBe(true);
    expect(messages.some(m => m.senderRole === 'occ')).toBe(true);
  });

  it('rejects for an unknown conversation id', async () => {
    await expect(getMessages('CHAT-9999')).rejects.toThrow();
  });
});

describe('sendMessage', () => {
  it('appends a message sent by OCC and persists it in the thread', async () => {
    const message = await sendMessage('CHAT-4002', 'Recibido, gracias.');
    expect(message).toEqual(
      expect.objectContaining({ conversationId: 'CHAT-4002', senderRole: 'occ', content: 'Recibido, gracias.', status: 'sent' })
    );

    const { messages } = await getMessages('CHAT-4002');
    expect(messages.at(-1).id).toBe(message.id);
  });

  it('updates the conversation lastMessage/lastMessageAt', async () => {
    await sendMessage('CHAT-4002', 'Un mensaje nuevo.');
    const { conversations } = await getConversations();
    expect(conversations.find(c => c.id === 'CHAT-4002').lastMessage).toBe('Un mensaje nuevo.');
  });
});

describe('markConversationAsRead', () => {
  it('clears unreadCount by marking pending agent messages as read', async () => {
    const before = (await getConversations()).conversations.find(c => c.id === 'CHAT-4001');
    expect(before.unreadCount).toBeGreaterThan(0);

    const updated = await markConversationAsRead('CHAT-4001');
    expect(updated.unreadCount).toBe(0);

    const after = (await getConversations()).conversations.find(c => c.id === 'CHAT-4001');
    expect(after.unreadCount).toBe(0);
  });
});

describe('closeConversation', () => {
  it('flips status to closed and appends a system event', async () => {
    const { conversation, message } = await closeConversation('CHAT-4001');
    expect(conversation.status).toBe('closed');
    expect(message).toEqual(expect.objectContaining({ type: 'system', content: expect.stringContaining('cerrada') }));

    const { messages } = await getMessages('CHAT-4001');
    expect(messages.at(-1).id).toBe(message.id);
  });
});

describe('getAvailableFlightsForNewConversation / createConversation', () => {
  it('lists flights that do not already have an open conversation', async () => {
    const flights = await getAvailableFlightsForNewConversation();
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.every(flight => flight.flightNumber)).toBe(true);
  });

  it('creates a new active conversation seeded with an assignment system event, and removes the flight from availability', async () => {
    const [flight] = await getAvailableFlightsForNewConversation();
    const conversation = await createConversation(flight);

    expect(conversation).toEqual(
      expect.objectContaining({
        flightId: flight.flightId,
        flightNumber: flight.flightNumber,
        operationId: flight.operationId,
        agentId: flight.agentId,
        status: 'active',
        unreadCount: 0,
      })
    );

    const { messages } = await getMessages(conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('system');

    const stillAvailable = await getAvailableFlightsForNewConversation();
    expect(stillAvailable.some(f => f.flightId === flight.flightId)).toBe(false);
  });

  it('rejects when the flight/operation/agent combination is not a valid available option', async () => {
    await expect(createConversation({ flightId: 999, operationId: 'REV-0000', agentId: 1 })).rejects.toThrow();
  });
});

describe('subscribeToConversationUpdates', () => {
  it('emits a simulated agent message for an open conversation on each tick, and stops after unsubscribe', () => {
    vi.useFakeTimers();
    const onIncomingMessage = vi.fn();
    const unsubscribe = subscribeToConversationUpdates(onIncomingMessage);

    vi.advanceTimersByTime(25000);
    expect(onIncomingMessage).toHaveBeenCalledTimes(1);
    const [payload] = onIncomingMessage.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({ conversationId: expect.any(String), message: expect.objectContaining({ senderRole: 'agent' }) })
    );

    unsubscribe();
    vi.advanceTimersByTime(50000);
    expect(onIncomingMessage).toHaveBeenCalledTimes(1);
  });

  it('never targets a closed conversation', async () => {
    vi.useFakeTimers();
    await closeConversation('CHAT-4004');

    const onIncomingMessage = vi.fn();
    subscribeToConversationUpdates(onIncomingMessage);
    vi.advanceTimersByTime(25000 * 6);

    expect(onIncomingMessage.mock.calls.every(([payload]) => payload.conversationId !== 'CHAT-4004')).toBe(true);
  });
});

describe('__resetChatStoreForTests', () => {
  it('restores conversations, messages and availability to their initial state', async () => {
    await sendMessage('CHAT-4001', 'temporal');
    await closeConversation('CHAT-4002');
    const [flight] = await getAvailableFlightsForNewConversation();
    await createConversation(flight);

    __resetChatStoreForTests();

    const { conversations } = await getConversations();
    expect(conversations).toHaveLength(6);
    expect(conversations.find(c => c.id === 'CHAT-4002').status).toBe('pending');
    const { messages } = await getMessages('CHAT-4001');
    expect(messages.some(m => m.content === 'temporal')).toBe(false);
  });
});
