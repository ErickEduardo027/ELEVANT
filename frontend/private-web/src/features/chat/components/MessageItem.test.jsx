import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageItem from './MessageItem';

function makeMessage(overrides) {
  return {
    id: 'MSG-1',
    senderRole: 'agent',
    senderName: 'Carlos Medina',
    content: 'Ya iniciamos el proceso de descarga de equipaje.',
    createdAt: '2026-08-08T08:40:00-04:00',
    status: 'delivered',
    attachments: [],
    ...overrides,
  };
}

describe('MessageItem', () => {
  it('renders an agent message aligned left with the sender name', () => {
    render(<MessageItem message={makeMessage()} />);
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument();
    expect(screen.getByText('Ya iniciamos el proceso de descarga de equipaje.')).toBeInTheDocument();
    expect(screen.getByTestId('message-item')).toHaveClass('justify-start');
  });

  it('renders an OCC message aligned right without a sender label', () => {
    render(<MessageItem message={makeMessage({ senderRole: 'occ', senderName: 'Administrador OCC', content: 'Recibido.', status: 'sent' })} />);
    expect(screen.queryByText('Administrador OCC')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-item')).toHaveClass('justify-end');
  });

  it('renders attachments when present', () => {
    render(
      <MessageItem
        message={makeMessage({
          attachments: [{ id: 'a1', name: 'foto.jpg', type: 'image', size: 1000, status: 'ready' }],
        })}
      />
    );
    expect(screen.getByTestId('attachment-preview')).toBeInTheDocument();
    expect(screen.getByText('foto.jpg')).toBeInTheDocument();
  });
});
