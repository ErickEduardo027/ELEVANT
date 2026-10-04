import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPage from './ChatPage';
import * as chatService from '../../services/chatService';

function makeConversation(overrides) {
  return {
    id: 'CHAT-4001',
    flightId: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    position: 'A5',
    operationId: 'REV-1001',
    agentId: 12,
    agentName: 'Carlos Medina',
    agentStatus: 'online',
    agentLastSeenAt: null,
    status: 'active',
    requiresAttention: true,
    lastMessage: '¿Podemos usar la banda 5 en su lugar?',
    lastMessageAt: new Date().toISOString(),
    unreadCount: 2,
    ...overrides,
  };
}

function makeMessage(overrides) {
  return {
    id: 'MSG-1',
    conversationId: 'CHAT-4001',
    type: 'message',
    senderRole: 'agent',
    senderName: 'Carlos Medina',
    content: 'Ya iniciamos el proceso de descarga.',
    createdAt: '2026-08-08T08:40:00-04:00',
    readAt: null,
    status: 'delivered',
    attachments: [],
    ...overrides,
  };
}

const CONVERSATIONS = [
  makeConversation({ id: 'CHAT-4001' }),
  makeConversation({
    id: 'CHAT-4002',
    flightNumber: 'AA904',
    airline: 'American Airlines',
    agentName: 'María Castillo',
    unreadCount: 0,
    requiresAttention: false,
    lastMessage: 'Recibido, lo revisamos en breve.',
  }),
];

const MESSAGES_BY_CONVERSATION_ID = {
  'CHAT-4001': [makeMessage()],
  'CHAT-4002': [makeMessage({ id: 'MSG-2', conversationId: 'CHAT-4002', senderRole: 'occ', content: 'Recibido, lo revisamos en breve.' })],
};

function renderPage(props = {}) {
  return render(
    <ChatPage
      status="success"
      data={{ station: { code: 'PUJ' }, conversations: CONVERSATIONS, messagesByConversationId: MESSAGES_BY_CONVERSATION_ID }}
      error={null}
      connection="connected"
      onRetry={() => {}}
      onSendMessage={vi.fn().mockResolvedValue({})}
      onMarkAsRead={vi.fn().mockResolvedValue({})}
      onCloseConversation={vi.fn().mockResolvedValue({})}
      onCreateConversation={vi.fn().mockResolvedValue({ id: 'CHAT-5001' })}
      onNavigateToResource={() => {}}
      {...props}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatPage', () => {
  it('renders the conversation list with both conversations', () => {
    renderPage();
    expect(screen.getByText('Chat interno')).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
  });

  it('shows the skeleton while loading', () => {
    renderPage({ status: 'loading' });
    expect(screen.getByTestId('chat-skeleton')).toBeInTheDocument();
  });

  it('shows the no-conversations empty state when there are none', () => {
    renderPage({ forceState: 'chatEmpty' });
    expect(screen.getByText('No hay conversaciones disponibles')).toBeInTheDocument();
  });

  it('shows the no-selection empty state before picking a conversation', () => {
    renderPage();
    expect(screen.getByText('Selecciona una conversación para comenzar')).toBeInTheDocument();
  });

  it('selecting a conversation opens the chat panel and marks it as read when unread', async () => {
    const onMarkAsRead = vi.fn().mockResolvedValue({});
    renderPage({ onMarkAsRead });

    await userEvent.click(screen.getByText('DM161'));

    expect(screen.getByText('Ya iniciamos el proceso de descarga.')).toBeInTheDocument();
    await waitFor(() => expect(onMarkAsRead).toHaveBeenCalledWith('CHAT-4001'));
  });

  it('does not call onMarkAsRead when opening an already-read conversation', async () => {
    const onMarkAsRead = vi.fn().mockResolvedValue({});
    renderPage({ onMarkAsRead });

    await userEvent.click(screen.getByText('AA904'));
    expect(onMarkAsRead).not.toHaveBeenCalled();
  });

  it('sends a message through the composer', async () => {
    const onSendMessage = vi.fn().mockResolvedValue({});
    renderPage({ onSendMessage });

    await userEvent.click(screen.getByText('AA904'));
    await userEvent.type(screen.getByLabelText('Mensaje'), 'Gracias por el reporte.');
    await userEvent.click(screen.getByLabelText('Enviar mensaje'));

    expect(onSendMessage).toHaveBeenCalledWith('CHAT-4002', 'Gracias por el reporte.', []);
  });

  it('closing a conversation calls onCloseConversation and shows a toast', async () => {
    const onCloseConversation = vi.fn().mockResolvedValue({});
    renderPage({ onCloseConversation });

    await userEvent.click(screen.getByText('AA904'));
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como cerrada' }));

    expect(onCloseConversation).toHaveBeenCalledWith('CHAT-4002');
    expect(await screen.findByText('Conversación marcada como cerrada.')).toBeInTheDocument();
  });

  it('"Ver vuelo" and "Ver operación" call onNavigateToResource with the right ids', async () => {
    const onNavigateToResource = vi.fn();
    renderPage({ onNavigateToResource });

    await userEvent.click(screen.getByText('DM161'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver vuelo' }));
    expect(onNavigateToResource).toHaveBeenCalledWith('flight-monitoring', 1);

    await userEvent.click(screen.getByRole('button', { name: 'Ver operación' }));
    expect(onNavigateToResource).toHaveBeenCalledWith('approvals', 'REV-1001');
  });

  it('opens the new conversation drawer, loads available flights, and creates a conversation', async () => {
    vi.spyOn(chatService, 'getAvailableFlightsForNewConversation').mockResolvedValue([
      { flightId: 6, flightNumber: 'AC1876', airline: 'Air Canada', origin: 'PUJ', destination: 'YYZ', position: 'A5', operationId: 'REV-1004', agentId: 12, agentName: 'Carlos Medina' },
    ]);
    const onCreateConversation = vi.fn().mockResolvedValue({ id: 'CHAT-5001' });
    renderPage({ onCreateConversation });

    await userEvent.click(screen.getByRole('button', { name: /nueva conversación/i }));
    expect(await screen.findByText('AC1876 · Air Canada · PUJ → YYZ')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Vuelo / operación'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar conversación' }));

    expect(onCreateConversation).toHaveBeenCalledWith({ flightId: 6, operationId: 'REV-1004', agentId: 12 });
    expect(await screen.findByText('Conversación iniciada.')).toBeInTheDocument();
  });

  it('filters the list by search text', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText('Vuelo, aerolínea, agente, referencia...'), 'AA904');

    expect(screen.queryByText('DM161')).not.toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
  });

  it('filters the list by the unread quick chip', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /No leídas/ }));

    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.queryByText('AA904')).not.toBeInTheDocument();
  });

  it('shows the error panel and retries', async () => {
    const onRetry = vi.fn();
    renderPage({ status: 'error', error: new Error('network down'), onRetry });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the disconnected banner with a retry action inside the open conversation', async () => {
    const onRetry = vi.fn();
    renderPage({ forceState: 'chatDisconnected', onRetry });
    await userEvent.click(screen.getByText('DM161'));

    expect(screen.getByText('No se pudo actualizar la conversación.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ChatPage — tablet layout', () => {
  const originalMatchMedia = window.matchMedia;

  function mockMatchMedia(matchingQueries) {
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: matchingQueries.includes(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows only the list before a selection, then only the chat (with a back button) after selecting', async () => {
    mockMatchMedia(['(max-width: 1024px)']);
    renderPage();

    expect(screen.getByText('Chat interno')).toBeInTheDocument();
    expect(screen.queryByLabelText('Volver a la lista de conversaciones')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('DM161'));
    expect(screen.queryByText('Chat interno')).not.toBeInTheDocument();
    const backButton = screen.getByLabelText('Volver a la lista de conversaciones');
    expect(backButton).toBeInTheDocument();

    await userEvent.click(backButton);
    expect(screen.getByText('Chat interno')).toBeInTheDocument();
  });
});