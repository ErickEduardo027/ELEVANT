import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationCard from './NotificationCard';

const NOW_ISO = '2026-08-08T14:00:00-04:00';

function makeNotification(overrides) {
  return {
    id: 'NOT-2002',
    category: 'operational',
    severity: 'warning',
    title: 'Vuelo DM161 fuera de tiempo estimado',
    description: 'El vuelo DM161 no llegó a la posición asignada según la hora estimada.',
    read: false,
    createdAt: '2026-08-08T13:55:00-04:00',
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

describe('NotificationCard', () => {
  it('renders title, description, severity badge and flight chips', () => {
    render(<NotificationCard notification={makeNotification()} nowIso={NOW_ISO} onToggleSelect={() => {}} onOpen={() => {}} />);

    expect(screen.getByText('Vuelo DM161 fuera de tiempo estimado')).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('Arajet')).toBeInTheDocument();
    expect(screen.getByText('Atención')).toBeInTheDocument();
    expect(screen.getByText('Hace 5 min')).toBeInTheDocument();
  });

  it('shows the unread dot and heavier weight for an unread notification', () => {
    render(<NotificationCard notification={makeNotification({ read: false })} nowIso={NOW_ISO} onToggleSelect={() => {}} onOpen={() => {}} />);
    expect(screen.getByTestId('notification-card')).toHaveAttribute('data-unread', 'true');
    expect(screen.getByTestId('notification-unread-dot')).toBeInTheDocument();
  });

  it('hides the unread dot for a read notification', () => {
    render(<NotificationCard notification={makeNotification({ read: true })} nowIso={NOW_ISO} onToggleSelect={() => {}} onOpen={() => {}} />);
    expect(screen.getByTestId('notification-card')).toHaveAttribute('data-unread', 'false');
    expect(screen.queryByTestId('notification-unread-dot')).not.toBeInTheDocument();
  });

  it('calls onOpen when the card body is clicked', async () => {
    const onOpen = vi.fn();
    render(<NotificationCard notification={makeNotification()} nowIso={NOW_ISO} onToggleSelect={() => {}} onOpen={onOpen} />);

    await userEvent.click(screen.getByText('Vuelo DM161 fuera de tiempo estimado'));
    expect(onOpen).toHaveBeenCalledWith('NOT-2002');
  });

  it('calls onToggleSelect (and not onOpen) when the checkbox is clicked', async () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    render(<NotificationCard notification={makeNotification()} nowIso={NOW_ISO} onToggleSelect={onToggleSelect} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar notificación' }));
    expect(onToggleSelect).toHaveBeenCalledWith('NOT-2002');
    expect(onOpen).not.toHaveBeenCalled();
  });
});
