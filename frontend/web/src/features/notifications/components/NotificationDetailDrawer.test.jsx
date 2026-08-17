import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationDetailDrawer from './NotificationDetailDrawer';

function makeNotification(overrides) {
  return {
    id: 'NOT-2002',
    category: 'operational',
    severity: 'warning',
    title: 'Vuelo DM161 fuera de tiempo estimado',
    description: 'El vuelo DM161 no llegó a la posición asignada según la hora estimada.',
    read: false,
    createdAt: '2026-08-08T14:20:00-04:00',
    flightNumber: 'DM161',
    airline: 'Arajet',
    position: 'A5',
    operationId: null,
    relatedModule: 'flight-monitoring',
    relatedRoute: 15,
    source: 'Monitoreo de vuelos',
    metadata: {},
    ...overrides,
  };
}

const NOOP_PROPS = { onClose: () => {}, onMarkAsRead: () => {}, onMarkAsUnread: () => {}, onNavigate: () => {} };

describe('NotificationDetailDrawer', () => {
  it('renders nothing when there is no notification', () => {
    const { container } = render(<NotificationDetailDrawer notification={null} {...NOOP_PROPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders category, severity, title and description', () => {
    render(<NotificationDetailDrawer notification={makeNotification()} {...NOOP_PROPS} />);
    expect(screen.getByText('Operativas')).toBeInTheDocument();
    expect(screen.getByText('Atención')).toBeInTheDocument();
    expect(screen.getByText('Vuelo DM161 fuera de tiempo estimado')).toBeInTheDocument();
    expect(screen.getByText(/no llegó a la posición asignada/)).toBeInTheDocument();
  });

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<NotificationDetailDrawer notification={makeNotification()} {...NOOP_PROPS} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<NotificationDetailDrawer notification={makeNotification()} {...NOOP_PROPS} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "Ver vuelo" and calls onNavigate with the flight route for a flight-monitoring notification', async () => {
    const onNavigate = vi.fn();
    render(<NotificationDetailDrawer notification={makeNotification()} {...NOOP_PROPS} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: /ver vuelo/i }));
    expect(onNavigate).toHaveBeenCalledWith('flight-monitoring', 15);
  });

  it('shows "Ver operación" for an approvals notification', () => {
    render(
      <NotificationDetailDrawer
        notification={makeNotification({ relatedModule: 'approvals', relatedRoute: 'REV-1002' })}
        {...NOOP_PROPS}
      />
    );
    expect(screen.getByRole('button', { name: /ver operación/i })).toBeInTheDocument();
  });

  it('shows "Ver reporte" for a reports notification', () => {
    render(<NotificationDetailDrawer notification={makeNotification({ relatedModule: 'reports', relatedRoute: null })} {...NOOP_PROPS} />);
    expect(screen.getByRole('button', { name: /ver reporte/i })).toBeInTheDocument();
  });

  it('renders no footer action when there is no related resource', () => {
    render(<NotificationDetailDrawer notification={makeNotification({ relatedModule: null, relatedRoute: null })} {...NOOP_PROPS} />);
    expect(screen.queryByRole('button', { name: /ver (vuelo|operación|reporte)/i })).not.toBeInTheDocument();
  });

  it('shows "Marcar como leída" for an unread notification and calls onMarkAsRead', async () => {
    const onMarkAsRead = vi.fn();
    render(<NotificationDetailDrawer notification={makeNotification({ read: false })} {...NOOP_PROPS} onMarkAsRead={onMarkAsRead} />);
    await userEvent.click(screen.getByRole('button', { name: /marcar como leída/i }));
    expect(onMarkAsRead).toHaveBeenCalledWith('NOT-2002');
  });

  it('shows "Marcar como no leída" for a read notification and calls onMarkAsUnread', async () => {
    const onMarkAsUnread = vi.fn();
    render(<NotificationDetailDrawer notification={makeNotification({ read: true })} {...NOOP_PROPS} onMarkAsUnread={onMarkAsUnread} />);
    await userEvent.click(screen.getByRole('button', { name: /marcar como no leída/i }));
    expect(onMarkAsUnread).toHaveBeenCalledWith('NOT-2002');
  });
});
