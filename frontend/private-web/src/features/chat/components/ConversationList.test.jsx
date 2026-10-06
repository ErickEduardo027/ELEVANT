import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationList from './ConversationList';

function makeConversation(id, overrides) {
  return {
    id,
    flightNumber: `FL${id}`,
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    position: 'A5',
    agentName: 'Carlos Medina',
    agentStatus: 'online',
    status: 'active',
    lastMessage: 'Mensaje',
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
    requiresAttention: false,
    ...overrides,
  };
}

describe('ConversationList', () => {
  it('renders one item per conversation and marks the selected one', () => {
    render(
      <ConversationList
        conversations={[makeConversation('1'), makeConversation('2')]}
        selectedId="2"
        onSelect={() => {}}
        emptyMessage="Sin resultados"
      />
    );

    const items = screen.getAllByTestId('conversation-list-item');
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveAttribute('data-selected', 'true');
  });

  it('shows the empty message when there are no conversations', () => {
    render(<ConversationList conversations={[]} selectedId={null} onSelect={() => {}} emptyMessage="No se encontraron conversaciones" />);
    expect(screen.getByText('No se encontraron conversaciones')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-list')).not.toBeInTheDocument();
  });

  it('propagates selection clicks', async () => {
    const onSelect = vi.fn();
    render(
      <ConversationList conversations={[makeConversation('1')]} selectedId={null} onSelect={onSelect} emptyMessage="" />
    );
    await userEvent.click(screen.getByTestId('conversation-list-item'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });
});