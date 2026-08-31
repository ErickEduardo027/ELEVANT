import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationListItem from './ConversationListItem';

function makeConversation(overrides) {
  return {
    id: 'CHAT-4001',
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    position: 'A5',
    agentName: 'Carlos Medina',
    agentStatus: 'online',
    status: 'active',
    lastMessage: '¿Podemos usar la banda 5 en su lugar?',
    lastMessageAt: new Date().toISOString(),
    unreadCount: 2,
    requiresAttention: true,
    ...overrides,
  };
}

describe('ConversationListItem', () => {
  it('renders flight, route, agent and last message preview', () => {
    render(<ConversationListItem conversation={makeConversation()} onSelect={() => {}} />);

    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('Arajet')).toBeInTheDocument();
    expect(screen.getByText(/MIA → PUJ/)).toBeInTheDocument();
    expect(screen.getByText(/Carlos Medina/)).toBeInTheDocument();
    expect(screen.getByText('¿Podemos usar la banda 5 en su lugar?')).toBeInTheDocument();
  });

  it('shows the unread badge with the count when unreadCount > 0', () => {
    render(<ConversationListItem conversation={makeConversation({ unreadCount: 3 })} onSelect={() => {}} />);
    expect(screen.getByTestId('unread-count-badge')).toHaveTextContent('3');
  });

  it('hides the unread badge when unreadCount is 0', () => {
    render(<ConversationListItem conversation={makeConversation({ unreadCount: 0 })} onSelect={() => {}} />);
    expect(screen.queryByTestId('unread-count-badge')).not.toBeInTheDocument();
  });

  it('shows the requires-attention indicator only when flagged', () => {
    const { rerender } = render(<ConversationListItem conversation={makeConversation({ requiresAttention: true })} onSelect={() => {}} />);
    expect(screen.getByTestId('requires-attention-dot')).toBeInTheDocument();

    rerender(<ConversationListItem conversation={makeConversation({ requiresAttention: false })} onSelect={() => {}} />);
    expect(screen.queryByTestId('requires-attention-dot')).not.toBeInTheDocument();
  });

  it('shows the agent presence dot for online/offline but not for unknown presence', () => {
    const { rerender } = render(<ConversationListItem conversation={makeConversation({ agentStatus: 'online' })} onSelect={() => {}} />);
    expect(screen.getByTestId('agent-presence-dot')).toBeInTheDocument();

    rerender(<ConversationListItem conversation={makeConversation({ agentStatus: null })} onSelect={() => {}} />);
    expect(screen.queryByTestId('agent-presence-dot')).not.toBeInTheDocument();
  });

  it('marks the item as selected via data-selected', () => {
    render(<ConversationListItem conversation={makeConversation()} selected onSelect={() => {}} />);
    expect(screen.getByTestId('conversation-list-item')).toHaveAttribute('data-selected', 'true');
  });

  it('calls onSelect with the conversation id when clicked', async () => {
    const onSelect = vi.fn();
    render(<ConversationListItem conversation={makeConversation()} onSelect={onSelect} />);

    await userEvent.click(screen.getByTestId('conversation-list-item'));
    expect(onSelect).toHaveBeenCalledWith('CHAT-4001');
  });
});
