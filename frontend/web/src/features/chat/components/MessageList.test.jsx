import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MessageList from './MessageList';

const NOW_ISO = '2026-08-08T14:00:00-04:00';

function makeMessages() {
  return [
    { id: 'm1', type: 'system', content: 'El agente Carlos Medina fue asignado a la operación.', createdAt: '2026-08-08T08:10:00-04:00' },
    { id: 'm2', type: 'message', senderRole: 'agent', senderName: 'Carlos Medina', content: 'Entendido.', createdAt: '2026-08-08T08:17:00-04:00', status: 'delivered', attachments: [] },
    { id: 'm3', type: 'message', senderRole: 'occ', senderName: 'OCC', content: 'Gracias.', createdAt: '2026-08-08T08:20:00-04:00', status: 'sent', attachments: [] },
  ];
}

function mockScrollMetrics(el, { scrollHeight, clientHeight, scrollTop }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
}

describe('MessageList', () => {
  it('groups messages under date separators and renders system events distinctly from bubbles', () => {
    render(<MessageList messages={makeMessages()} nowIso={NOW_ISO} />);
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    expect(screen.getByTestId('system-event')).toHaveTextContent('El agente Carlos Medina fue asignado a la operación.');
    expect(screen.getAllByTestId('message-item')).toHaveLength(2);
  });

  it('renders an empty container without errors when there are no messages', () => {
    render(<MessageList messages={[]} nowIso={NOW_ISO} />);
    expect(screen.getByTestId('message-list')).toBeEmptyDOMElement();
  });

  it('shows a "Nuevo mensaje" affordance when a message arrives while scrolled away from the bottom, and clicking it scrolls down', () => {
    const initial = makeMessages();
    const { rerender } = render(<MessageList messages={initial} nowIso={NOW_ISO} />);

    const list = screen.getByTestId('message-list');
    mockScrollMetrics(list, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(list);

    const withNewMessage = [
      ...initial,
      { id: 'm4', type: 'message', senderRole: 'agent', senderName: 'Carlos Medina', content: 'Nueva actualización.', createdAt: '2026-08-08T08:25:00-04:00', status: 'delivered', attachments: [] },
    ];
    rerender(<MessageList messages={withNewMessage} nowIso={NOW_ISO} />);

    expect(screen.getByText('Nuevo mensaje')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nuevo mensaje'));
    expect(screen.queryByText('Nuevo mensaje')).not.toBeInTheDocument();
  });
});
