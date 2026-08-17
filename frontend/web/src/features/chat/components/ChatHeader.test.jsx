import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatHeader from './ChatHeader';

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
    agentName: 'Carlos Medina',
    agentStatus: 'online',
    agentLastSeenAt: null,
    status: 'active',
    ...overrides,
  };
}

describe('ChatHeader', () => {
  it('renders flight, route, agent and status', () => {
    render(<ChatHeader conversation={makeConversation()} onViewFlight={() => {}} onViewOperation={() => {}} />);
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText(/MIA → PUJ/)).toBeInTheDocument();
    expect(screen.getByText('En curso')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
  });

  it('shows last-seen copy for an offline agent and nothing for unknown presence', () => {
    const { rerender } = render(
      <ChatHeader
        conversation={makeConversation({ agentStatus: 'offline', agentLastSeenAt: new Date().toISOString() })}
        onViewFlight={() => {}}
        onViewOperation={() => {}}
      />
    );
    expect(screen.getByText(/Última conexión/)).toBeInTheDocument();

    rerender(<ChatHeader conversation={makeConversation({ agentStatus: null })} onViewFlight={() => {}} onViewOperation={() => {}} />);
    expect(screen.queryByText(/Última conexión/)).not.toBeInTheDocument();
    expect(screen.queryByText('En línea')).not.toBeInTheDocument();
  });

  it('calls onViewFlight/onViewOperation with the right ids', async () => {
    const onViewFlight = vi.fn();
    const onViewOperation = vi.fn();
    render(<ChatHeader conversation={makeConversation()} onViewFlight={onViewFlight} onViewOperation={onViewOperation} />);

    await userEvent.click(screen.getByText('Ver vuelo'));
    expect(onViewFlight).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByText('Ver operación'));
    expect(onViewOperation).toHaveBeenCalledWith('REV-1001');
  });

  it('shows a back button only when showBack is true and wires onBack', async () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <ChatHeader conversation={makeConversation()} onViewFlight={() => {}} onViewOperation={() => {}} showBack onBack={onBack} />
    );
    await userEvent.click(screen.getByLabelText('Volver a la lista de conversaciones'));
    expect(onBack).toHaveBeenCalled();

    rerender(<ChatHeader conversation={makeConversation()} onViewFlight={() => {}} onViewOperation={() => {}} />);
    expect(screen.queryByLabelText('Volver a la lista de conversaciones')).not.toBeInTheDocument();
  });
});
